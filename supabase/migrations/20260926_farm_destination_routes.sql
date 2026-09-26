-- New routes only. Existing farms, harvests and trips retain NULL locations.
begin;
alter table public.farms add column if not exists latitude numeric(10,7), add column if not exists longitude numeric(10,7), add column if not exists location_reference text;
alter table public.farms add constraint farms_location_pair check ((latitude is null)=(longitude is null) and (latitude is null or latitude between -90 and 90 and longitude between -180 and 180));

create table public.destinations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 name text not null check (length(btrim(name)) between 2 and 120),
 buyer_name text not null check (length(btrim(buyer_name)) between 2 and 120),
 address text, latitude numeric(10,7) not null check (latitude between -90 and 90),
 longitude numeric(10,7) not null check (longitude between -180 and 180),
 active boolean not null default true, created_at timestamptz not null default now(),
 created_by uuid references public.profiles(id), unique(organization_id,id)
);
alter table public.destinations enable row level security;
grant select,insert,update on public.destinations to authenticated;
create policy destinations_admin_select on public.destinations for select to authenticated using (public.is_admin_of_org(organization_id));
create policy destinations_admin_insert on public.destinations for insert to authenticated with check (public.is_admin_of_org(organization_id) and created_by=auth.uid());
create policy destinations_admin_update on public.destinations for update to authenticated using (public.is_admin_of_org(organization_id)) with check (public.is_admin_of_org(organization_id));

alter table public.harvest_orders add column if not exists destination_id uuid references public.destinations(id);
alter table public.trips add column if not exists destination_id uuid references public.destinations(id),
 add column if not exists origin_latitude numeric(10,7), add column if not exists origin_longitude numeric(10,7),
 add column if not exists origin_reference text, add column if not exists destination_label text,
 add column if not exists destination_address text, add column if not exists destination_latitude numeric(10,7),
 add column if not exists destination_longitude numeric(10,7);

-- The existing reserve_trip_for_harvest trigger calls this function. Folio logic is unchanged.
create or replace function public.reserve_harvest_trip() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_farm public.farms%rowtype; v_dest public.destinations%rowtype; v_sequence integer;
begin
 if new.status::text not in ('ASSIGNED','PLANNED','SCHEDULED') then return new; end if;
 if new.destination_id is null then raise exception 'Selecciona una fábrica antes de programar la jima' using errcode='check_violation'; end if;
 select * into v_farm from public.farms where id=new.farm_id and organization_id=new.organization_id for update;
 if not found then raise exception 'Predio de jima inexistente'; end if;
 if new.destination_id is not null then
  select * into v_dest from public.destinations where id=new.destination_id and organization_id=new.organization_id and active;
  if not found then raise exception 'Destino no disponible en la organización' using errcode='check_violation'; end if;
  if v_farm.latitude is null or v_farm.longitude is null then raise exception 'Registra la ubicación del predio antes de programar' using errcode='check_violation'; end if;
 end if;
 select coalesce(max(plantation_trip_number),0)+1 into v_sequence from public.trips where origin_farm_id=new.farm_id;
 perform set_config('app.creating_plantation_trip','yes',true);
 insert into public.trips(organization_id,origin_farm_id,harvest_order_id,status,
  plantation_folio,plantation_trip_number,created_by,destination_id,destination_name,destination_label,
  destination_address,destination_latitude,destination_longitude,origin_latitude,origin_longitude,origin_reference)
 values(new.organization_id,new.farm_id,new.id,'PENDING_DRIVER',
  case when v_farm.plantation_id is null then null else v_farm.plantation_id||'-'||v_sequence end,
  case when v_farm.plantation_id is null then null else v_sequence end,new.created_by,new.destination_id,
  case when new.destination_id is null then null else v_dest.buyer_name end,
  case when new.destination_id is null then null else v_dest.name end,
  case when new.destination_id is null then null else v_dest.address end,
  case when new.destination_id is null then null else v_dest.latitude end,
  case when new.destination_id is null then null else v_dest.longitude end,
  v_farm.latitude,v_farm.longitude,v_farm.location_reference)
 on conflict (harvest_order_id) where harvest_order_id is not null do nothing;
 return new;
end $$;

