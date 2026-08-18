-- One-time patch for databases that already ran multi_tenant_v2.sql
-- before the appointment -> customer trigger was made tenant-aware.

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
