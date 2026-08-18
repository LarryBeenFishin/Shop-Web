-- Multi-tenant invoicing for Shop-Web.
-- Run once after multi_tenant_v2.sql and customer_vehicles.sql.

begin;

create table if not exists public.invoice_settings (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  labor_rate numeric(12,2) not null default 150.00,
  parts_tax_rate numeric(7,4) not null default 0.00,
  parts_markup_percent numeric(7,2) not null default 50.00,
  shop_supplies_percent numeric(7,2) not null default 0.00,
  document_prefix text not null default 'RO',
  footer_message text,
  updated_at timestamptz not null default now()
);
alter table public.invoice_settings enable row level security;

create table if not exists public.invoice_counters (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  prefix text not null default 'RO',
  next_number bigint not null default 1000 check (next_number > 0),
  updated_at timestamptz not null default now()
);
alter table public.invoice_counters enable row level security;

create table if not exists public.invoice_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  shop_id uuid not null references public.shops(id) on delete restrict,
  parent_invoice_id uuid references public.invoice_documents(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  vehicle_id uuid references public.customer_vehicles(id) on delete set null,

  document_number text,
  status text not null default 'Draft',
  payment_status text not null default 'Unpaid',

  customer_name text,
  customer_phone text,
  customer_email text,
  vehicle text,
  vin text,
  plate text,
  mileage text,
  opened_date date,
  promise_date date,
  advisor text,
  concern text,
  recommendations text,
  internal_notes text,

  lines jsonb not null default '[]'::jsonb,
  payments jsonb not null default '[]'::jsonb,
  totals jsonb not null default '{}'::jsonb,

  labor_total numeric(12,2) not null default 0,
  parts_total numeric(12,2) not null default 0,
  fees_total numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  shop_supplies_total numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  subtotal numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  paid numeric(12,2) not null default 0,
  balance numeric(12,2) not null default 0,
  read_only boolean not null default false,

  constraint invoice_documents_status_check check (
    status in ('Draft','Estimate','Repair Order','Invoice','Revision','Closed','Cancelled')
  ),
  constraint invoice_documents_payment_status_check check (
    payment_status in ('Unpaid','Paid','Partial')
  )
);
create unique index if not exists invoice_documents_shop_number_unique
  on public.invoice_documents(shop_id, document_number)
  where document_number is not null and btrim(document_number) <> '';
create index if not exists invoice_documents_shop_updated_idx
  on public.invoice_documents(shop_id, updated_at desc);
create index if not exists invoice_documents_customer_idx
  on public.invoice_documents(shop_id, customer_id, updated_at desc);
create index if not exists invoice_documents_vehicle_idx
  on public.invoice_documents(shop_id, vehicle_id, updated_at desc);
create index if not exists invoice_documents_status_idx
  on public.invoice_documents(shop_id, status, updated_at desc);
alter table public.invoice_documents enable row level security;

create table if not exists public.invoice_presets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  preset_type text not null,
  name text not null,
  payload jsonb not null default '{}'::jsonb,
  constraint invoice_presets_type_check check (
    preset_type in ('Canned Job','Fee','Discount')
  )
);
create index if not exists invoice_presets_shop_type_idx
  on public.invoice_presets(shop_id, preset_type, updated_at desc);
alter table public.invoice_presets enable row level security;

create or replace function public.next_invoice_document_number(
  p_shop_id uuid,
  p_prefix text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_number bigint;
begin
  if p_shop_id is null then
    raise exception 'shop id is required';
  end if;

  insert into public.invoice_counters(shop_id, prefix, next_number, updated_at)
  values (
    p_shop_id,
    coalesce(nullif(btrim(p_prefix),''),'RO'),
    1001,
    now()
  )
  on conflict (shop_id) do update
  set prefix = coalesce(nullif(btrim(p_prefix),''), public.invoice_counters.prefix),
      next_number = public.invoice_counters.next_number + 1,
      updated_at = now()
  returning prefix, next_number - 1 into v_prefix, v_number;

  return v_prefix || '-' || lpad(v_number::text, 4, '0');
end;
$$;

-- Seed settings and counters for existing active shops without overwriting anything.
insert into public.invoice_settings(shop_id)
select id from public.shops
on conflict (shop_id) do nothing;

insert into public.invoice_counters(shop_id)
select id from public.shops
on conflict (shop_id) do nothing;

commit;
