-- El ticket de báscula DESTINATION es la evidencia de recepción. No se eliminan
-- recibos ni datos de entregas históricas.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_evidence_and_variance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid; v_origin numeric; v_dest numeric; v_field numeric; v_kg numeric:=10; v_percent numeric:=2; v_threshold numeric; v_excess text[]:=ARRAY[]::text[];
BEGIN
 IF TG_TABLE_NAME='weighings' THEN
  IF TG_OP='INSERT' AND (NEW.ticket_storage_path IS NULL OR btrim(coalesce(NEW.ticket_number,''))='' OR NEW.legibility_confirmed IS NOT TRUE) THEN
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
 IF EXISTS(SELECT 1 FROM public.weighings w WHERE w.trip_id=NEW.trip_id AND
   (w.ticket_storage_path IS NULL OR btrim(coalesce(w.ticket_number,''))='' OR w.legibility_confirmed IS NOT TRUE)) THEN
  RAISE EXCEPTION 'Todos los tickets deben tener folio y fotografía legible confirmada';
 END IF;
 SELECT net_weight_kg INTO v_origin FROM public.weighings WHERE trip_id=NEW.trip_id AND weighing_type::text='ORIGIN' LIMIT 1;
 SELECT net_weight_kg INTO v_dest FROM public.weighings WHERE trip_id=NEW.trip_id AND weighing_type::text='DESTINATION' LIMIT 1;
 IF v_origin IS NULL OR v_dest IS NULL THEN RAISE EXCEPTION 'Se requieren pesajes de origen y destino'; END IF;
 SELECT CASE WHEN count(*)>0 AND count(*)=count(loaded_weight_kg) THEN sum(loaded_weight_kg) END
 INTO v_field FROM public.trip_lots WHERE trip_id=NEW.trip_id;
 SELECT limit_kg,limit_percent INTO v_kg,v_percent FROM public.organization_variance_settings WHERE organization_id=v_org;
 v_threshold:=greatest(coalesce(v_kg,10),abs(v_origin)*coalesce(v_percent,2)/100);
 IF v_field IS NOT NULL AND abs(v_field-v_origin)>v_threshold THEN
  v_excess:=array_append(v_excess,format('lotes cargados − origen: %s kg',v_field-v_origin));
 END IF;
 IF abs(v_origin-v_dest)>v_threshold THEN
  v_excess:=array_append(v_excess,format('origen − destino: %s kg',v_origin-v_dest));
 END IF;
 IF cardinality(v_excess)>0 AND NOT EXISTS(SELECT 1 FROM public.trip_variance_reviews r WHERE r.trip_id=NEW.trip_id AND length(btrim(r.reason))>=10) THEN
  RAISE EXCEPTION 'Diferencia fuera de tolerancia (% kg): %. Registra una explicación antes de cerrar',v_threshold,array_to_string(v_excess,'; ');
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.complete_delivery_from_destination(p_trip_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_delivery public.deliveries%ROWTYPE; v_trip public.trips%ROWTYPE;
BEGIN
 SELECT * INTO v_delivery FROM public.deliveries WHERE trip_id=p_trip_id FOR UPDATE;
 IF NOT FOUND OR v_delivery.status::text<>'PENDING' THEN RAISE EXCEPTION 'La entrega no existe o ya está cerrada'; END IF;
 IF NOT public.is_admin_of_org(v_delivery.organization_id) AND NOT public.can_driver_manage_delivery(v_delivery.id) THEN
  RAISE EXCEPTION 'No tienes permiso para cerrar esta entrega' USING ERRCODE='insufficient_privilege';
 END IF;
 SELECT * INTO v_trip FROM public.trips WHERE id=p_trip_id FOR UPDATE;
 IF NOT FOUND OR v_trip.status::text<>'ARRIVED' OR v_trip.organization_id<>v_delivery.organization_id THEN
  RAISE EXCEPTION 'El viaje debe estar en ARRIVED y pertenecer a la entrega';
 END IF;
 IF v_trip.destination_name IS NULL OR btrim(v_trip.destination_name)='' OR v_trip.vehicle_plate IS NULL OR btrim(v_trip.vehicle_plate)='' OR v_trip.driver_id IS NULL THEN
  RAISE EXCEPTION 'Faltan destino, placa o chofer';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.weighings WHERE trip_id=p_trip_id AND weighing_type::text='ORIGIN' AND net_weight_kg>0 AND ticket_storage_path IS NOT NULL AND btrim(coalesce(ticket_number,''))<>'' AND legibility_confirmed) OR
    NOT EXISTS(SELECT 1 FROM public.weighings WHERE trip_id=p_trip_id AND weighing_type::text='DESTINATION' AND net_weight_kg>0 AND ticket_storage_path IS NOT NULL AND btrim(coalesce(ticket_number,''))<>'' AND legibility_confirmed) THEN
  RAISE EXCEPTION 'Se requieren ambos pesajes y tickets con folio y fotografía legible';
 END IF;
 UPDATE public.deliveries SET status='COMPLETED',received_at=now(),arrival_at=coalesce(v_trip.arrived_at,now()) WHERE id=v_delivery.id;
 UPDATE public.trips SET status='DELIVERED',delivered_at=now() WHERE id=p_trip_id;
 RETURN 'DELIVERED';
