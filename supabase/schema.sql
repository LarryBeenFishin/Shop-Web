create extension if not exists pgcrypto;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  phone text not null,
  email text,
  year text not null,
  make text not null,
  model text not null,
  service text not null,
  appointment_date date not null,
  preferred_date_label text,
  appointment_time text not null,
  appointment_time_key text not null,
  drop_off boolean not null default false,
  message text,
  marketing_opt_in boolean not null default false,
  submitted_from text,
  status text not null default 'pending' check (status in ('pending','confirmed','completed','cancelled'))
);

-- One active reservation per date/time slot. Cancelled rows are intentionally excluded.
create unique index if not exists appointments_active_slot_unique
on public.appointments (appointment_date, appointment_time_key)
where status <> 'cancelled';

create index if not exists appointments_date_idx on public.appointments (appointment_date);
create index if not exists appointments_status_idx on public.appointments (status);

alter table public.appointments enable row level security;

-- No public browser policies are required. The Vercel server functions use the service-role key.
-- Keep SUPABASE_SERVICE_ROLE_KEY server-side only.
