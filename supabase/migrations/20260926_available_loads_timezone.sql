-- Operational date belongs to the organization, not to the browser's locale.
alter table public.organizations
  add column if not exists operational_timezone text not null default 'America/Mexico_City';

create or replace function public.validate_organization_timezone() returns trigger
language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.operational_timezone) then
    raise exception 'Zona horaria operativa inválida: %',new.operational_timezone using errcode='check_violation';
  end if;
  return new;
end $$;
drop trigger if exists validate_organization_timezone on public.organizations;
create trigger validate_organization_timezone before insert or update of operational_timezone
 on public.organizations for each row execute function public.validate_organization_timezone();

create or replace function public.organization_work_date(p_organization_id uuid) returns date
language sql stable security definer set search_path='' as $$
 select (now() at time zone o.operational_timezone)::date
 from public.organizations o where o.id=p_organization_id;
$$;
revoke all on function public.organization_work_date(uuid) from public,anon;
grant execute on function public.organization_work_date(uuid) to authenticated;

create or replace function public.can_access_trip(p_trip_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.trips t where t.id=p_trip_id and (
   public.is_admin_of_org(t.organization_id) or
   (public.is_driver_of_org(t.organization_id) and
     (t.driver_id=auth.uid() or (t.status::text='PENDING_DRIVER' and t.driver_id is null
       and exists(select 1 from public.harvest_orders h where h.id=t.harvest_order_id
         and h.scheduled_date between public.organization_work_date(t.organization_id)
           and public.organization_work_date(t.organization_id)+1
         and h.status::text not in ('CANCELLED','DRAFT'))))) or
   (public.is_crew_leader_of_org(t.organization_id) and (
     (t.harvest_order_id is not null and public.can_access_harvest(t.harvest_order_id)) or
     exists(select 1 from public.trip_lots tl join public.agave_lots al on al.id=tl.agave_lot_id
       where tl.trip_id=t.id and public.can_access_harvest(al.harvest_order_id))
   ))
 ));
$$;

create or replace function public.driver_operational_calendar() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_org uuid; v_today date; v_zone text;
begin
  select m.organization_id into v_org from public.organization_members m
   join public.profiles p on p.id=m.profile_id
   where m.profile_id=auth.uid() and m.active and p.role::text='DRIVER' and p.status::text='ACTIVE';
  if v_org is null then raise exception 'Se requiere un chofer activo' using errcode='insufficient_privilege'; end if;
  select o.operational_timezone into v_zone from public.organizations o where o.id=v_org;
  v_today:=public.organization_work_date(v_org);
  return jsonb_build_object('today',v_today,'tomorrow',v_today+1,'timezone',v_zone);
end $$;
revoke all on function public.driver_operational_calendar() from public,anon;
grant execute on function public.driver_operational_calendar() to authenticated;

create or replace function public.driver_available_trips() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_result jsonb; v_today date;
begin
  select m.organization_id into v_org from public.organization_members m
   join public.profiles p on p.id=m.profile_id
   where m.profile_id=auth.uid() and m.active and p.role::text='DRIVER' and p.status::text='ACTIVE';
  if v_org is null then raise exception 'Se requiere un chofer activo' using errcode='insufficient_privilege'; end if;
  v_today:=public.organization_work_date(v_org);
  select coalesce(jsonb_agg(jsonb_build_object('trip_id',t.id,'trip_code',t.trace_code,
    'folio',t.plantation_folio,'harvest_id',h.id,'harvest_code',h.trace_code,
    'farm',f.name,'plantation_id',f.plantation_id,'crew',c.name,'date',h.scheduled_date)
    order by h.scheduled_date,h.trace_code),'[]'::jsonb) into v_result
  from public.trips t join public.harvest_orders h on h.id=t.harvest_order_id
   join public.farms f on f.id=h.farm_id left join public.crews c on c.id=h.crew_id
  where t.organization_id=v_org and h.organization_id=v_org
    and t.driver_id is null and t.status::text='PENDING_DRIVER'
    and h.status::text not in ('CANCELLED','DRAFT')
    and h.scheduled_date between v_today and v_today+1;
  return v_result;
end $$;

create or replace function public.claim_harvest_trip(p_trip_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_driver uuid:=auth.uid(); v_today date;
begin
  select organization_id into v_org from public.trips where id=p_trip_id;
  if v_org is null or v_driver is null or not public.is_driver_of_org(v_org)
     or not exists(select 1 from public.profiles where id=v_driver and role::text='DRIVER' and status::text='ACTIVE') then
    raise exception 'Chofer sin permiso en esta organización' using errcode='insufficient_privilege';
  end if;
  v_today:=public.organization_work_date(v_org);
  -- The conditional update remains atomic: only one driver can win.
  update public.trips t set driver_id=v_driver,status='ASSIGNED',assigned_at=now()
  where t.id=p_trip_id and t.organization_id=v_org and t.harvest_order_id is not null
    and t.driver_id is null and t.status::text='PENDING_DRIVER'
    and exists(select 1 from public.harvest_orders h where h.id=t.harvest_order_id
      and h.scheduled_date between v_today and v_today+1
      and h.status::text not in ('CANCELLED','DRAFT'));
  if found then return 'ASSIGNED'; end if;
  if exists(select 1 from public.trips where id=p_trip_id and driver_id=v_driver and status::text='ASSIGNED')
    then return 'ASSIGNED'; end if;
  raise exception 'Otro chofer ya tomó este viaje o dejó de estar disponible' using errcode='check_violation';
end $$;

-- An advance reservation stays ASSIGNED; only a real field arrival changes state.
create or replace function public.mark_trip_at_field(p_trip_id uuid,p_event_id uuid,
  p_captured_at timestamptz default null,p_latitude numeric default null,p_longitude numeric default null)
returns text language plpgsql security definer set search_path='' as $$
declare v_trip public.trips%rowtype; v_scheduled date;
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
  select scheduled_date into v_scheduled from public.harvest_orders where id=v_trip.harvest_order_id;
  if v_scheduled>public.organization_work_date(v_trip.organization_id) then
    raise exception 'Esta carga está reservada para otro día; aún no puede iniciarse' using errcode='check_violation';
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
