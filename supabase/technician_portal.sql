-- Technician accounts and assigned inspection requests.
-- Run once after multi_tenant_v2.sql, customer_vehicles.sql, and dynamic_inspections.sql.

begin;

create table if not exists public.technician_accounts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  username text not null,
  password_hash text not null,
  active boolean not null default true
);

create unique index if not exists technician_accounts_shop_username_unique
  on public.technician_accounts (shop_id, lower(username));
create index if not exists technician_accounts_shop_active_idx
  on public.technician_accounts (shop_id, active, name);
alter table public.technician_accounts enable row level security;

create table if not exists public.inspection_requests (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'requested'
    check (status in ('requested','in_progress','completed','cancelled')),
  technician_id uuid not null references public.technician_accounts(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  vehicle_id uuid references public.customer_vehicles(id) on delete set null,
  customer_name text not null,
  phone text,
  email text,
  vehicle text not null,
  mileage text,
  request_notes text,
  started_at timestamptz,
  completed_at timestamptz,
  inspection_id uuid references public.inspections(id) on delete set null
);

create index if not exists inspection_requests_shop_status_idx
  on public.inspection_requests (shop_id, status, created_at desc);
create index if not exists inspection_requests_technician_status_idx
  on public.inspection_requests (technician_id, status, created_at desc);
create index if not exists inspection_requests_customer_vehicle_idx
  on public.inspection_requests (shop_id, customer_id, vehicle_id, created_at desc);
alter table public.inspection_requests enable row level security;

alter table public.inspections
  add column if not exists technician_id uuid references public.technician_accounts(id) on delete set null,
  add column if not exists inspection_request_id uuid references public.inspection_requests(id) on delete set null;

create index if not exists inspections_shop_technician_idx
  on public.inspections (shop_id, technician_id, created_at desc);
create unique index if not exists inspections_request_unique
  on public.inspections (inspection_request_id)
  where inspection_request_id is not null;

commit;
