-- Multi-vehicle support for Shop-Web customers.
-- Run once after multi_tenant_v2.sql and fix_tenant_customer_sync.sql.

begin;

create table if not exists public.customer_vehicles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  shop_id uuid not null references public.shops(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete cascade,
  year text not null,
  make text not null,
  model text not null,
  vin text,
  plate text,
  mileage text,
  nickname text,
  last_service text
);

create index if not exists customer_vehicles_customer_idx
  on public.customer_vehicles(shop_id, customer_id, last_seen_at desc);
create index if not exists customer_vehicles_vehicle_idx
  on public.customer_vehicles(shop_id, year, make, model);
create unique index if not exists customer_vehicles_shop_vin_unique
  on public.customer_vehicles(shop_id, lower(vin))
  where vin is not null and btrim(vin) <> '';

alter table public.customer_vehicles enable row level security;

alter table public.appointments
  add column if not exists vehicle_id uuid references public.customer_vehicles(id) on delete set null;
create index if not exists appointments_shop_vehicle_idx
  on public.appointments(shop_id, vehicle_id, appointment_date desc);

-- Backfill one saved vehicle for each distinct historical customer/YMM combination.
insert into public.customer_vehicles (
  shop_id, customer_id, year, make, model, last_service, last_seen_at, updated_at
)
select distinct on (a.shop_id, a.customer_id, a.year, a.make, a.model)
  a.shop_id,
  a.customer_id,
  a.year,
  a.make,
  a.model,
  a.service,
  coalesce(a.updated_at, a.created_at, now()),
  now()
from public.appointments a
where a.customer_id is not null
  and nullif(btrim(a.year),'') is not null
  and nullif(btrim(a.make),'') is not null
  and nullif(btrim(a.model),'') is not null
  and upper(btrim(a.year)) <> 'N/A'
  and upper(btrim(a.make)) <> 'N/A'
  and upper(btrim(a.model)) <> 'N/A'
  and not exists (
    select 1
    from public.customer_vehicles cv
    where cv.shop_id = a.shop_id
      and cv.customer_id = a.customer_id
      and cv.year = a.year
      and cv.make = a.make
      and cv.model = a.model
  )
order by a.shop_id, a.customer_id, a.year, a.make, a.model, a.appointment_date desc, a.created_at desc;

update public.appointments a
set vehicle_id = cv.id
from public.customer_vehicles cv
where a.vehicle_id is null
  and a.shop_id = cv.shop_id
  and a.customer_id = cv.customer_id
  and a.year = cv.year
  and a.make = cv.make
  and a.model = cv.model;

-- Replace the customer-sync trigger with a tenant-aware customer + vehicle sync.
create or replace function public.sync_appointment_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text;
  vehicle_text text;
  customer_pk uuid;
  vehicle_pk uuid;
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
    returning id into customer_pk;

    new.customer_id := customer_pk;

    if nullif(btrim(new.year),'') is not null
       and nullif(btrim(new.make),'') is not null
       and nullif(btrim(new.model),'') is not null
       and upper(btrim(new.year)) <> 'N/A'
       and upper(btrim(new.make)) <> 'N/A'
       and upper(btrim(new.model)) <> 'N/A' then

      if new.vehicle_id is not null then
        select id into vehicle_pk
        from public.customer_vehicles
        where id = new.vehicle_id
          and shop_id = new.shop_id
          and customer_id = customer_pk
        limit 1;
      end if;

      if vehicle_pk is null then
        select id into vehicle_pk
        from public.customer_vehicles
        where shop_id = new.shop_id
          and customer_id = customer_pk
          and year = new.year
          and make = new.make
          and model = new.model
        order by last_seen_at desc
        limit 1;
      end if;

      if vehicle_pk is null then
        insert into public.customer_vehicles(
          shop_id,customer_id,year,make,model,last_service,last_seen_at,updated_at
        ) values (
          new.shop_id,customer_pk,new.year,new.make,new.model,new.service,now(),now()
        ) returning id into vehicle_pk;
      else
        update public.customer_vehicles
        set last_service = coalesce(nullif(new.service,''),last_service),
            last_seen_at = now(),
            updated_at = now()
        where id = vehicle_pk;
      end if;

      new.vehicle_id := vehicle_pk;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_sync_customer on public.appointments;
create trigger appointments_sync_customer
before insert or update of name,phone,email,year,make,model,service,shop_id,vehicle_id
on public.appointments
for each row execute function public.sync_appointment_customer();

commit;
