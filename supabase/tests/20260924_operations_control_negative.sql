-- Prueba directa con rol authenticated. No conserva cambios.
BEGIN;
DO $$
DECLARE v_admin uuid; v_driver uuid; v_trip uuid; v_org uuid; v_denied boolean; v_count integer;
BEGIN
 SELECT p.id INTO STRICT v_admin FROM public.profiles p WHERE p.role::text='ADMIN' AND p.status::text='ACTIVE' LIMIT 1;
 SELECT p.id INTO STRICT v_driver FROM public.profiles p WHERE p.role::text='DRIVER' AND p.status::text='ACTIVE' LIMIT 1;
 SELECT id,organization_id INTO STRICT v_trip,v_org FROM public.trips LIMIT 1;

 -- Aun con ruta de Storage antigua, nuevas evidencias sin revisión legible se rechazan.
 v_denied:=false;
 BEGIN
  INSERT INTO public.weighings SELECT (jsonb_populate_record(NULL::public.weighings,to_jsonb(w)||jsonb_build_object('id',gen_random_uuid(),'legibility_confirmed',false))).*
  FROM public.weighings w LIMIT 1;
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%Fotografía legible%' THEN v_denied:=true; ELSE RAISE; END IF;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'FALLO: ticket sin legibilidad permitida'; END IF;
 v_denied:=false;
 BEGIN
  INSERT INTO public.delivery_evidence SELECT (jsonb_populate_record(NULL::public.delivery_evidence,to_jsonb(e)||jsonb_build_object('id',gen_random_uuid(),'legibility_confirmed',false))).*
  FROM public.delivery_evidence e LIMIT 1;
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%recibo sea legible%' THEN v_denied:=true; ELSE RAISE; END IF;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'FALLO: recibo sin legibilidad permitida'; END IF;

 PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 -- Un administrador no puede configurar ni leer tolerancias de una organización ajena.
 v_denied:=false;
 BEGIN INSERT INTO public.organization_variance_settings(organization_id,limit_kg,limit_percent,updated_by)
  VALUES(gen_random_uuid(),10,2,v_admin);
 EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'FALLO: escritura de tolerancia ajena permitida'; END IF;
 SELECT count(*) INTO v_count FROM public.organization_variance_settings WHERE organization_id<>v_org;
 IF v_count<>0 THEN RAISE EXCEPTION 'FALLO: lectura de tolerancia ajena permitida'; END IF;
 -- Las notas y pesajes originales no son editables por Data API.
 v_denied:=false;
 BEGIN UPDATE public.weighings SET net_weight_kg=net_weight_kg WHERE trip_id=v_trip;
 EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'FALLO: cambio de pesaje histórico permitido'; END IF;
 v_denied:=false;
 BEGIN INSERT INTO public.trip_correction_notes(organization_id,trip_id,field_name,corrected_value,reason,created_by)
  VALUES(v_org,v_trip,'peso','500','Corrección de prueba',v_admin);
 EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'FALLO: inserción directa de nota permitida'; END IF;
 -- El RPC administra el control de roles y conserva el original.
 PERFORM public.record_trip_correction(v_trip,'peso','500','Corrección de prueba');
 EXECUTE 'RESET ROLE';

 PERFORM set_config('request.jwt.claim.sub',v_driver::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 v_denied:=false;
 BEGIN PERFORM public.record_trip_correction(v_trip,'peso','600','Sin autorización de administración');
 EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
 END;
 IF NOT v_denied THEN RAISE EXCEPTION 'FALLO: chofer pudo registrar corrección de administración'; END IF;
 EXECUTE 'RESET ROLE';
 RAISE NOTICE 'OPERATIONS_CONTROL_NEGATIVE_PASS: escritura ajena y edición histórica bloqueadas';
END $$;
ROLLBACK;
