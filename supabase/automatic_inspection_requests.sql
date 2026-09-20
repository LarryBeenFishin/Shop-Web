-- Enables automatic, initially unassigned inspection requests for online appointments.
-- Run once after technician_portal.sql.

begin;

alter table public.inspection_requests
  alter column technician_id drop not null,
  add column if not exists appointment_id uuid references public.appointments(id) on delete cascade;

alter table public.inspection_requests
  drop column if exists due_date;

create unique index if not exists inspection_requests_appointment_unique
  on public.inspection_requests (appointment_id)
  where appointment_id is not null;

-- Include upcoming website appointments that already exist when this migration runs.
insert into public.inspection_requests (
  shop_id,
  appointment_id,
  technician_id,
  customer_id,
  vehicle_id,
  customer_name,
  phone,
  email,
  vehicle,
  request_notes,
  status
)
select
  a.shop_id,
  a.id,
  null,
  a.customer_id,
  a.vehicle_id,
  a.name,
  a.phone,
  a.email,
  trim(concat_ws(' ', a.year, a.make, a.model)),
  concat_ws(E'\n',
    case when nullif(trim(a.service), '') is not null then 'Service: ' || trim(a.service) end,
    case when nullif(trim(a.message), '') is not null then 'Customer concern: ' || trim(a.message) end
  ),
  'requested'
from public.appointments a
where a.shop_id is not null
  and coalesce(a.submitted_from, '') <> 'Admin Dashboard'
  and a.status <> 'cancelled'
  and a.appointment_date >= current_date
  and not exists (
    select 1
    from public.inspection_requests r
    where r.appointment_id = a.id
  );

commit;
