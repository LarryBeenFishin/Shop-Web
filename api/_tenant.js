const { db } = require('./_db');

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

function hostFromRequest(req) {
  const raw = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return raw.replace(/:\d+$/, '').replace(/^www\./, '');
}

function legacyShop() {
  return {
    id: null,
    slug: process.env.SHOP_SLUG || 'legacy',
    name: process.env.SHOP_NAME || 'Auto Repair Shop',
    timezone: process.env.SHOP_TIMEZONE || 'America/Chicago',
    status: 'active',
    notification_email: process.env.SHOP_NOTIFICATION_EMAIL || null,
    resend_from_email: process.env.RESEND_FROM_EMAIL || null,
    twilio_phone_number: process.env.TWILIO_PHONE_NUMBER || null,
    public_config: {}
  };
}

function isMissingTenantSchema(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01' || code === 'PGRST205' || message.includes("could not find the table 'public.shops'") || message.includes('relation "public.shops" does not exist');
}

function cached(key) {
  const item = cache.get(key);
  if (!item || item.expires < Date.now()) {
    if (item) cache.delete(key);
    return null;
  }
  return item.value;
}

function putCache(key, value) {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

async function shopBySlug(supabase, slug) {
  const key = `slug:${slug}`;
  const hit = cached(key);
  if (hit) return hit;
  const { data, error } = await supabase
    .from('shops')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Active shop '${slug}' was not found`);
  return putCache(key, data);
}

async function shopByHost(supabase, host) {
  if (!host) return null;
  const key = `host:${host}`;
  const hit = cached(key);
  if (hit) return hit;
  const { data: domain, error } = await supabase
    .from('shop_domains')
    .select('shop_id')
    .eq('hostname', host)
    .maybeSingle();
  if (error) throw error;
  if (!domain?.shop_id) return null;
  const { data: shop, error: shopError } = await supabase
    .from('shops')
    .select('*')
    .eq('id', domain.shop_id)
    .eq('status', 'active')
    .maybeSingle();
  if (shopError) throw shopError;
  return shop ? putCache(key, shop) : null;
}

async function resolveShop(req, suppliedDb) {
  const supabase = suppliedDb || db();
  try {
    const configuredSlug = String(process.env.SHOP_SLUG || '').trim().toLowerCase();
    if (configuredSlug) return await shopBySlug(supabase, configuredSlug);

    const host = hostFromRequest(req);
    const fromHost = await shopByHost(supabase, host);
    if (fromHost) return fromHost;

    // Safe convenience for the first deployment: if only one active tenant exists,
    // use it. Once there are multiple shops, SHOP_SLUG/domain mapping is required.
    const { data, error } = await supabase
      .from('shops')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(2);
    if (error) throw error;
    if ((data || []).length === 1) return data[0];
    if ((data || []).length > 1) {
      throw new Error('SHOP_SLUG is required because more than one active shop exists');
    }
    throw new Error('No active shop is configured');
  } catch (error) {
    // Keeps the current site alive until multi_tenant_v2.sql is run.
    if (isMissingTenantSchema(error)) return legacyShop();
    throw error;
  }
}

function applyShopScope(query, shop) {
  return shop?.id ? query.eq('shop_id', shop.id) : query;
}

function withShopId(row, shop) {
  return shop?.id ? { ...row, shop_id: shop.id } : row;
}

async function resolveShopForIncomingSms(req, toNumber, suppliedDb) {
  const supabase = suppliedDb || db();
  try {
    const to = String(toNumber || '').trim();
    if (to) {
      const { data, error } = await supabase
        .from('shops')
        .select('*')
        .eq('twilio_phone_number', to)
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw error;
      if (data) return data;
    }
  } catch (error) {
    if (!isMissingTenantSchema(error)) throw error;
  }
  return resolveShop(req, supabase);
}

module.exports = {
  resolveShop,
  resolveShopForIncomingSms,
  applyShopScope,
  withShopId,
  hostFromRequest,
  legacyShop
};
