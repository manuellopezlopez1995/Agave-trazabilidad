-- A booked harvest trip may reach LOADING before its destination and truck are known.
-- Let its assigned driver prepare the existing trip and its one pending delivery.
create or replace function public.configure_harvest_trip(p_trip_id uuid,p_destination text,p_plate text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_trip public.trips%rowtype;
  v_destination text:=nullif(btrim(p_destination),'');
  v_plate text:=nullif(upper(btrim(p_plate)),'');
  v_vehicle_id uuid;
begin
  select * into v_trip from public.trips where id=p_trip_id for update;
  if not found or not (public.is_admin_of_org(v_trip.organization_id) or public.can_driver_manage_trip(p_trip_id)) then
    raise exception 'Sin permiso para preparar esta carga' using errcode='insufficient_privilege';
  end if;
  if v_trip.harvest_order_id is null or v_trip.status::text not in ('PENDING_DRIVER','ASSIGNED','AT_FIELD','LOADING') then
    raise exception 'El viaje ya salió o es histórico' using errcode='check_violation';
  end if;
  if not public.is_admin_of_org(v_trip.organization_id) and v_trip.driver_id is distinct from auth.uid() then
    raise exception 'Sólo el chofer asignado puede preparar este viaje' using errcode='insufficient_privilege';
  end if;
  if v_destination is null or length(v_destination)>120 or v_plate is null or length(v_plate)>25 then
    raise exception 'Indica comprador/destino y placa válidos' using errcode='check_violation';
  end if;
  if exists(select 1 from public.deliveries d where d.trip_id=p_trip_id
       and (d.status::text<>'PENDING' or lower(btrim(d.recipient_company))<>lower(v_destination))) then
    raise exception 'La entrega existente tiene otro comprador o ya fue cerrada' using errcode='check_violation';
  end if;

  select id into v_vehicle_id from public.vehicles
    where organization_id=v_trip.organization_id and upper(btrim(plate_number))=v_plate and active
    order by created_at limit 1;
  update public.trips set destination_name=v_destination,vehicle_plate=v_plate,vehicle_id=v_vehicle_id
    where id=p_trip_id;
  insert into public.deliveries(organization_id,trip_id,recipient_company,status,created_by)
    values(v_trip.organization_id,p_trip_id,v_destination,'PENDING',auth.uid())
    on conflict (trip_id) do nothing;
  return p_trip_id;
end $$;

-- Keep existing transitions, but report the specific missing requirement.
create or replace function public.advance_trip(p_trip_id uuid) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_trip public.trips%rowtype;
begin
  select * into v_trip from public.trips where id=p_trip_id for update;
  if not found then raise exception 'El viaje no existe'; end if;
  if not public.is_admin_of_org(v_trip.organization_id) and not public.can_driver_manage_trip(p_trip_id) then
    raise exception 'No tienes permiso para administrar este viaje' using errcode='insufficient_privilege'; end if;
  if v_trip.status::text='AT_FIELD' or (v_trip.status::text='ASSIGNED' and v_trip.harvest_order_id is null) then
    update public.trips set status='LOADING',loaded_at=now() where id=p_trip_id; return 'LOADING';
  elsif v_trip.status::text='LOADING' then
    if not exists(select 1 from public.trip_lots where trip_id=p_trip_id) then raise exception 'Asigna al menos un lote antes de salir'; end if;
    if exists(select 1 from public.trip_lots tl join public.agave_lots l on l.id=tl.agave_lot_id
      where tl.trip_id=p_trip_id and l.status::text<>'HARVESTED') then raise exception 'Todos los lotes deben estar cosechados antes de salir'; end if;
    if not exists(select 1 from public.weighings where trip_id=p_trip_id and weighing_type::text='ORIGIN') then raise exception 'Registra el pesaje de origen antes de salir'; end if;
    if v_trip.harvest_order_id is not null then
      if v_trip.driver_id is null then raise exception 'Asigna un chofer antes de salir'; end if;
      if nullif(btrim(v_trip.vehicle_plate),'') is null then raise exception 'Registra la placa antes de salir'; end if;
      if nullif(btrim(v_trip.destination_name),'') is null then raise exception 'Registra el destino antes de salir'; end if;
      if not exists(select 1 from public.deliveries d where d.trip_id=p_trip_id
          and d.organization_id=v_trip.organization_id and d.status::text='PENDING'
          and lower(btrim(d.recipient_company))=lower(btrim(v_trip.destination_name))) then
        raise exception 'Prepara la entrega pendiente para este destino antes de salir'; end if;
    end if;
    update public.trips set status='IN_TRANSIT',departed_at=now() where id=p_trip_id; return 'IN_TRANSIT';
  elsif v_trip.status::text='IN_TRANSIT' then
    update public.trips set status='ARRIVED',arrived_at=now() where id=p_trip_id; return 'ARRIVED';
  end if;
  raise exception 'El viaje no puede avanzar desde el estado %',v_trip.status using errcode='check_violation';
end $$;
