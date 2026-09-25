create or replace function public.can_access_trip(p_trip_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.trips t where t.id=p_trip_id and (
    public.is_admin_of_org(t.organization_id) or
    (public.is_driver_of_org(t.organization_id) and
      (t.driver_id=auth.uid() or (t.status::text='PENDING_DRIVER' and t.driver_id is null
        and exists(select 1 from public.harvest_orders h where h.id=t.harvest_order_id
          and h.scheduled_date between (now() at time zone 'America/Mexico_City')::date
            and (now() at time zone 'America/Mexico_City')::date+1
          and h.status::text not in ('CANCELLED','DRAFT'))))) or
    (public.is_crew_leader_of_org(t.organization_id) and (
      (t.harvest_order_id is not null and public.can_access_harvest(t.harvest_order_id)) or
      exists(select 1 from public.trip_lots tl join public.agave_lots al on al.id=tl.agave_lot_id
        where tl.trip_id=t.id and public.can_access_harvest(al.harvest_order_id))
    ))
  ));
$$;
