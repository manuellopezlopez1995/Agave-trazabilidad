-- Store the driver's current truck; trips retain their own immutable plate snapshot.
begin;
alter table public.profiles add column if not exists vehicle_plate text;
alter table public.profiles add column if not exists vehicle_plate_updated_at timestamptz;

create or replace function public.validate_driver_vehicle_plate() returns trigger
language plpgsql set search_path='' as $$
begin
 new.vehicle_plate:=nullif(upper(btrim(new.vehicle_plate)),'');
 if new.vehicle_plate is not null and (length(new.vehicle_plate) not between 3 and 25
    or new.vehicle_plate ~ '[^A-Z0-9 -]' or new.vehicle_plate !~ '[A-Z0-9]') then
  raise exception 'Escribe placas válidas: de 3 a 25 letras, números, espacios o guiones' using errcode='check_violation';
 end if;
 if new.role::text='DRIVER' and new.vehicle_plate is null then
  if tg_op='INSERT' then
   raise exception 'Las placas son obligatorias al registrar un chofer' using errcode='check_violation';
  elsif old.role::text<>'DRIVER' or old.vehicle_plate is not null then
   raise exception 'Las placas del chofer no pueden quedar vacías' using errcode='check_violation';
  end if;
 end if;
 if tg_op='INSERT' then
  new.vehicle_plate_updated_at:=case when new.vehicle_plate is not null then now() end;
 elsif new.vehicle_plate is distinct from old.vehicle_plate then
  new.vehicle_plate_updated_at:=now();
 else
  new.vehicle_plate_updated_at:=old.vehicle_plate_updated_at;
 end if;
 return new;
end $$;
create trigger validate_driver_vehicle_plate before insert or update on public.profiles
for each row execute function public.validate_driver_vehicle_plate();

-- Narrow RPC: never accepts another user id or changes role, status or membership.
create or replace function public.set_my_vehicle_plate(p_plate text) returns text
language plpgsql security definer set search_path='' as $$
declare v_plate text:=nullif(upper(btrim(p_plate)),'');
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p
  join public.organization_members m on m.profile_id=p.id
  where p.id=auth.uid() and p.role::text='DRIVER' and p.status::text='ACTIVE' and m.active) then
  raise exception 'Sólo un chofer activo puede registrar sus placas' using errcode='insufficient_privilege';
 end if;
 if v_plate is null then raise exception 'Las placas son obligatorias' using errcode='check_violation'; end if;
 update public.profiles set vehicle_plate=v_plate where id=auth.uid();
 return v_plate;
end $$;
revoke all on function public.set_my_vehicle_plate(text) from public,anon;
grant execute on function public.set_my_vehicle_plate(text) to authenticated;

-- Existing profiles with no plate are intentionally untouched and complete onboarding.
-- No UPDATE to trips: historical plates, documents and weighings remain intact.
create or replace function public.snapshot_driver_vehicle_plate() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_plate text; v_copy boolean:=false;
begin
 if new.driver_id is not null then
  if tg_op='INSERT' then v_copy:=true;
  elsif new.driver_id is distinct from old.driver_id then
   if old.status::text not in ('PENDING_DRIVER','ASSIGNED') then
    raise exception 'No se puede cambiar el camión de un viaje iniciado' using errcode='check_violation';
   end if;
   v_copy:=true;
  elsif new.vehicle_plate is distinct from old.vehicle_plate then
   if nullif(btrim(old.vehicle_plate),'') is not null or old.status::text not in ('ASSIGNED','AT_FIELD','LOADING') then
    raise exception 'Las placas guardadas en este viaje se conservan; el cambio de camión aplica a viajes nuevos' using errcode='check_violation';
   end if;
   v_copy:=true;
  end if;
 end if;
 if v_copy then
  select p.vehicle_plate into v_plate from public.profiles p
  join public.organization_members m on m.profile_id=p.id
  where p.id=new.driver_id and p.role::text='DRIVER' and p.status::text='ACTIVE'
    and m.organization_id=new.organization_id and m.active
  for share of p;
  if v_plate is null then
   raise exception 'El chofer debe registrar las placas de su camión antes de tomar un viaje' using errcode='check_violation';
  end if;
  new.vehicle_plate:=v_plate;
  select id into new.vehicle_id from public.vehicles
  where organization_id=new.organization_id and upper(btrim(plate_number))=v_plate and active
  order by created_at limit 1;
 elsif tg_op='UPDATE' and new.vehicle_plate is distinct from old.vehicle_plate then
  raise exception 'Las placas sólo se asignan junto con el chofer' using errcode='check_violation';
 end if;
 return new;
