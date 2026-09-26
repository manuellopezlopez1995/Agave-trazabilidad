-- Mantiene los pesos históricos y la tolerancia; identifica la comparación que realmente excede el límite.
BEGIN;
CREATE OR REPLACE FUNCTION public.enforce_evidence_and_variance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid; v_origin numeric; v_dest numeric; v_field numeric; v_accepted numeric; v_rejected numeric; v_kg numeric:=10; v_percent numeric:=2; v_threshold numeric; v_excess text[]:=ARRAY[]::text[];
BEGIN
 IF TG_TABLE_NAME='weighings' THEN
  IF TG_OP='INSERT' AND (NEW.ticket_storage_path IS NULL OR coalesce(NEW.ticket_number,'')='' OR NEW.legibility_confirmed IS NOT TRUE) THEN
   RAISE EXCEPTION 'Fotografía legible y folio del ticket obligatorios para cada pesaje';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='delivery_evidence' THEN
  IF TG_OP='INSERT' AND NEW.legibility_confirmed IS NOT TRUE THEN RAISE EXCEPTION 'Confirma que el recibo sea legible antes de adjuntarlo'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status::text<>'PENDING' OR NEW.status::text<>'COMPLETED' THEN RETURN NEW; END IF;
 SELECT organization_id INTO v_org FROM public.trips WHERE id=NEW.trip_id;
 IF EXISTS(SELECT 1 FROM public.weighings w WHERE w.trip_id=NEW.trip_id AND (w.ticket_storage_path IS NULL OR w.legibility_confirmed IS NOT TRUE)) THEN
  RAISE EXCEPTION 'Todos los tickets deben tener fotografía legible confirmada';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.delivery_evidence e WHERE e.delivery_id=NEW.id AND e.legibility_confirmed) THEN
  RAISE EXCEPTION 'La entrega necesita un recibo fotografiado y confirmado como legible';
 END IF;
 SELECT net_weight_kg INTO v_origin FROM public.weighings WHERE trip_id=NEW.trip_id AND weighing_type::text='ORIGIN' ORDER BY id LIMIT 1;
 SELECT net_weight_kg INTO v_dest FROM public.weighings WHERE trip_id=NEW.trip_id AND weighing_type::text='DESTINATION' ORDER BY id LIMIT 1;
 SELECT CASE WHEN count(*)>0 AND count(*)=count(loaded_weight_kg) THEN sum(loaded_weight_kg) END
 INTO v_field FROM public.trip_lots WHERE trip_id=NEW.trip_id;
 SELECT limit_kg,limit_percent INTO v_kg,v_percent FROM public.organization_variance_settings WHERE organization_id=v_org;
 v_kg:=coalesce(v_kg,10);v_percent:=coalesce(v_percent,2);v_threshold:=greatest(v_kg,case when v_origin is null then 0 else abs(v_origin)*v_percent/100 end);
 v_accepted:=NEW.accepted_weight_kg;v_rejected:=NEW.rejected_weight_kg;
 IF v_field IS NOT NULL AND v_origin IS NOT NULL AND abs(v_field-v_origin)>v_threshold THEN
  v_excess:=array_append(v_excess,format('lotes cargados − origen: %s kg',v_field-v_origin));
 END IF;
 IF v_origin IS NOT NULL AND v_dest IS NOT NULL AND abs(v_origin-v_dest)>v_threshold THEN
  v_excess:=array_append(v_excess,format('origen − destino: %s kg',v_origin-v_dest));
 END IF;
 IF v_dest IS NOT NULL AND v_accepted IS NOT NULL AND v_rejected IS NOT NULL AND abs(v_dest-v_accepted-v_rejected)>v_threshold THEN
  v_excess:=array_append(v_excess,format('destino − recepción: %s kg',v_dest-v_accepted-v_rejected));
 END IF;
 IF cardinality(v_excess)>0 AND NOT EXISTS(SELECT 1 FROM public.trip_variance_reviews r WHERE r.trip_id=NEW.trip_id AND length(btrim(r.reason))>=10) THEN
  RAISE EXCEPTION 'Diferencia fuera de tolerancia (% kg): %. Registra una explicación antes de cerrar',v_threshold,array_to_string(v_excess,'; ');
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.trip_closure_gaps(p_trip_id uuid) RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_trip public.trips%ROWTYPE; v_gaps text[]:=ARRAY[]::text[]; v_field numeric; v_origin numeric; v_dest numeric;
 v_accepted numeric; v_rejected numeric; v_kg numeric:=10; v_percent numeric:=2; v_limit numeric; v_excess text[]:=ARRAY[]::text[];
