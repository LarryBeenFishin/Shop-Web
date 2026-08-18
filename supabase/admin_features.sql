-- Run this once in Supabase SQL Editor after the base schema.sql.

alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments
  add constraint appointments_status_check
  check (status in ('pending','new','confirmed','checked-in','in-progress','waiting-approval','completed','cancelled'));

alter table public.appointments add column if not exists internal_notes text;
alter table public.appointments add column if not exists seen boolean not null default false;
alter table public.appointments add column if not exists updated_at timestamptz not null default now();

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  phone text not null,
  normalized_phone text,
  email text,
  vehicle text,
  vin text,
  plate text,
  mileage text,
  last_service text,
  notes text
);
create unique index if not exists customers_normalized_phone_unique on public.customers(normalized_phone) where normalized_phone is not null and normalized_phone <> '';
create index if not exists customers_name_idx on public.customers(name);
alter table public.customers enable row level security;

create table if not exists public.inspections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  phone text,
  email text,
  vehicle text not null,
  mileage text,
  technician text,
  overall_status text not null default 'Monitor',
  brakes_status text, brakes_notes text,
  tires_status text, tires_notes text,
  suspension_status text, suspension_notes text,
  fluids_status text, fluids_notes text,
  battery_status text, battery_notes text,
  lights_status text, lights_notes text,
  wipers_status text, wipers_notes text,
  filters_status text, filters_notes text,
  leaks_status text, leaks_notes text,
  recommendations text
);
create index if not exists inspections_created_idx on public.inspections(created_at desc);
create index if not exists inspections_customer_idx on public.inspections(customer_id);
alter table public.inspections enable row level security;

create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  direction text not null check(direction in ('incoming','outgoing')),
  customer_name text,
  phone text not null,
  message text not null,
  provider_sid text,
  status text
);
create index if not exists sms_messages_phone_idx on public.sms_messages(phone, created_at desc);
alter table public.sms_messages enable row level security;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  endpoint text not null unique,
  subscription jsonb not null
);
alter table public.push_subscriptions enable row level security;

-- Keep website and admin-created appointments synchronized with Customer Profiles.
create or replace function public.sync_appointment_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text;
  vehicle_text text;
begin
  normalized := regexp_replace(coalesce(new.phone,''), '\D', '', 'g');
  if length(normalized) = 11 and left(normalized,1) = '1' then normalized := right(normalized,10); end if;
  vehicle_text := trim(concat_ws(' ', new.year, new.make, new.model));

  if normalized <> '' then
    insert into public.customers(name,phone,normalized_phone,email,vehicle,last_service,updated_at)
    values(new.name,new.phone,normalized,nullif(new.email,''),nullif(vehicle_text,''),new.service,now())
    on conflict (normalized_phone) where normalized_phone is not null and normalized_phone <> ''
    do update set
      name = excluded.name,
      phone = excluded.phone,
      email = coalesce(excluded.email, public.customers.email),
      vehicle = coalesce(excluded.vehicle, public.customers.vehicle),
      last_service = coalesce(excluded.last_service, public.customers.last_service),
      updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_sync_customer on public.appointments;
create trigger appointments_sync_customer
after insert or update of name,phone,email,year,make,model,service
on public.appointments
for each row execute function public.sync_appointment_customer();

-- Backfill existing website appointments into Customer Profiles.
insert into public.customers(name,phone,normalized_phone,email,vehicle,last_service,updated_at)
select distinct on (regexp_replace(case when length(regexp_replace(phone,'\D','','g'))=11 and left(regexp_replace(phone,'\D','','g'),1)='1' then right(regexp_replace(phone,'\D','','g'),10) else regexp_replace(phone,'\D','','g') end,'\D','','g'))
  name,
  phone,
  case when length(regexp_replace(phone,'\D','','g'))=11 and left(regexp_replace(phone,'\D','','g'),1)='1' then right(regexp_replace(phone,'\D','','g'),10) else regexp_replace(phone,'\D','','g') end,
  nullif(email,''),
  trim(concat_ws(' ',year,make,model)),
  service,
  now()
from public.appointments
where regexp_replace(phone,'\D','','g') <> ''
order by regexp_replace(case when length(regexp_replace(phone,'\D','','g'))=11 and left(regexp_replace(phone,'\D','','g'),1)='1' then right(regexp_replace(phone,'\D','','g'),10) else regexp_replace(phone,'\D','','g') end,'\D','','g'), created_at desc
on conflict (normalized_phone) where normalized_phone is not null and normalized_phone <> '' do nothing;

-- Server-side Vercel functions use the Supabase secret/service key. No browser policies are needed.
