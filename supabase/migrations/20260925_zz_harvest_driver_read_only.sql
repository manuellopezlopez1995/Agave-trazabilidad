-- Separate driver read access from harvest management. can_manage_harvest
-- delegates to can_access_harvest and must never include drivers.
begin;
create or replace function public.can_access_harvest(p_harvest_order_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.harvest_orders h where h.id=p_harvest_order_id and (
   public.is_admin_of_org(h.organization_id) or
   (public.is_crew_leader_of_org(h.organization_id) and (
     (h.crew_id is not null and public.can_access_crew(h.crew_id)) or
      exists(select 1 from public.harvest_assignments ha where ha.harvest_order_id=h.id
       and ha.profile_id=auth.uid() and ha.active=true)))
 ));
$$;
create or replace function public.can_driver_read_harvest(p_harvest_order_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.trips t where t.harvest_order_id=p_harvest_order_id
   and t.driver_id=auth.uid() and public.is_driver_of_org(t.organization_id));
$$;
revoke all on function public.can_driver_read_harvest(uuid) from public, anon;
grant execute on function public.can_driver_read_harvest(uuid) to authenticated;
drop policy if exists harvest_orders_driver_read on public.harvest_orders;
create policy harvest_orders_driver_read on public.harvest_orders for select to authenticated
 using (public.can_driver_read_harvest(id));
commit;