BEGIN
 SELECT * INTO v_trip FROM public.trips WHERE id=p_trip_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Viaje no encontrado'; END IF;
 IF NOT public.is_admin_of_org(v_trip.organization_id) AND NOT public.can_driver_manage_trip(p_trip_id)
 THEN RAISE EXCEPTION 'Sin acceso a este viaje' USING ERRCODE='insufficient_privilege'; END IF;
 IF v_trip.status::text<>'DELIVERED' THEN v_gaps:=array_append(v_gaps,'El viaje aún no se entregó'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.trip_lots WHERE trip_id=p_trip_id) THEN v_gaps:=array_append(v_gaps,'No hay lotes cargados'); END IF;
 SELECT CASE WHEN count(*)>0 AND count(*)=count(loaded_weight_kg) THEN sum(loaded_weight_kg) END
 INTO v_field FROM public.trip_lots WHERE trip_id=p_trip_id;
 SELECT net_weight_kg INTO v_origin FROM public.weighings WHERE trip_id=p_trip_id AND weighing_type::text='ORIGIN' LIMIT 1;
 SELECT net_weight_kg INTO v_dest FROM public.weighings WHERE trip_id=p_trip_id AND weighing_type::text='DESTINATION' LIMIT 1;
 IF v_origin IS NULL THEN v_gaps:=array_append(v_gaps,'Falta pesaje de origen'); END IF;
 IF v_dest IS NULL THEN v_gaps:=array_append(v_gaps,'Falta pesaje de destino'); END IF;
 IF EXISTS(SELECT 1 FROM public.weighings WHERE trip_id=p_trip_id AND (ticket_storage_path IS NULL OR ticket_number IS NULL OR NOT legibility_confirmed))
 THEN v_gaps:=array_append(v_gaps,'Hay tickets sin folio o fotografía legible'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.deliveries WHERE trip_id=p_trip_id AND status::text='COMPLETED')
 THEN v_gaps:=array_append(v_gaps,'Falta una entrega completada'); END IF;
 IF EXISTS(SELECT 1 FROM public.deliveries d WHERE d.trip_id=p_trip_id AND (d.status::text<>'COMPLETED' OR NOT EXISTS
   (SELECT 1 FROM public.delivery_evidence e WHERE e.delivery_id=d.id AND e.legibility_confirmed)))
 THEN v_gaps:=array_append(v_gaps,'Hay entregas o recibos pendientes'); END IF;
 SELECT sum(accepted_weight_kg),sum(rejected_weight_kg) INTO v_accepted,v_rejected FROM public.deliveries WHERE trip_id=p_trip_id;
 SELECT limit_kg,limit_percent INTO v_kg,v_percent FROM public.organization_variance_settings WHERE organization_id=v_trip.organization_id;
 v_limit:=greatest(coalesce(v_kg,10),abs(coalesce(v_origin,0))*coalesce(v_percent,2)/100);
 IF v_field IS NOT NULL AND v_origin IS NOT NULL AND abs(v_field-v_origin)>v_limit THEN
  v_excess:=array_append(v_excess,format('lotes cargados − origen: %s kg',v_field-v_origin));
 END IF;
 IF v_origin IS NOT NULL AND v_dest IS NOT NULL AND abs(v_origin-v_dest)>v_limit THEN
  v_excess:=array_append(v_excess,format('origen − destino: %s kg',v_origin-v_dest));
 END IF;
 IF v_dest IS NOT NULL AND v_accepted IS NOT NULL AND v_rejected IS NOT NULL AND abs(v_dest-v_accepted-v_rejected)>v_limit THEN
  v_excess:=array_append(v_excess,format('destino − recepción: %s kg',v_dest-v_accepted-v_rejected));
 END IF;
 IF cardinality(v_excess)>0 AND NOT EXISTS(SELECT 1 FROM public.trip_variance_reviews WHERE trip_id=p_trip_id AND length(btrim(reason))>=10)
 THEN v_gaps:=array_append(v_gaps,format('Diferencia fuera de tolerancia (%s kg) sin explicación: %s',v_limit,array_to_string(v_excess,'; '))); END IF;
 RETURN v_gaps;
END $$;
COMMIT;
