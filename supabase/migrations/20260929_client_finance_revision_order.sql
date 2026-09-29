-- Deterministic latest revision, including multiple adjustments in one transaction.
begin;
alter table public.trip_price_revisions add column revision_order bigint generated always as identity;
alter table public.client_price_rules add column revision_order bigint generated always as identity;

create or replace function public.finance_trip_price(p_trip uuid)
returns numeric language sql stable security definer set search_path='' as $$
 select coalesce(
 (select r.price_mxn_per_kg from public.trip_price_revisions r where r.trip_id=p_trip order by r.revision_order desc limit 1),
 (select r.price_mxn_per_kg from public.client_price_rules r join public.finance_confirmed_trips(r.organization_id) t
  on t.trip_id=p_trip and lower(t.client_name)=lower(r.client_name)
  where r.effective_on <= (t.delivered_at at time zone coalesce((select o.operational_timezone from public.organizations o where o.id=r.organization_id),'America/Mexico_City'))::date
  order by r.effective_on desc,r.revision_order desc limit 1))
 $$;
revoke all on function public.finance_trip_price(uuid) from public,anon,authenticated;
commit;
