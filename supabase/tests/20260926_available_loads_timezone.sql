-- Rehearsal on live roles and farms, fully rolled back. No operational rows remain.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','f0824571-4d65-449f-94ca-43141e712b3b',true);
insert into public.crews(id,organization_id,name,code,created_by) values
 ('e15cf611-bf8c-4d8a-9271-44cc30f9c401','ca95fafe-5ba6-4bde-8d95-7bc5df80cb72','Ensayo turno 1','TMP-LOAD-1','f0824571-4d65-449f-94ca-43141e712b3b'),
 ('e15cf611-bf8c-4d8a-9271-44cc30f9c402','ca95fafe-5ba6-4bde-8d95-7bc5df80cb72','Ensayo turno 2','TMP-LOAD-2','f0824571-4d65-449f-94ca-43141e712b3b'),
 ('e15cf611-bf8c-4d8a-9271-44cc30f9c403','ca95fafe-5ba6-4bde-8d95-7bc5df80cb72','Ensayo turno 3','TMP-LOAD-3','f0824571-4d65-449f-94ca-43141e712b3b');
do $$
declare v_org uuid:='ca95fafe-5ba6-4bde-8d95-7bc5df80cb72';
 v_driver uuid:='c84a1022-ab25-4114-85de-f286d1b06e69';
 v_today date; v_rows jsonb; v_trip uuid; v_calendar jsonb; v_available jsonb;
begin
 v_today:=public.organization_work_date(v_org);
 if (select operational_timezone from public.organizations where id=v_org)<>'America/Mexico_City'
   then raise exception 'Zona horaria predeterminada incorrecta'; end if;
 v_rows:=public.schedule_harvest_batch(v_org,jsonb_build_array(
   jsonb_build_object('farm_id','06f259e9-095b-4616-bc96-aa4d2d4e28f0','crew_id','e15cf611-bf8c-4d8a-9271-44cc30f9c401','scheduled_date',v_today),
   jsonb_build_object('farm_id','e19f6510-5df9-44be-a818-8d0db695b1d8','crew_id','e15cf611-bf8c-4d8a-9271-44cc30f9c402','scheduled_date',v_today+1),
   jsonb_build_object('farm_id','06f259e9-095b-4616-bc96-aa4d2d4e28f0','crew_id','e15cf611-bf8c-4d8a-9271-44cc30f9c403','scheduled_date',v_today+2)));
 if (select count(*) from public.trips where harvest_order_id in
   (select (j->>'id')::uuid from jsonb_array_elements(v_rows) j))<>3 then
   raise exception 'Faltan viajes automáticos'; end if;
 select id into v_trip from public.trips where harvest_order_id=(v_rows->1->>'id')::uuid;
 perform set_config('request.jwt.claim.sub',v_driver::text,true);
 v_calendar:=public.driver_operational_calendar();
 if v_calendar->>'today'<>v_today::text or v_calendar->>'tomorrow'<>(v_today+1)::text
   then raise exception 'Calendario de la organización incorrecto'; end if;
 v_available:=public.driver_available_trips();
 if (select count(*) from jsonb_array_elements(v_available) a
   where (a->>'harvest_id')::uuid in (select (j->>'id')::uuid from jsonb_array_elements(v_rows) j))<>2
   then raise exception 'Sólo hoy y mañana deben estar disponibles'; end if;
 if public.claim_harvest_trip(v_trip)<>'ASSIGNED' then raise exception 'No se reservó la carga de mañana'; end if;
 if not exists(select 1 from public.trips where id=v_trip and driver_id=v_driver
   and status::text='ASSIGNED' and assigned_at is not null and at_field_at is null)
   then raise exception 'La reserva inició el viaje indebidamente'; end if;
 if exists(select 1 from jsonb_array_elements(public.driver_available_trips()) a where a->>'trip_id'=v_trip::text)
   then raise exception 'La reserva sigue visible para otros'; end if;
 begin
  perform public.mark_trip_at_field(v_trip,gen_random_uuid(),now(),null,null);
  raise exception 'Se permitió iniciar antes de la fecha programada';
 exception when check_violation then
  if sqlerrm='Se permitió iniciar antes de la fecha programada' then raise; end if;
 end;
 if exists(select 1 from public.trip_status_events where trip_id=v_trip and new_status='AT_FIELD')
   then raise exception 'Se registró llegada prematura'; end if;
end $$;
rollback;
select 'OK: hoy + mañana visibles, pasado mañana oculto, reserva de mañana ASSIGNED sin llegada, intento temprano denegado; ensayo revertido' as verification;
