-- Account recovery, appointment text consent, and permission-based campaigns.
-- Run once after platform_owner_portal.sql and technician_portal.sql.

begin;

alter table public.shop_admin_accounts
  add column if not exists email text;

alter table public.technician_accounts
  add column if not exists email text;

alter table public.appointments
  add column if not exists sms_confirmation_opt_in boolean not null default false;

alter table public.customers
  add column if not exists email_marketing_opt_in boolean not null default false,
  add column if not exists sms_marketing_opt_in boolean not null default false,
  add column if not exists email_unsubscribed_at timestamptz,
  add column if not exists sms_unsubscribed_at timestamptz,
  add column if not exists marketing_consent_at timestamptz;

create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  shop_id uuid not null references public.shops(id) on delete cascade,
  account_role text not null check (account_role in ('owner','technician')),
  account_id uuid not null,
  token_hash text not null unique
);
create index if not exists password_reset_tokens_account_idx
  on public.password_reset_tokens(shop_id, account_role, account_id, created_at desc);
create index if not exists password_reset_tokens_expiry_idx
  on public.password_reset_tokens(expires_at) where used_at is null;
alter table public.password_reset_tokens enable row level security;

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  shop_id uuid not null references public.shops(id) on delete cascade,
  subject text,
  message text not null,
  channels text[] not null default '{}',
  email_recipients integer not null default 0,
  sms_recipients integer not null default 0,
  email_sent integer not null default 0,
  sms_sent integer not null default 0,
  failed integer not null default 0,
  status text not null default 'sending' check (status in ('sending','sent','partial','failed'))
);
create index if not exists marketing_campaigns_shop_created_idx
  on public.marketing_campaigns(shop_id, created_at desc);
alter table public.marketing_campaigns enable row level security;

commit;

-- These tables and recovery email fields are accessed only by server-side
-- functions using the Supabase service role. No browser policies are created.
