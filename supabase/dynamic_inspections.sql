-- Dynamic inspection blocks + customer vehicle linkage.
-- Run once after customer_vehicles.sql.

begin;

alter table public.inspections
  add column if not exists vehicle_id uuid references public.customer_vehicles(id) on delete set null,
  add column if not exists inspection_items jsonb not null default '[]'::jsonb;

create index if not exists inspections_shop_vehicle_idx
  on public.inspections(shop_id, vehicle_id, created_at desc);

-- Backfill vehicle_id for existing inspections where the vehicle text matches
-- a saved customer vehicle exactly by year/make/model.
update public.inspections i
set vehicle_id = cv.id
from public.customer_vehicles cv
where i.vehicle_id is null
  and i.customer_id is not null
  and i.shop_id = cv.shop_id
  and i.customer_id = cv.customer_id
  and lower(btrim(i.vehicle)) = lower(btrim(concat_ws(' ', cv.year, cv.make, cv.model)));

commit;
