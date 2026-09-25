-- Transactional rehearsal: creates no permanent operational records.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','f0824571-4d65-449f-94ca-43141e712b3b',true);
insert into public.crews(id,organization_id,name,code,created_by) values
('b8277e14-1a6e-4f89-875f-37700b711201','ca95fafe-5ba6-4bde-8d95-7bc5df80cb72','Prueba temporal 1','TMP-1','f0824571-4d65-449f-94ca-43141e712b3b'),
('b8277e14-1a6e-4f89-875f-37700b711202','ca95fafe-5ba6-4bde-8d95-7bc5df80cb72','Prueba temporal 2','TMP-2','f0824571-4d65-449f-94ca-43141e712b3b'),
('b8277e14-1a6e-4f89-875f-37700b711203','ca95fafe-5ba6-4bde-8d95-7bc5df80cb72','Prueba temporal 3','TMP-3','f0824571-4d65-449f-94ca-43141e712b3b');
do $$
declare v_items jsonb; v_result jsonb; v_trip uuid; v_first uuid; v_event uuid:=gen_random_uuid(); v_driver uuid:='c84a1022-ab25-4114-85de-f286d1b06e69'; v_admin uuid:='f0824571-4d65-449f-94ca-43141e712b3b';
begin
 v_items:=jsonb_build_array(
   jsonb_build_object('farm_id','06f259e9-095b-4616-bc96-aa4d2d4e28f0','crew_id','b8277e14-1a6e-4f89-875f-37700b711201','scheduled_date',(now() at time zone 'America/Mexico_City')::date),
   jsonb_build_object('farm_id','e19f6510-5df9-44be-a818-8d0db695b1d8','crew_id','b8277e14-1a6e-4f89-875f-37700b711202','scheduled_date',(now() at time zone 'America/Mexico_City')::date),
   jsonb_build_object('farm_id','06f259e9-095b-4616-bc96-aa4d2d4e28f0','crew_id','b8277e14-1a6e-4f89-875f-37700b711203','scheduled_date',(now() at time zone 'America/Mexico_City')::date)
 );
 v_result:=public.schedule_harvest_batch('ca95fafe-5ba6-4bde-8d95-7bc5df80cb72',v_items);
 if jsonb_array_length(v_result)<>3 or (select count(*) from public.trips where harvest_order_id in
   (select (j->>'id')::uuid from jsonb_array_elements(v_result) j) and status::text='PENDING_DRIVER' and driver_id is null)<>3 then
   raise exception 'No se reservaron tres viajes separados para las tres jimas'; end if;
 v_first:=(v_result->0->>'id')::uuid;
 select id into v_trip from public.trips where harvest_order_id=v_first;
 begin
   perform set_config('app.creating_plantation_trip','yes',true);
   insert into public.trips(organization_id,origin_farm_id,harvest_order_id,status)
     select h.organization_id,h.farm_id,h.id,'PENDING_DRIVER' from public.harvest_orders h where h.id=v_first;
   raise exception 'Se permitió duplicar el viaje de una jima';
 exception when unique_violation then null;
 end;
 perform set_config('request.jwt.claim.sub',v_driver::text,true);
 if not exists(select 1 from jsonb_array_elements(public.driver_available_trips()) a where a->>'trip_id'=v_trip::text) then
   raise exception 'El chofer no ve el viaje disponible'; end if;
 if public.claim_harvest_trip(v_trip)<>'ASSIGNED' or public.claim_harvest_trip(v_trip)<>'ASSIGNED' then
   raise exception 'La toma de viaje no es confirmada o idempotente'; end if;
 if exists(select 1 from jsonb_array_elements(public.driver_available_trips()) a where a->>'trip_id'=v_trip::text) then
   raise exception 'El viaje tomado sigue disponible'; end if;
 if public.mark_trip_at_field(v_trip,v_event,now(),null,null)<>'AT_FIELD'
   or public.mark_trip_at_field(v_trip,v_event,now(),null,null)<>'AT_FIELD' then
   raise exception 'La llegada no se confirmó de forma idempotente'; end if;
 if (select count(*) from public.trip_status_events where trip_id=v_trip and new_status='AT_FIELD')<>1 then
   raise exception 'Se duplicó el evento de llegada'; end if;
 if public.advance_trip(v_trip)<>'LOADING' then raise exception 'No se inició la carga'; end if;
 begin
   perform public.advance_trip(v_trip);
   raise exception 'Se permitió salir sin lotes ni tickets';
 exception when others then
   if sqlerrm='Se permitió salir sin lotes ni tickets' then raise; end if;
 end;
 perform set_config('request.jwt.claim.sub','6925ae58-1b47-4565-9be0-849997d7c51d',true);
 begin
   perform public.claim_harvest_trip((select id from public.trips where harvest_order_id=(v_result->1->>'id')::uuid));
   raise exception 'Un jefe de cuadrilla tomó un viaje';
 exception when others then
   if sqlerrm='Un jefe de cuadrilla tomó un viaje' then raise; end if;
 end;
 perform set_config('request.jwt.claim.sub',v_admin::text,true);
 if (select count(*) from public.trips t join public.harvest_orders h on h.id=t.harvest_order_id
    join public.farms f on f.id=h.farm_id join public.crews c on c.id=h.crew_id
    where h.id in (select (j->>'id')::uuid from jsonb_array_elements(v_result) j))<>3 then
   raise exception 'El administrador no puede reconstruir las tres cadenas'; end if;
end $$;
rollback;
select 'OK: tres jimas/viajes, unicidad, visibilidad DRIVER, toma confirmada, llegada idempotente, bloqueo de salida y trazabilidad ADMIN; datos temporales revertidos' as verification;
