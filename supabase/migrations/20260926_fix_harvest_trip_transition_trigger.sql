-- The transition trigger runs on harvest_orders, trips and deliveries.
-- Select the relation first: a harvest_orders NEW row has no driver_id.
create or replace function public.enforce_pilot_status_transitions() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.status::text=old.status::text then return new; end if;

  if tg_table_name='harvest_orders' then
    if not (
      (old.status::text='ASSIGNED' and new.status::text='IN_PROGRESS') or
      (old.status::text='IN_PROGRESS' and new.status::text='HARVESTED')
    ) then
      raise exception 'Transición de jima no permitida: % -> %',old.status,new.status using errcode='check_violation';
    end if;
  elsif tg_table_name='trips' then
    if not (
      (old.status::text='PENDING_DRIVER' and new.status::text='ASSIGNED' and new.driver_id is not null) or
      (old.status::text='ASSIGNED' and new.status::text='AT_FIELD' and old.harvest_order_id is not null) or
      (old.status::text='ASSIGNED' and new.status::text='LOADING' and old.harvest_order_id is null) or
      (old.status::text='AT_FIELD' and new.status::text='LOADING') or
      (old.status::text='LOADING' and new.status::text='IN_TRANSIT') or
      (old.status::text='IN_TRANSIT' and new.status::text='ARRIVED') or
      (old.status::text='ARRIVED' and new.status::text='DELIVERED')
    ) then
      raise exception 'Transición de viaje no permitida: % -> %',old.status,new.status using errcode='check_violation';
    end if;
  elsif tg_table_name='deliveries' then
    if not (old.status::text='PENDING' and new.status::text='COMPLETED') then
      raise exception 'Transición de entrega no permitida: % -> %',old.status,new.status using errcode='check_violation';
    end if;
  end if;

  return new;
end $$;
