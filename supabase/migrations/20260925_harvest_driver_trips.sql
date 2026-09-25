-- Link new harvests to exactly one reserved trip. Historical trips remain untouched.
begin;

alter table public.trips add column if not exists harvest_order_id uuid references public.harvest_orders(id) on delete restrict;
alter table public.trips add column if not exists assigned_at timestamptz;
alter table public.trips add column if not exists at_field_at timestamptz;
create unique index if not exists trips_one_per_harvest on public.trips(harvest_order_id) where harvest_order_id is not null;
alter table public.trips add constraint trip_harvest_pending_driver_consistency
  check (status::text <> 'PENDING_DRIVER' or driver_id is null);

create or replace function public.validate_harvest_trip_link() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.harvest_order_id is not null and not exists (
    select 1 from public.harvest_orders h where h.id=new.harvest_order_id
      and h.organization_id=new.organization_id and h.farm_id=new.origin_farm_id
  ) then
    raise exception 'El viaje debe corresponder a la misma jima, organización y plantación' using errcode='check_violation';
  end if;
  if tg_op='UPDATE' and old.harvest_order_id is distinct from new.harvest_order_id then
    raise exception 'No se puede cambiar la jima de un viaje' using errcode='check_violation';
  end if;
  return new;
end $$;
create trigger validate_harvest_trip before insert or update of harvest_order_id,organization_id,origin_farm_id
on public.trips for each row execute function public.validate_harvest_trip_link();

-- Trigger runs inside schedule_harvest_batch's transaction, so either every
-- harvest and reserved trip is committed or none of them is.
create or replace function public.reserve_harvest_trip() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_plantation text; v_sequence integer;
begin
  if new.status::text not in ('ASSIGNED','PLANNED','SCHEDULED') then return new; end if;
  select plantation_id into v_plantation from public.farms
    where id=new.farm_id and organization_id=new.organization_id for update;
  if not found then raise exception 'Predio de jima inexistente'; end if;
  select coalesce(max(plantation_trip_number),0)+1 into v_sequence
    from public.trips where origin_farm_id=new.farm_id;
  perform set_config('app.creating_plantation_trip','yes',true);
  insert into public.trips(organization_id,origin_farm_id,harvest_order_id,status,
    plantation_folio,plantation_trip_number,created_by)
  values(new.organization_id,new.farm_id,new.id,'PENDING_DRIVER',
    case when v_plantation is null then null else v_plantation||'-'||v_sequence end,
    case when v_plantation is null then null else v_sequence end,new.created_by)
  on conflict (harvest_order_id) where harvest_order_id is not null do nothing;
  return new;
end $$;
create trigger reserve_trip_for_harvest after insert on public.harvest_orders
for each row execute function public.reserve_harvest_trip();

-- A lot joins its originating trip when the crew closes that lot. Existing
-- historical lots and trips do not change.
create or replace function public.link_completed_lot_to_harvest_trip() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_trip uuid;
begin
  if new.status::text <> 'HARVESTED' then return new; end if;
  select t.id into v_trip from public.trips t where t.harvest_order_id=new.harvest_order_id
    and t.organization_id=new.organization_id and t.origin_farm_id=new.farm_id;
  if v_trip is not null then
    insert into public.trip_lots(trip_id,agave_lot_id,loaded_weight_kg,loaded_agave_count,created_by)
    values(v_trip,new.id,new.actual_weight_kg,new.agave_count,auth.uid())
    on conflict (agave_lot_id) do nothing;
  end if;
  return new;
end $$;
create trigger link_harvested_lot_to_trip after update of status on public.agave_lots
for each row when (new.status is distinct from old.status)
execute function public.link_completed_lot_to_harvest_trip();