-- Admin batch chooses each destination independently. A missing farm location is rejected atomically.
create or replace function public.schedule_harvest_batch(p_organization_id uuid,p_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; item_number integer:=0; farm uuid; crew uuid; dest uuid; planned_date date; date_text text;
 result jsonb:='[]'::jsonb; created record;
begin
 if auth.uid() is null or not public.is_admin_of_org(p_organization_id) then raise exception 'No tienes permiso para programar jimas en esta organización' using errcode='insufficient_privilege'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Programa de 1 a 50 jimas por operación' using errcode='check_violation'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  item_number:=item_number+1;
  if jsonb_typeof(item)<>'object' or coalesce(item->>'farm_id','')='' or coalesce(item->>'crew_id','')='' or coalesce(item->>'scheduled_date','')='' or coalesce(item->>'destination_id','')='' then
   raise exception 'Faltan predio, cuadrilla, fecha o destino en la jima %',item_number using errcode='check_violation'; end if;
  farm:=(item->>'farm_id')::uuid; crew:=(item->>'crew_id')::uuid; dest:=(item->>'destination_id')::uuid; date_text:=item->>'scheduled_date';
  if date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Fecha inválida en la jima %',item_number using errcode='check_violation'; end if;
  planned_date:=to_date(date_text,'YYYY-MM-DD');
  if to_char(planned_date,'YYYY-MM-DD')<>date_text then raise exception 'Fecha inválida en la jima %',item_number using errcode='check_violation'; end if;
  if not exists(select 1 from public.farms f where f.id=farm and f.organization_id=p_organization_id and f.active and f.latitude is not null and f.longitude is not null) then
   raise exception 'Registra la ubicación del predio de la jima %',item_number using errcode='check_violation'; end if;
  if not exists(select 1 from public.crews c where c.id=crew and c.organization_id=p_organization_id and c.active) then raise exception 'Cuadrilla no disponible en la jima %',item_number using errcode='check_violation'; end if;
  if not exists(select 1 from public.destinations d where d.id=dest and d.organization_id=p_organization_id and d.active) then raise exception 'Destino no disponible en la jima %',item_number using errcode='check_violation'; end if;
  begin
   insert into public.harvest_orders(organization_id,farm_id,crew_id,scheduled_date,status,created_by,destination_id)
   values(p_organization_id,farm,crew,planned_date,'ASSIGNED',auth.uid(),dest) returning id,trace_code into created;
  exception when unique_violation then raise exception 'La cuadrilla de la jima % ya está programada para esa fecha',item_number using errcode='unique_violation'; end;
  result:=result||jsonb_build_array(jsonb_build_object('id',created.id,'trace_code',created.trace_code));
 end loop;
 return result;
end $$;

-- Preserve legacy journeys without a structured destination. Booked journeys have an immutable route.
create or replace function public.protect_booked_trip_route() returns trigger language plpgsql set search_path='' as $$
begin
 if old.destination_id is not null and (new.destination_id is distinct from old.destination_id
  or new.destination_name is distinct from old.destination_name or new.destination_label is distinct from old.destination_label
  or new.destination_address is distinct from old.destination_address or new.destination_latitude is distinct from old.destination_latitude
  or new.destination_longitude is distinct from old.destination_longitude or new.origin_latitude is distinct from old.origin_latitude
  or new.origin_longitude is distinct from old.origin_longitude or new.origin_reference is distinct from old.origin_reference) then
   raise exception 'El origen y destino programados no pueden cambiarse durante el viaje' using errcode='insufficient_privilege';
 end if;
 return new;
end $$;
create trigger protect_booked_trip_route before update on public.trips for each row execute function public.protect_booked_trip_route();

create or replace function public.driver_available_trips() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_result jsonb; v_today date;
begin
 select m.organization_id into v_org from public.organization_members m join public.profiles p on p.id=m.profile_id
 where m.profile_id=auth.uid() and m.active and p.role::text='DRIVER' and p.status::text='ACTIVE';
 if v_org is null then raise exception 'Se requiere un chofer activo' using errcode='insufficient_privilege'; end if;
 v_today:=public.organization_work_date(v_org);
 select coalesce(jsonb_agg(jsonb_build_object('trip_id',t.id,'trip_code',t.trace_code,
  'folio',t.plantation_folio,'harvest_id',h.id,'harvest_code',h.trace_code,
  'farm',f.name,'plantation_id',f.plantation_id,'crew',c.name,'date',h.scheduled_date,
  'origin_latitude',t.origin_latitude,'origin_longitude',t.origin_longitude,'origin_reference',t.origin_reference,
  'destination_label',t.destination_label,'destination_address',t.destination_address,
  'destination_latitude',t.destination_latitude,'destination_longitude',t.destination_longitude)
  order by h.scheduled_date,h.trace_code),'[]'::jsonb) into v_result
 from public.trips t join public.harvest_orders h on h.id=t.harvest_order_id
 join public.farms f on f.id=h.farm_id left join public.crews c on c.id=h.crew_id
 where t.organization_id=v_org and h.organization_id=v_org and t.driver_id is null and t.status::text='PENDING_DRIVER'
  and h.status::text not in ('CANCELLED','DRAFT') and h.scheduled_date between v_today and v_today+1;
 return v_result;
end $$;

-- Same operational setup: only the plate remains user supplied for a booked journey.
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
 end if;
 if v_destination is null or length(v_destination)>120 or v_plate is null or length(v_plate)>25 then raise exception 'Indica destino y placa válidos' using errcode='check_violation'; end if;
 if exists(select 1 from public.deliveries d where d.trip_id=p_trip_id and (d.status::text<>'PENDING' or lower(btrim(d.recipient_company))<>lower(v_destination))) then raise exception 'La entrega existente tiene otro comprador o ya fue cerrada' using errcode='check_violation'; end if;
 select id into v_vehicle_id from public.vehicles where organization_id=v_trip.organization_id and upper(btrim(plate_number))=v_plate and active order by created_at limit 1;
 update public.trips set destination_name=v_destination,vehicle_plate=v_plate,vehicle_id=v_vehicle_id where id=p_trip_id;
 insert into public.deliveries(organization_id,trip_id,recipient_company,status,created_by)
 values(v_trip.organization_id,p_trip_id,v_destination,'PENDING',auth.uid()) on conflict(trip_id) do nothing;
 return p_trip_id;
end $$;
commit;
