begin;
alter table public.organizations add column if not exists is_offline_test boolean not null default false;
create table public.offline_test_runs(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 title text not null default 'PRUEBA OFFLINE', status text not null default 'PENDIENTE' check(status in ('PENDIENTE','EN_CURSO','PARCIAL','APROBADA','FALLIDA')),
 app_version text,harvest_id uuid references public.harvest_orders(id),trip_id uuid references public.trips(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),summary text not null default ''
);
create table public.offline_test_steps(
 id uuid primary key default gen_random_uuid(),run_id uuid not null references public.offline_test_runs(id),
 step_key text not null,title text not null,expected text not null,observed text not null default '',
 status text not null default 'PENDIENTE' check(status in ('PENDIENTE','APROBADA','FALLIDA','LIMITACION')),
 environment text not null,evidence jsonb not null default '{}',recorded_at timestamptz not null default now(),
 unique(run_id,step_key)
);
alter table public.offline_test_runs enable row level security;
alter table public.offline_test_steps enable row level security;
create policy offline_test_runs_read on public.offline_test_runs for select to authenticated using(exists(select 1 from public.organization_members m join public.profiles p on p.id=m.profile_id where m.organization_id=offline_test_runs.organization_id and m.profile_id=auth.uid() and m.active and p.status::text='ACTIVE'));
create policy offline_test_runs_admin on public.offline_test_runs for all to authenticated using(public.is_admin_of_org(organization_id)) with check(public.is_admin_of_org(organization_id) and exists(select 1 from public.organizations where id=organization_id and is_offline_test));
create policy offline_test_steps_read on public.offline_test_steps for select to authenticated using(exists(select 1 from public.offline_test_runs r where r.id=run_id));
create policy offline_test_steps_admin on public.offline_test_steps for all to authenticated using(exists(select 1 from public.offline_test_runs r where r.id=run_id and public.is_admin_of_org(r.organization_id))) with check(exists(select 1 from public.offline_test_runs r where r.id=run_id and public.is_admin_of_org(r.organization_id)));
grant select,insert,update on public.offline_test_runs,public.offline_test_steps to authenticated;
revoke all on public.offline_test_runs,public.offline_test_steps from anon;
create or replace function public.offline_context(p_practice boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
 select jsonb_build_object('organization_id',o.id,'name',o.name,'is_test',o.is_offline_test,'timezone',o.operational_timezone)
 into v_result from public.organization_members m join public.organizations o on o.id=m.organization_id join public.profiles p on p.id=m.profile_id
 where m.profile_id=auth.uid() and m.active and p.status::text='ACTIVE' and o.is_offline_test=p_practice order by m.joined_at,o.id limit 1;
 if v_result is null then raise exception 'No tienes acceso a este espacio de trabajo' using errcode='insufficient_privilege'; end if;
 return v_result;
end $$;
create or replace function public.driver_available_trips_in_org(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_today date;
begin
 if not public.is_driver_of_org(p_org) then raise exception 'Chofer sin permiso' using errcode='insufficient_privilege'; end if;
 v_today:=public.organization_work_date(p_org);
 select coalesce(jsonb_agg(jsonb_build_object('trip_id',t.id,'trip_code',t.trace_code,'folio',t.plantation_folio,'harvest_id',h.id,'harvest_code',h.trace_code,
 'farm',f.name,'plantation_id',f.plantation_id,'crew',c.name,'date',h.scheduled_date,
 'origin_latitude',t.origin_latitude,'origin_longitude',t.origin_longitude,'origin_reference',t.origin_reference,
 'destination_label',t.destination_label,'destination_address',t.destination_address,'destination_latitude',t.destination_latitude,'destination_longitude',t.destination_longitude)
 order by h.scheduled_date,h.trace_code),'[]'::jsonb) into v_result
 from public.trips t join public.harvest_orders h on h.id=t.harvest_order_id join public.farms f on f.id=h.farm_id left join public.crews c on c.id=h.crew_id
 where t.organization_id=p_org and h.organization_id=p_org and t.driver_id is null and t.status::text='PENDING_DRIVER'
 and h.status::text not in ('CANCELLED','DRAFT') and h.scheduled_date between v_today and v_today+1;
 return v_result;
end $$;
revoke all on function public.offline_context(boolean),public.driver_available_trips_in_org(uuid) from public,anon;
grant execute on function public.offline_context(boolean),public.driver_available_trips_in_org(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