-- Preserve the previous protections on harvests and deliveries.
create or replace function public.enforce_pilot_status_transitions() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.status::text=old.status::text then return new; end if;
  if tg_table_name='harvest_orders' and not (
    (old.status::text='ASSIGNED' and new.status::text='IN_PROGRESS') or
    (old.status::text='IN_PROGRESS' and new.status::text='HARVESTED')
  ) then raise exception 'Transición de jima no permitida: % -> %',old.status,new.status using errcode='check_violation';
  elsif tg_table_name='trips' and not (
    (old.status::text='PENDING_DRIVER' and new.status::text='ASSIGNED' and new.driver_id is not null) or
    (old.status::text='ASSIGNED' and new.status::text='AT_FIELD' and old.harvest_order_id is not null) or
    (old.status::text='ASSIGNED' and new.status::text='LOADING' and old.harvest_order_id is null) or
    (old.status::text='AT_FIELD' and new.status::text='LOADING') or
    (old.status::text='LOADING' and new.status::text='IN_TRANSIT') or
    (old.status::text='IN_TRANSIT' and new.status::text='ARRIVED') or
    (old.status::text='ARRIVED' and new.status::text='DELIVERED')
  ) then raise exception 'Transición de viaje no permitida: % -> %',old.status,new.status using errcode='check_violation';
  elsif tg_table_name='deliveries' and not (
    old.status::text='PENDING' and new.status::text='COMPLETED'
  ) then raise exception 'Transición de entrega no permitida: % -> %',old.status,new.status using errcode='check_violation';
  end if;
  return new;
end $$;

-- Unclaimed trips are readable only by active drivers in the same organization.
-- Crew leaders retain their old lot-based access and gain their linked harvest.
create or replace function public.can_access_trip(p_trip_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.trips t where t.id=p_trip_id and (
    public.is_admin_of_org(t.organization_id) or
    (public.is_driver_of_org(t.organization_id) and
      (t.driver_id=auth.uid() or (t.status::text='PENDING_DRIVER' and t.driver_id is null))) or
    (public.is_crew_leader_of_org(t.organization_id) and (
      (t.harvest_order_id is not null and public.can_access_harvest(t.harvest_order_id)) or
      exists(select 1 from public.trip_lots tl join public.agave_lots al on al.id=tl.agave_lot_id
        where tl.trip_id=t.id and public.can_access_harvest(al.harvest_order_id))
    ))
  ));
$$;
create or replace function public.can_access_harvest(p_harvest_order_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.harvest_orders h where h.id=p_harvest_order_id and (
   public.is_admin_of_org(h.organization_id) or
   (public.is_crew_leader_of_org(h.organization_id) and (
     (h.crew_id is not null and public.can_access_crew(h.crew_id)) or
     exists(select 1 from public.harvest_assignments ha where ha.harvest_order_id=h.id
       and ha.profile_id=auth.uid() and ha.active=true))) or
   (public.is_driver_of_org(h.organization_id) and exists(
      select 1 from public.trips t where t.harvest_order_id=h.id and t.driver_id=auth.uid()))
 ));
$$;

create table public.trip_status_events (
  id uuid primary key default gen_random_uuid(), event_key uuid not null unique,
  organization_id uuid not null references public.organizations(id),
  trip_id uuid not null references public.trips(id) on delete restrict,
  harvest_order_id uuid references public.harvest_orders(id) on delete restrict,
  farm_id uuid references public.farms(id) on delete restrict,
  actor_id uuid references public.profiles(id),
  old_status text, new_status text not null,
  event_type text not null, captured_at timestamptz,
  latitude numeric, longitude numeric, recorded_at timestamptz not null default now(),
  check (latitude between -90 and 90 and longitude between -180 and 180 or latitude is null and longitude is null)
);
create index trip_status_events_trip_time on public.trip_status_events(trip_id,recorded_at);
alter table public.trip_status_events enable row level security;
create policy trip_status_events_read on public.trip_status_events for select to authenticated
using (public.can_access_trip(trip_id));
grant select on public.trip_status_events to authenticated;
revoke insert,update,delete on public.trip_status_events from authenticated,anon;

