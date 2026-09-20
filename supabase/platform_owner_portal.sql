-- Platform owner portal for managing every shop from one secure workspace.
-- Run once after multi_tenant_v2.sql and technician_portal.sql.

begin;

create table if not exists public.shop_admin_accounts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  name text not null,
  username text not null,
  password_hash text not null,
  active boolean not null default true,
  constraint shop_admin_accounts_username_format check (username ~ '^[a-z0-9._-]{3,40}$'),
  constraint shop_admin_accounts_shop_username_unique unique (shop_id, username)
);
create index if not exists shop_admin_accounts_shop_active_idx
  on public.shop_admin_accounts(shop_id, active);
alter table public.shop_admin_accounts enable row level security;

create table if not exists public.shop_migrations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null unique references public.shops(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source text,
  status text not null default 'not_started'
    check (status in ('not_started','ready','in_progress','review','completed')),
  notes text
);
create index if not exists shop_migrations_status_idx on public.shop_migrations(status);
alter table public.shop_migrations enable row level security;

create table if not exists public.platform_audit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  shop_id uuid references public.shops(id) on delete set null,
  actor text not null default 'platform_owner',
  action text not null,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists platform_audit_events_created_idx
  on public.platform_audit_events(created_at desc);
create index if not exists platform_audit_events_shop_idx
  on public.platform_audit_events(shop_id, created_at desc);
alter table public.platform_audit_events enable row level security;

insert into public.shop_migrations(shop_id, source, status)
select id, 'Existing Shop-Web data', 'review'
from public.shops
on conflict (shop_id) do nothing;

commit;

-- These tables are intentionally accessed only by server-side functions using
-- the Supabase service role. No browser policies are created.
