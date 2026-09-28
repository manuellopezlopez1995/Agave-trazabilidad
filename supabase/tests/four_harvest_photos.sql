-- Isolated PRUEBA OFFLINE fixture; every row and Storage metadata is rolled back.
begin;
create temporary table four_photo_checks(result text);
do $$
declare base public.harvest_orders%rowtype; h uuid:=gen_random_uuid(); l uuid:=gen_random_uuid(); actor uuid:='6925ae58-1b47-4565-9be0-849997d7c51d';
        path text; i integer; before_real jsonb; next_number integer; plantation text;
begin
 select * into strict base from public.harvest_orders where id='538e4012-b036-4df5-9570-8a7dcbdc0d77';
 select to_jsonb(t) into before_real from public.trips t where plantation_folio='098765-1';
 insert into public.harvest_orders(id,trace_code,organization_id,farm_id,crew_id,status,scheduled_date,destination_id)
 values(h,'PRUEBA OFFLINE CUATRO FOTOS',base.organization_id,base.farm_id,base.crew_id,'IN_PROGRESS',public.organization_work_date(base.organization_id)+1,base.destination_id);
 select plantation_id into plantation from public.farms where id=base.farm_id;
 select coalesce(max(plantation_trip_number),0)+1 into next_number from public.trips where origin_farm_id=base.farm_id;
 insert into public.trips(trace_code,organization_id,origin_farm_id,harvest_order_id,status,destination_id,destination_name,plantation_trip_number,plantation_folio)
 values('PRUEBA OFFLINE CUATRO FOTOS',base.organization_id,base.farm_id,h,'PENDING_DRIVER',base.destination_id,'PRUEBA OFFLINE',next_number,plantation||'-'||next_number);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into public.agave_lots(id,organization_id,harvest_order_id,farm_id,agave_count,average_brix,actual_weight_kg,harvest_date,created_by)
 values(l,base.organization_id,h,base.farm_id,10,36,null,public.organization_work_date(base.organization_id)+1,actor);
 for i in 1..4 loop
  path:=base.organization_id::text||'/'||h::text||'/'||actor::text||'/'||gen_random_uuid()::text||'.jpg';
  insert into storage.objects(bucket_id,name,owner,metadata)
  select bucket_id,path,owner,metadata from storage.objects
  where bucket_id='harvest-evidence' and name like base.organization_id::text||'/%' limit 1;
  if not found then raise exception 'No hay objeto de plantilla en la organización de prueba'; end if;
  insert into public.harvest_evidence(harvest_order_id,agave_lot_id,evidence_type,storage_bucket,storage_path,mime_type,file_size_bytes,captured_at,uploaded_by)
  values(h,case when i in (2,4) then l else null end,'PHOTO','harvest-evidence',path,'image/jpeg',100,now(),actor);
  if i=3 then
   perform set_config('request.jwt.claim.sub',actor::text,true);set local role authenticated;
   begin
    perform public.advance_harvest(h);
    raise exception 'FAIL: cerró con una sola foto de °Brix';
   exception when check_violation then null; end;
   reset role;
   if (select status::text from public.harvest_orders where id=h)<>'IN_PROGRESS' then raise exception 'FAIL: cambió el estado antes de cuatro fotos'; end if;
   insert into four_photo_checks values('PASS: 2 jima + 1 Brix rechazado sin cambiar estado');
  end if;
 end loop;
 perform set_config('request.jwt.claim.sub',actor::text,true);set local role authenticated;
 if public.advance_harvest(h)<>'HARVESTED' then raise exception 'FAIL: cuatro fotos no cerraron'; end if;
 reset role;
 if (select count(*) from public.harvest_evidence e join storage.objects o on o.bucket_id=e.storage_bucket and o.name=e.storage_path where e.harvest_order_id=h)<>4 then raise exception 'FAIL: faltan archivos'; end if;
 if (select to_jsonb(t) from public.trips t where plantation_folio='098765-1')<>before_real then raise exception 'FAIL: viaje histórico modificado'; end if;
 insert into four_photo_checks values('PASS: 2 jima + 2 Brix cerró con rol jefe'),('PASS: cuatro objetos y viaje 098765-1 intacto');
end $$;
select * from four_photo_checks;
rollback;