create or replace function public.audit_trip_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_key text; v_lat text; v_lon text; v_captured text;
begin
  if tg_op='UPDATE' and new.status=old.status and new.driver_id is not distinct from old.driver_id then return new; end if;
  v_key:=nullif(current_setting('app.trip_event_id',true),'');
  v_lat:=nullif(current_setting('app.trip_latitude',true),'');
  v_lon:=nullif(current_setting('app.trip_longitude',true),'');
  v_captured:=nullif(current_setting('app.trip_captured_at',true),'');
  insert into public.trip_status_events(event_key,organization_id,trip_id,harvest_order_id,farm_id,
    actor_id,old_status,new_status,event_type,captured_at,latitude,longitude)
  values(coalesce(v_key::uuid,gen_random_uuid()),new.organization_id,new.id,new.harvest_order_id,new.origin_farm_id,
    auth.uid(),case when tg_op='INSERT' then null else old.status::text end,new.status::text,
    case when tg_op='UPDATE' and new.status=old.status then 'DRIVER_REASSIGNED' else 'STATUS_CHANGED' end,
    coalesce(v_captured::timestamptz,now()),v_lat::numeric,v_lon::numeric);
  return new;
end $$;
create trigger audit_trip_creation after insert on public.trips for each row execute function public.audit_trip_change();
create trigger audit_trip_status after update of status,driver_id on public.trips for each row execute function public.audit_trip_change();

create or replace function public.driver_available_trips() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_result jsonb;
begin
  select m.organization_id into v_org from public.organization_members m
   join public.profiles p on p.id=m.profile_id
   where m.profile_id=auth.uid() and m.active and p.role::text='DRIVER' and p.status::text='ACTIVE';
  if v_org is null then raise exception 'Se requiere un chofer activo' using errcode='insufficient_privilege'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('trip_id',t.id,'trip_code',t.trace_code,
    'folio',t.plantation_folio,'harvest_id',h.id,'harvest_code',h.trace_code,
    'farm',f.name,'plantation_id',f.plantation_id,'crew',c.name,'date',h.scheduled_date)
    order by h.scheduled_date,h.trace_code),'[]'::jsonb) into v_result
  from public.trips t join public.harvest_orders h on h.id=t.harvest_order_id
   join public.farms f on f.id=h.farm_id left join public.crews c on c.id=h.crew_id
  where t.organization_id=v_org and h.organization_id=v_org
    and t.driver_id is null and t.status::text='PENDING_DRIVER'
    and h.status::text not in ('CANCELLED','DRAFT')
    and h.scheduled_date between (now() at time zone 'America/Mexico_City')::date
      and (now() at time zone 'America/Mexico_City')::date+1;
  return v_result;
end $$;

