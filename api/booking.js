const { Resend } = require('resend');
const { db, upsertCustomer, auditEvent } = require('./_db');
const { resolveShop, applyShopScope, withShopId } = require('./_tenant');
const { sendShopPush } = require('./_notifications');

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function normalizeTime(timeText) {
  const match = String(timeText || '').trim().match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return String(timeText || '').trim();
  let hour = Number(match[1]);
  if (match[3].toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (match[3].toUpperCase() === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2,'0')}:${match[2]}`;
}
function validDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }
function boolish(v) { return v === true || String(v).toLowerCase() === 'yes' || String(v).toLowerCase() === 'true'; }

async function sendEmails(shop, appt) {
  if (!process.env.RESEND_API_KEY) return;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const shopName = shop?.name || process.env.SHOP_NAME || 'Auto Repair Shop';
  const from = shop?.resend_from_email || process.env.RESEND_FROM_EMAIL || `${shopName} <onboarding@resend.dev>`;
  const shopEmail = shop?.notification_email || process.env.SHOP_NOTIFICATION_EMAIL;
  const when = `${appt.preferred_date_label} at ${appt.appointment_time}`;
  const vehicle = `${appt.year} ${appt.make} ${appt.model}`;

  const jobs = [];
  if (shopEmail) {
    jobs.push(resend.emails.send({
      from,
      to: [shopEmail],
      subject: `New appointment request — ${appt.name} — ${when}`,
      html: `<h2>New appointment request</h2><p><strong>Customer:</strong> ${esc(appt.name)}</p><p><strong>Phone:</strong> ${esc(appt.phone)}</p><p><strong>Email:</strong> ${esc(appt.email || 'Not provided')}</p><p><strong>Vehicle:</strong> ${esc(vehicle)}</p><p><strong>Service:</strong> ${esc(appt.service)}</p><p><strong>Requested time:</strong> ${esc(when)}</p><p><strong>Drop off:</strong> ${appt.drop_off ? 'Yes' : 'No'}</p><p><strong>Message:</strong> ${esc(appt.message || 'None')}</p>`
    }));
  }
  if (appt.email) {
    jobs.push(resend.emails.send({
      from,
      to: [appt.email],
      subject: `${shopName}: appointment request received`,
      html: `<h2>We received your appointment request</h2><p>Hi ${esc(appt.name)},</p><p>We received your request for <strong>${esc(when)}</strong>.</p><p><strong>Vehicle:</strong> ${esc(vehicle)}<br><strong>Service:</strong> ${esc(appt.service)}</p><p>This is a request confirmation. The shop will contact you if the requested time needs to be adjusted.</p><p>Thank you,<br>${esc(shopName)}</p>`
    }));
  }
  await Promise.allSettled(jobs);
}

module.exports = async function handler(req, res) {
  try {
    const supabase = db();
    const shop = await resolveShop(req, supabase);

    if (req.method === 'GET') {
      const date = req.query.date;
      if (!validDate(date)) return res.status(400).json({ status: 'error', message: 'Invalid or missing date' });
      let query = supabase
        .from('appointments')
        .select('appointment_time,status')
        .eq('appointment_date', date)
        .neq('status', 'cancelled');
      query = applyShopScope(query, shop);
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({
        status: 'success',
        unavailable_times: (data || []).map(x => x.appointment_time)
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    const p = req.body || {};
    const required = ['name','phone','year','make','model','service','preferred_date_raw','preferred_time'];
    const missing = required.filter(k => !String(p[k] || '').trim());
    if (missing.length) return res.status(400).json({ status: 'error', message: `Missing: ${missing.join(', ')}` });
    if (!validDate(p.preferred_date_raw)) return res.status(400).json({ status: 'error', message: 'Invalid appointment date' });

    const customer=await upsertCustomer(supabase,{
      name:String(p.name).trim().slice(0,120),
      phone:String(p.phone).trim().slice(0,40),
      email:String(p.email||'').trim().slice(0,200)||null,
      vehicle:`${String(p.year).trim()} ${String(p.make).trim()} ${String(p.model).trim()}`,
      service:String(p.service).trim().slice(0,120)
    },shop.id).catch(err=>{console.error('Customer sync error:',err?.message||err);return null;});

    const baseRow = {
      name: String(p.name).trim().slice(0,120),
      phone: String(p.phone).trim().slice(0,40),
      email: String(p.email || '').trim().slice(0,200) || null,
      year: String(p.year).trim().slice(0,10),
      make: String(p.make).trim().slice(0,80),
      model: String(p.model).trim().slice(0,100),
      service: String(p.service).trim().slice(0,120),
      appointment_date: p.preferred_date_raw,
      preferred_date_label: String(p.preferred_date || p.preferred_date_raw).slice(0,100),
      appointment_time: String(p.preferred_time).trim().slice(0,30),
      appointment_time_key: normalizeTime(p.preferred_time),
      drop_off: boolish(p.drop_off),
      message: String(p.message || '').trim().slice(0,3000) || null,
      marketing_opt_in: boolish(p.marketing_opt_in),
      submitted_from: String(p.submitted_from || `${shop.name} Website`).slice(0,120),
      status: 'pending',
      seen:false,
      updated_at:new Date().toISOString()
    };
    if(shop.id) baseRow.customer_id=customer?.id||null;
    const row=withShopId(baseRow,shop);

    const { data, error } = await supabase.from('appointments').insert(row).select('*').single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ status: 'unavailable', message: 'That appointment time is already booked' });
      throw error;
    }

    await auditEvent(supabase,shop.id,'appointment.created','appointment',data.id,{source:'website',customer_id:data.customer_id||null,service:data.service,date:data.appointment_date,time:data.appointment_time},'customer');

    await Promise.allSettled([
      sendEmails(shop, data),
      sendShopPush(supabase,shop,{
        title:`New appointment — ${shop.name}`,
        body:`${data.name}: ${data.service} on ${data.preferred_date_label} at ${data.appointment_time}`,
        url:'/admin',
        tag:`appointment-${data.id}`
      })
    ]);

    return res.status(201).json({ status: 'success', appointment_id: data.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'error', message: 'Unable to process appointment request' });
  }
};
