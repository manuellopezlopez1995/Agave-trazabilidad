-- Prueba negativa transaccional para el viaje piloto que ya tiene foto PPE.
-- El cambio temporal de tipo nunca se confirma: otras sesiones siguen viendo
-- la foto original. No sube, borra ni modifica el archivo de Storage.
do $$
declare
 t public.trips%rowtype;
 kind text;
 blocked boolean;
 photos_before jsonb;
 weights_before jsonb;
 counter_before bigint;
begin
 select * into strict t from public.trips where id='13e2d8fa-de35-4881-acab-22e112da59ca';
 if t.status::text<>'IN_TRANSIT' then raise exception 'El viaje ya no está en tránsito'; end if;
 select jsonb_agg(to_jsonb(e) order by e.id) into photos_before from public.trip_arrival_safety_evidence e where e.trip_id=t.id;
 if photos_before is null then raise exception 'Falta una foto real para probar ambos casos'; end if;
 select jsonb_agg(to_jsonb(w) order by w.id) into weights_before from public.weighings w where w.trip_id=t.id;
 select last_number into counter_before from public.trip_evidence_counters where trip_id=t.id;
 foreach kind in array array['PPE','TRUCK'] loop
  begin
   update public.trip_arrival_safety_evidence set photo_kind=kind where trip_id=t.id;
   perform set_config('request.jwt.claim.sub',t.driver_id::text,true);
   execute 'set local role authenticated';
   blocked:=false;
   begin
    perform public.advance_trip(t.id);
   exception when check_violation then
    if (kind='PPE' and position('camión' in sqlerrm)=0)
     or (kind='TRUCK' and position('chofer' in sqlerrm)=0) then raise; end if;
    blocked:=true;
   end;
   if not blocked then raise exception 'FALLO: RPC admitió llegada con sólo %',kind; end if;
   execute 'reset role';
   blocked:=false;
   begin
    update public.trips set status='ARRIVED' where id=t.id;
   exception when check_violation then blocked:=true;
   end;
   if not blocked then raise exception 'FALLO: UPDATE admitió llegada con sólo %',kind; end if;
   raise exception using errcode='Z0001',message='REVERTIR_ESCENARIO';
  exception when sqlstate 'Z0001' then null;
  end;
 end loop;
 if (select status::text from public.trips where id=t.id)<>'IN_TRANSIT'
  or (select jsonb_agg(to_jsonb(e) order by e.id) from public.trip_arrival_safety_evidence e where e.trip_id=t.id) is distinct from photos_before
  or (select jsonb_agg(to_jsonb(w) order by w.id) from public.weighings w where w.trip_id=t.id) is distinct from weights_before
  or (select last_number from public.trip_evidence_counters where trip_id=t.id) is distinct from counter_before then
  raise exception 'FALLO: se modificó la operación';
 end if;
 raise notice 'OK: sólo PPE y sólo TRUCK rechazados por RPC y UPDATE; datos intactos';
end $$;
