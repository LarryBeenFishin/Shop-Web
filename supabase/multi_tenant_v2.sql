-- Multi-shop / multi-tenant upgrade for Shop-Web.
-- Run once AFTER schema.sql and admin_features.sql.
-- Safe to re-run: statements use IF NOT EXISTS / guarded updates where practical.

begin;

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  slug text not null unique,
  name text not null,
  timezone text not null default 'America/Chicago',
  status text not null default 'active' check (status in ('active','paused','archived')),
  notification_email text,
  resend_from_email text,
  twilio_phone_number text,
  public_config jsonb not null default '{}'::jsonb,
  constraint shops_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index if not exists shops_status_idx on public.shops(status);
alter table public.shops enable row level security;

create table if not exists public.shop_domains (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  hostname text not null unique,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists shop_domains_shop_idx on public.shop_domains(shop_id);
alter table public.shop_domains enable row level security;

-- Current Shop-Web tenant. Keep this slug; future Vercel projects use their own slug.
insert into public.shops (slug, name, timezone)
values ('shop-web', 'YOUR SHOP NAME', 'America/Chicago')
on conflict (slug) do nothing;

-- Current production hostname, useful as a fallback when SHOP_SLUG is not set.
insert into public.shop_domains (shop_id, hostname, is_primary)
select id, 'shop-web-xi-three.vercel.app', true
from public.shops where slug = 'shop-web'
on conflict (hostname) do nothing;

alter table public.appointments add column if not exists shop_id uuid references public.shops(id) on delete restrict;
alter table public.customers add column if not exists shop_id uuid references public.shops(id) on delete restrict;
alter table public.inspections add column if not exists shop_id uuid references public.shops(id) on delete restrict;
alter table public.sms_messages add column if not exists shop_id uuid references public.shops(id) on delete restrict;
alter table public.push_subscriptions add column if not exists shop_id uuid references public.shops(id) on delete restrict;
alter table public.appointments add column if not exists customer_id uuid references public.customers(id) on delete set null;

-- Attach all existing records to the first/current shop.
do $$
declare
  current_shop uuid;
begin
  select id into current_shop from public.shops where slug = 'shop-web' limit 1;
  if current_shop is null then
    raise exception 'shop-web tenant could not be created';
  end if;

  update public.appointments set shop_id = current_shop where shop_id is null;
  update public.customers set shop_id = current_shop where shop_id is null;
  update public.inspections set shop_id = current_shop where shop_id is null;
  update public.sms_messages set shop_id = current_shop where shop_id is null;
  update public.push_subscriptions set shop_id = current_shop where shop_id is null;
end $$;

alter table public.appointments alter column shop_id set not null;
alter table public.customers alter column shop_id set not null;
alter table public.inspections alter column shop_id set not null;
alter table public.sms_messages alter column shop_id set not null;
alter table public.push_subscriptions alter column shop_id set not null;

-- Link historical appointments to the matching customer profile when possible.
update public.appointments a
set customer_id = c.id
from public.customers c
where a.customer_id is null
  and a.shop_id = c.shop_id
  and regexp_replace(a.phone, '\D', '', 'g') <> ''
  and (
    case
      when length(regexp_replace(a.phone, '\D', '', 'g')) = 11 and left(regexp_replace(a.phone, '\D', '', 'g'), 1) = '1'
        then right(regexp_replace(a.phone, '\D', '', 'g'), 10)
      else regexp_replace(a.phone, '\D', '', 'g')
    end
  ) = c.normalized_phone;

-- Replace single-shop uniqueness with tenant-aware uniqueness.
drop index if exists public.appointments_active_slot_unique;
create unique index if not exists appointments_shop_active_slot_unique
  on public.appointments (shop_id, appointment_date, appointment_time_key)
  where status <> 'cancelled';

create index if not exists appointments_shop_date_idx
  on public.appointments (shop_id, appointment_date, appointment_time_key);
create index if not exists appointments_shop_status_idx
  on public.appointments (shop_id, status);
create index if not exists appointments_shop_customer_idx
  on public.appointments (shop_id, customer_id, appointment_date desc);

-- Customer phone numbers only need to be unique inside one shop.
drop index if exists public.customers_normalized_phone_unique;
create unique index if not exists customers_shop_phone_unique
  on public.customers (shop_id, normalized_phone)
  where normalized_phone is not null and normalized_phone <> '';
create index if not exists customers_shop_name_idx on public.customers(shop_id, name);

-- Replace the original single-shop appointment -> customer trigger with a tenant-aware version.
create or replace function public.sync_appointment_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text;
  vehicle_text text;
  linked_customer uuid;
begin
  normalized := regexp_replace(coalesce(new.phone,''), '\D', '', 'g');
  if length(normalized) = 11 and left(normalized,1) = '1' then
    normalized := right(normalized,10);
  end if;

  vehicle_text := trim(concat_ws(' ', new.year, new.make, new.model));

  if normalized <> '' and new.shop_id is not null then
    insert into public.customers(
      shop_id,name,phone,normalized_phone,email,vehicle,last_service,updated_at
    )
    values(
      new.shop_id,new.name,new.phone,normalized,nullif(new.email,''),nullif(vehicle_text,''),new.service,now()
    )
    on conflict (shop_id, normalized_phone)
      where normalized_phone is not null and normalized_phone <> ''
    do update set
      name = excluded.name,
      phone = excluded.phone,
      email = coalesce(excluded.email, public.customers.email),
      vehicle = coalesce(excluded.vehicle, public.customers.vehicle),
      last_service = coalesce(excluded.last_service, public.customers.last_service),
      updated_at = now()
    returning id into linked_customer;

    if linked_customer is not null and new.customer_id is distinct from linked_customer then
      update public.appointments
      set customer_id = linked_customer
      where id = new.id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_sync_customer on public.appointments;
create trigger appointments_sync_customer
after insert or update of name,phone,email,year,make,model,service
on public.appointments
for each row execute function public.sync_appointment_customer();

create index if not exists inspections_shop_created_idx on public.inspections(shop_id, created_at desc);
create index if not exists inspections_shop_customer_idx on public.inspections(shop_id, customer_id);
create index if not exists sms_shop_phone_idx on public.sms_messages(shop_id, phone, created_at desc);

-- push_subscriptions originally had endpoint UNIQUE globally.
alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_key;
create unique index if not exists push_subscriptions_shop_endpoint_unique
  on public.push_subscriptions(shop_id, endpoint);

-- Operational audit trail. Useful once multiple shops are sharing one database.
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  shop_id uuid not null references public.shops(id) on delete restrict,
  actor text not null default 'system',
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists audit_events_shop_created_idx on public.audit_events(shop_id, created_at desc);
alter table public.audit_events enable row level security;

commit;