create or replace function public.claim_harvest_trip(p_trip_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_driver uuid:=auth.uid();
begin
  select organization_id into v_org from public.trips where id=p_trip_id;
  if v_org is null or v_driver is null or not public.is_driver_of_org(v_org)
     or not exists(select 1 from public.profiles where id=v_driver and role::text='DRIVER' and status::text='ACTIVE') then
    raise exception 'Chofer sin permiso en esta organización' using errcode='insufficient_privilege';
  end if;
  update public.trips t set driver_id=v_driver,status='ASSIGNED',assigned_at=now()
  where t.id=p_trip_id and t.organization_id=v_org and t.harvest_order_id is not null
    and t.driver_id is null and t.status::text='PENDING_DRIVER'
    and exists(select 1 from public.harvest_orders h where h.id=t.harvest_order_id
      and h.scheduled_date between (now() at time zone 'America/Mexico_City')::date
        and (now() at time zone 'America/Mexico_City')::date+1
      and h.status::text not in ('CANCELLED','DRAFT'));
  if found then return 'ASSIGNED'; end if;
  -- A network retry from the winning driver is harmless.
  if exists(select 1 from public.trips where id=p_trip_id and driver_id=v_driver and status::text='ASSIGNED')
    then return 'ASSIGNED'; end if;
  raise exception 'Otro chofer ya tomó este viaje o dejó de estar disponible' using errcode='check_violation';
end $$;

create or replace function public.mark_trip_at_field(p_trip_id uuid,p_event_id uuid,
  p_captured_at timestamptz default null,p_latitude numeric default null,p_longitude numeric default null)
returns text language plpgsql security definer set search_path='' as $$
declare v_trip public.trips%rowtype;
begin
  if p_event_id is null then raise exception 'Identificador de evento obligatorio'; end if;
  select * into v_trip from public.trips where id=p_trip_id for update;
  if not found or v_trip.driver_id is distinct from auth.uid()
    or not public.is_driver_of_org(v_trip.organization_id) then
    raise exception 'No eres el chofer asignado' using errcode='insufficient_privilege';
  end if;
  if exists(select 1 from public.trip_status_events where event_key=p_event_id and trip_id=p_trip_id
    and actor_id=auth.uid() and new_status='AT_FIELD') then return 'AT_FIELD'; end if;
  if v_trip.status::text<>'ASSIGNED' or v_trip.harvest_order_id is null then
    raise exception 'El viaje no admite registrar llegada al predio' using errcode='check_violation';
  end if;
  if (p_latitude is null) <> (p_longitude is null)
    or p_latitude is not null and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180) then
    raise exception 'Ubicación inválida'; end if;
  if p_captured_at is not null and (p_captured_at>now()+interval '5 minutes' or p_captured_at<now()-interval '7 days')
    then raise exception 'Fecha de captura fuera de rango'; end if;
  perform set_config('app.trip_event_id',p_event_id::text,true);
  perform set_config('app.trip_latitude',coalesce(p_latitude::text,''),true);
  perform set_config('app.trip_longitude',coalesce(p_longitude::text,''),true);
  perform set_config('app.trip_captured_at',coalesce(p_captured_at::text,''),true);
  update public.trips set status='AT_FIELD',at_field_at=now() where id=p_trip_id;
  perform set_config('app.trip_event_id','',true);
  perform set_config('app.trip_latitude','',true);
  perform set_config('app.trip_longitude','',true);
  perform set_config('app.trip_captured_at','',true);
  return 'AT_FIELD';
end $$;