END $$;
REVOKE ALL ON FUNCTION public.complete_delivery_from_destination(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_delivery_from_destination(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.trip_closure_gaps(p_trip_id uuid) RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_trip public.trips%ROWTYPE; v_gaps text[]:=ARRAY[]::text[]; v_field numeric; v_origin numeric; v_dest numeric;
 v_kg numeric:=10; v_percent numeric:=2; v_limit numeric; v_excess text[]:=ARRAY[]::text[];
BEGIN
 SELECT * INTO v_trip FROM public.trips WHERE id=p_trip_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Viaje no encontrado'; END IF;
 IF NOT public.is_admin_of_org(v_trip.organization_id) AND NOT public.can_driver_manage_trip(p_trip_id)
 THEN RAISE EXCEPTION 'Sin acceso a este viaje' USING ERRCODE='insufficient_privilege'; END IF;
 IF v_trip.status::text<>'DELIVERED' THEN v_gaps:=array_append(v_gaps,'El viaje aún no se entregó'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.trip_lots WHERE trip_id=p_trip_id) THEN v_gaps:=array_append(v_gaps,'No hay lotes cargados'); END IF;
 SELECT CASE WHEN count(*)>0 AND count(*)=count(loaded_weight_kg) THEN sum(loaded_weight_kg) END INTO v_field FROM public.trip_lots WHERE trip_id=p_trip_id;
 SELECT net_weight_kg INTO v_origin FROM public.weighings WHERE trip_id=p_trip_id AND weighing_type::text='ORIGIN' LIMIT 1;
 SELECT net_weight_kg INTO v_dest FROM public.weighings WHERE trip_id=p_trip_id AND weighing_type::text='DESTINATION' LIMIT 1;
 IF v_origin IS NULL THEN v_gaps:=array_append(v_gaps,'Falta pesaje de origen'); END IF;
 IF v_dest IS NULL THEN v_gaps:=array_append(v_gaps,'Falta pesaje de destino'); END IF;
 IF EXISTS(SELECT 1 FROM public.weighings WHERE trip_id=p_trip_id AND
   (ticket_storage_path IS NULL OR btrim(coalesce(ticket_number,''))='' OR legibility_confirmed IS NOT TRUE))
 THEN v_gaps:=array_append(v_gaps,'Hay tickets sin folio o fotografía legible'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.deliveries WHERE trip_id=p_trip_id AND status::text='COMPLETED')
 THEN v_gaps:=array_append(v_gaps,'Falta una entrega completada'); END IF;
 IF EXISTS(SELECT 1 FROM public.deliveries WHERE trip_id=p_trip_id AND status::text<>'COMPLETED')
 THEN v_gaps:=array_append(v_gaps,'Hay entregas pendientes'); END IF;
 SELECT limit_kg,limit_percent INTO v_kg,v_percent FROM public.organization_variance_settings WHERE organization_id=v_trip.organization_id;
 v_limit:=greatest(coalesce(v_kg,10),abs(coalesce(v_origin,0))*coalesce(v_percent,2)/100);
 IF v_field IS NOT NULL AND v_origin IS NOT NULL AND abs(v_field-v_origin)>v_limit THEN
  v_excess:=array_append(v_excess,format('lotes cargados − origen: %s kg',v_field-v_origin)); END IF;
 IF v_origin IS NOT NULL AND v_dest IS NOT NULL AND abs(v_origin-v_dest)>v_limit THEN
  v_excess:=array_append(v_excess,format('origen − destino: %s kg',v_origin-v_dest)); END IF;
 IF cardinality(v_excess)>0 AND NOT EXISTS(SELECT 1 FROM public.trip_variance_reviews WHERE trip_id=p_trip_id AND length(btrim(reason))>=10) THEN
  v_gaps:=array_append(v_gaps,format('Diferencia fuera de tolerancia (%s kg) sin explicación: %s',v_limit,array_to_string(v_excess,'; '))); END IF;
 RETURN v_gaps;
END $$;
COMMIT;
