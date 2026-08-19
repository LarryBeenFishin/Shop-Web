-- Cross-session edit locks for invoice_documents.
-- Run after supabase/invoicing.sql.
begin;
create table if not exists public.invoice_edit_locks (
  shop_id uuid not null references public.shops(id) on delete cascade,
  invoice_id uuid not null references public.invoice_documents(id) on delete cascade,
  lock_token text not null,
  client_id text,
  locked_by text,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (shop_id, invoice_id)
);
create index if not exists invoice_edit_locks_expires_idx on public.invoice_edit_locks(expires_at);
alter table public.invoice_edit_locks enable row level security;
create or replace function public.acquire_invoice_edit_lock(
  p_shop_id uuid,
  p_invoice_id uuid,
  p_lock_token text,
  p_client_id text default null,
  p_locked_by text default null,
  p_ttl_seconds integer default 90
)
returns setof public.invoice_edit_locks
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  insert into public.invoice_edit_locks(shop_id,invoice_id,lock_token,client_id,locked_by,expires_at,updated_at)
  values (
    p_shop_id,p_invoice_id,p_lock_token,
    nullif(btrim(coalesce(p_client_id,'')),''),
    coalesce(nullif(btrim(coalesce(p_locked_by,'')),''),'Another admin session'),
    now()+make_interval(secs=>greatest(coalesce(p_ttl_seconds,90),30)),now()
  )
  on conflict (shop_id,invoice_id) do update
  set lock_token=excluded.lock_token,client_id=excluded.client_id,locked_by=excluded.locked_by,expires_at=excluded.expires_at,updated_at=now()
  where public.invoice_edit_locks.expires_at<=now() or public.invoice_edit_locks.lock_token=excluded.lock_token
  returning public.invoice_edit_locks.*;
end;
$$;
revoke all on function public.acquire_invoice_edit_lock(uuid,uuid,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.acquire_invoice_edit_lock(uuid,uuid,text,text,text,integer) to service_role;
commit;
