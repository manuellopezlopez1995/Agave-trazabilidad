-- Transacción reversible. Requiere un viaje de prueba ya entregado.
BEGIN;
DO $$
DECLARE v_trip uuid; v_harvest uuid; v_admin uuid; v_driver uuid; v_org uuid; v_gaps text[]; v_denied boolean;
BEGIN
 SELECT t.id,t.organization_id,p.id INTO v_trip,v_org,v_admin FROM public.trips t
 CROSS JOIN LATERAL (SELECT id FROM public.profiles WHERE role::text='ADMIN' AND status::text='ACTIVE' LIMIT 1) p LIMIT 1;
 SELECT id INTO v_driver FROM public.profiles WHERE role::text='DRIVER' AND status::text='ACTIVE' LIMIT 1;
 SELECT l.harvest_order_id INTO v_harvest FROM public.trip_lots tl JOIN public.agave_lots l ON l.id=tl.agave_lot_id WHERE tl.trip_id=v_trip LIMIT 1;
 IF v_trip IS NULL OR v_admin IS NULL OR v_driver IS NULL OR v_harvest IS NULL THEN RAISE EXCEPTION 'Faltan datos para la prueba'; END IF;
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claim.sub',v_driver::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 v_denied:=false;
 BEGIN PERFORM public.approve_trip_closure(v_trip); EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
 IF NOT v_denied THEN RAISE EXCEPTION 'FALLO: chofer aprobó conciliación'; END IF;
 v_denied:=false;
 BEGIN PERFORM public.finalize_buyer_dossier(v_harvest,'Diageo'); EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
 IF NOT v_denied THEN RAISE EXCEPTION 'FALLO: chofer emitió expediente final'; END IF;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 v_denied:=false;
 BEGIN INSERT INTO public.trip_closures(trip_id,organization_id,approved_by,checklist) VALUES(v_trip,v_org,v_admin,'{}');
 EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
 IF NOT v_denied THEN RAISE EXCEPTION 'FALLO: inserción directa de conciliación'; END IF;
 v_denied:=false;
 BEGIN UPDATE public.buyer_dossier_versions SET sha256=repeat('0',64) WHERE organization_id=v_org;
 EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
 IF NOT v_denied THEN RAISE EXCEPTION 'FALLO: actualización de expediente final'; END IF;
 v_gaps:=public.trip_closure_gaps(v_trip);
 IF cardinality(v_gaps)>0 THEN
  v_denied:=false;
  BEGIN PERFORM public.approve_trip_closure(v_trip); EXCEPTION WHEN OTHERS THEN
   IF SQLERRM LIKE 'Cierre pendiente:%' THEN v_denied:=true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'FALLO: administrador aprobó viaje incompleto'; END IF;
 END IF;
 EXECUTE 'RESET ROLE';
 RAISE NOTICE 'FORMAL_CLOSE_NEGATIVE_PASS';
END $$;
ROLLBACK;