end $$;
create trigger snapshot_driver_vehicle_plate before insert or update of driver_id,vehicle_plate on public.trips
for each row execute function public.snapshot_driver_vehicle_plate();
revoke all on function public.validate_driver_vehicle_plate(),public.snapshot_driver_vehicle_plate() from public,anon,authenticated;

create or replace function public.configure_harvest_trip(p_trip_id uuid,p_destination text,p_plate text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_trip public.trips%rowtype; v_destination text:=nullif(btrim(p_destination),''); v_plate text:=nullif(upper(btrim(p_plate)),''); v_vehicle_id uuid;
begin
 select * into v_trip from public.trips where id=p_trip_id for update;
 if not found or not (public.is_admin_of_org(v_trip.organization_id) or public.can_driver_manage_trip(p_trip_id)) then raise exception 'Sin permiso para preparar esta carga' using errcode='insufficient_privilege'; end if;
 if v_trip.harvest_order_id is null or v_trip.status::text not in ('PENDING_DRIVER','ASSIGNED','AT_FIELD','LOADING') then raise exception 'El viaje ya salió o es histórico' using errcode='check_violation'; end if;
 if not public.is_admin_of_org(v_trip.organization_id) and v_trip.driver_id is distinct from auth.uid() then raise exception 'Sólo el chofer asignado puede preparar este viaje' using errcode='insufficient_privilege'; end if;
 if v_trip.destination_id is not null then
  if v_destination is distinct from v_trip.destination_name then raise exception 'El destino fue fijado por administración' using errcode='insufficient_privilege'; end if;
  v_destination:=v_trip.destination_name;
 elsif not public.is_admin_of_org(v_trip.organization_id) then
  if v_trip.destination_name is null or v_destination is distinct from v_trip.destination_name then
   raise exception 'Sólo administración puede definir el destino de un viaje histórico' using errcode='insufficient_privilege';
  end if;
 end if;
 -- Use the trip snapshot even if the driver later changes trucks. Only legacy
 -- unconfigured trips may fill an empty snapshot from the current profile.
 if nullif(btrim(v_trip.vehicle_plate),'') is not null then
  if v_plate is not null and v_plate is distinct from v_trip.vehicle_plate then
   raise exception 'Las placas del viaje ya están guardadas' using errcode='check_violation';
  end if;
  v_plate:=v_trip.vehicle_plate;
 elsif v_trip.driver_id is not null then
  select vehicle_plate into v_plate from public.profiles where id=v_trip.driver_id;
 else
  raise exception 'Asigna primero un chofer con placas registradas' using errcode='check_violation';
 end if;
 if v_destination is null or length(v_destination)>120 or v_plate is null or length(v_plate)>25 then raise exception 'Indica destino y placa válidos' using errcode='check_violation'; end if;
 if exists(select 1 from public.deliveries d where d.trip_id=p_trip_id and (d.status::text<>'PENDING' or lower(btrim(d.recipient_company))<>lower(v_destination))) then raise exception 'La entrega existente tiene otro comprador o ya fue cerrada' using errcode='check_violation'; end if;
 select id into v_vehicle_id from public.vehicles where organization_id=v_trip.organization_id and upper(btrim(plate_number))=v_plate and active order by created_at limit 1;
 update public.trips set destination_name=v_destination,vehicle_plate=v_plate,vehicle_id=v_vehicle_id where id=p_trip_id;
 insert into public.deliveries(organization_id,trip_id,recipient_company,status,created_by)
 values(v_trip.organization_id,p_trip_id,v_destination,'PENDING',auth.uid()) on conflict(trip_id) do nothing;
 return p_trip_id;
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
  if found then
    perform public.configure_harvest_trip(p_trip_id,(select destination_name from public.trips where id=p_trip_id),null);
    return 'ASSIGNED';
  end if;
  if exists(select 1 from public.trips where id=p_trip_id and driver_id=v_driver and status::text='ASSIGNED')
    then return 'ASSIGNED'; end if;
  raise exception 'Otro chofer ya tomó este viaje o dejó de estar disponible' using errcode='check_violation';
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
    if nullif(btrim(v_trip.destination_name),'') is not null then
      perform public.configure_harvest_trip(p_trip_id,v_trip.destination_name,null);
    end if;
  end if;
  return 'ASSIGNED';
end $$;


notify pgrst, 'reload schema';
commit;