create or replace function public.assign_harvest_trip_driver(p_trip_id uuid,p_driver_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare v_trip public.trips%rowtype;
begin
  select * into v_trip from public.trips where id=p_trip_id for update;
  if not found or not public.is_admin_of_org(v_trip.organization_id) then
    raise exception 'Sólo el administrador de la organización puede asignar' using errcode='insufficient_privilege'; end if;
  if v_trip.harvest_order_id is null or v_trip.status::text not in ('PENDING_DRIVER','ASSIGNED') then
    raise exception 'Ya comenzó el trabajo del chofer; no se puede reasignar' using errcode='check_violation'; end if;
  if not exists(select 1 from public.profiles p join public.organization_members m on m.profile_id=p.id
    where p.id=p_driver_id and p.role::text='DRIVER' and p.status::text='ACTIVE'
      and m.organization_id=v_trip.organization_id and m.active) then
    raise exception 'Chofer no activo en la organización' using errcode='check_violation'; end if;
  if v_trip.driver_id is distinct from p_driver_id then
    update public.trips set driver_id=p_driver_id,status='ASSIGNED',assigned_at=now() where id=p_trip_id;
  end if;
  return 'ASSIGNED';
end $$;

create or replace function public.configure_harvest_trip(p_trip_id uuid,p_destination text,p_plate text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_trip public.trips%rowtype; v_destination text:=nullif(btrim(p_destination),''); v_plate text:=nullif(upper(btrim(p_plate)),'');
begin
  select * into v_trip from public.trips where id=p_trip_id for update;
  if not found or not public.is_admin_of_org(v_trip.organization_id) then
    raise exception 'Sin permiso para preparar la carga' using errcode='insufficient_privilege'; end if;
  if v_trip.harvest_order_id is null or v_trip.status::text not in ('PENDING_DRIVER','ASSIGNED','AT_FIELD') then
    raise exception 'El viaje ya salió o es histórico'; end if;
  if v_destination is null or length(v_destination)>120 or v_plate is null or length(v_plate)>25 then
    raise exception 'Indica comprador/destino y placa válidos'; end if;
  update public.trips set destination_name=v_destination,vehicle_plate=v_plate where id=p_trip_id;
  insert into public.deliveries(organization_id,trip_id,recipient_company,status,created_by)
    select v_trip.organization_id,p_trip_id,v_destination,'PENDING',auth.uid()
    where not exists(select 1 from public.deliveries where trip_id=p_trip_id);
  return p_trip_id;
end $$;

-- Existing trips still start loading at ASSIGNED; new trips need the field event.
create or replace function public.advance_trip(p_trip_id uuid) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status text; v_org uuid; v_harvest uuid;
begin
  select status::text,organization_id,harvest_order_id into v_status,v_org,v_harvest
    from public.trips where id=p_trip_id for update;
  if not found then raise exception 'El viaje no existe'; end if;
  if not public.is_admin_of_org(v_org) and not public.can_driver_manage_trip(p_trip_id) then
    raise exception 'No tienes permiso para administrar este viaje' using errcode='insufficient_privilege'; end if;
  if v_status='AT_FIELD' or (v_status='ASSIGNED' and v_harvest is null) then
    update public.trips set status='LOADING',loaded_at=now() where id=p_trip_id; return 'LOADING';
  elsif v_status='LOADING' then
    if not exists(select 1 from public.trip_lots where trip_id=p_trip_id) then raise exception 'Asigna al menos un lote antes de salir'; end if;
    if exists(select 1 from public.trip_lots tl join public.agave_lots l on l.id=tl.agave_lot_id
      where tl.trip_id=p_trip_id and l.status::text<>'HARVESTED') then raise exception 'Todos los lotes deben estar cosechados antes de salir'; end if;
    if not exists(select 1 from public.weighings where trip_id=p_trip_id and weighing_type::text='ORIGIN') then raise exception 'Registra el pesaje de origen antes de salir'; end if;
    if v_harvest is not null and not exists(select 1 from public.trips t join public.deliveries d on d.trip_id=t.id
      where t.id=p_trip_id and t.driver_id is not null and nullif(btrim(t.vehicle_plate),'') is not null
        and nullif(btrim(t.destination_name),'') is not null) then raise exception 'Faltan chofer, placa, destino y entrega'; end if;
    update public.trips set status='IN_TRANSIT',departed_at=now() where id=p_trip_id; return 'IN_TRANSIT';
  elsif v_status='IN_TRANSIT' then
    update public.trips set status='ARRIVED',arrived_at=now() where id=p_trip_id; return 'ARRIVED';
  end if;
  raise exception 'El viaje no puede avanzar desde el estado %',v_status using errcode='check_violation';
end $$;

revoke all on function public.driver_available_trips() from public,anon;
revoke all on function public.claim_harvest_trip(uuid) from public,anon;
revoke all on function public.mark_trip_at_field(uuid,uuid,timestamptz,numeric,numeric) from public,anon;
revoke all on function public.assign_harvest_trip_driver(uuid,uuid) from public,anon;
revoke all on function public.configure_harvest_trip(uuid,text,text) from public,anon;
grant execute on function public.driver_available_trips() to authenticated;
grant execute on function public.claim_harvest_trip(uuid) to authenticated;
grant execute on function public.mark_trip_at_field(uuid,uuid,timestamptz,numeric,numeric) to authenticated;
grant execute on function public.assign_harvest_trip_driver(uuid,uuid) to authenticated;
grant execute on function public.configure_harvest_trip(uuid,text,text) to authenticated;
commit;
