-- Seguridad para piloto: validaciones, transiciones atómicas y cierre de escrituras directas.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_pilot_status_transitions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status::text = OLD.status::text THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'harvest_orders' AND NOT (
    (OLD.status::text = 'ASSIGNED' AND NEW.status::text = 'IN_PROGRESS') OR
    (OLD.status::text = 'IN_PROGRESS' AND NEW.status::text = 'HARVESTED')
  ) THEN
    RAISE EXCEPTION 'Transición de jima no permitida: % -> %', OLD.status, NEW.status USING ERRCODE='check_violation';
  ELSIF TG_TABLE_NAME = 'trips' AND NOT (
    (OLD.status::text = 'ASSIGNED' AND NEW.status::text = 'LOADING') OR
    (OLD.status::text = 'LOADING' AND NEW.status::text = 'IN_TRANSIT') OR
    (OLD.status::text = 'IN_TRANSIT' AND NEW.status::text = 'ARRIVED') OR
    (OLD.status::text = 'ARRIVED' AND NEW.status::text = 'DELIVERED')
  ) THEN
    RAISE EXCEPTION 'Transición de viaje no permitida: % -> %', OLD.status, NEW.status USING ERRCODE='check_violation';
  ELSIF TG_TABLE_NAME = 'deliveries' AND NOT (
    OLD.status::text = 'PENDING' AND NEW.status::text = 'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'Transición de entrega no permitida: % -> %', OLD.status, NEW.status USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pilot_harvest_transition ON public.harvest_orders;
CREATE TRIGGER pilot_harvest_transition BEFORE UPDATE OF status ON public.harvest_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_pilot_status_transitions();
DROP TRIGGER IF EXISTS pilot_trip_transition ON public.trips;
CREATE TRIGGER pilot_trip_transition BEFORE UPDATE OF status ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.enforce_pilot_status_transitions();
DROP TRIGGER IF EXISTS pilot_delivery_transition ON public.deliveries;
CREATE TRIGGER pilot_delivery_transition BEFORE UPDATE OF status ON public.deliveries
FOR EACH ROW EXECUTE FUNCTION public.enforce_pilot_status_transitions();

CREATE OR REPLACE FUNCTION public.validate_pilot_lot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_org uuid; v_farm uuid; v_harvest_status text;
BEGIN
  SELECT organization_id, farm_id, status::text INTO v_org, v_farm, v_harvest_status
  FROM public.harvest_orders WHERE id=NEW.harvest_order_id;
  IF NOT FOUND OR v_org<>NEW.organization_id OR v_farm<>NEW.farm_id THEN
    RAISE EXCEPTION 'El lote no corresponde a la organización, jima y predio indicados' USING ERRCODE='check_violation';
  END IF;
  IF TG_OP='INSERT' AND v_harvest_status<>'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Sólo se pueden crear lotes durante una jima en curso' USING ERRCODE='check_violation';
  END IF;
  IF NEW.agave_count IS NULL OR NEW.agave_count<1 OR NEW.agave_count>100000 THEN
    RAISE EXCEPTION 'Cantidad de agaves fuera de rango (1 a 100000)' USING ERRCODE='check_violation';
  END IF;
  IF NEW.average_brix IS NULL OR NEW.average_brix<0 OR NEW.average_brix>50 THEN
    RAISE EXCEPTION 'Brix fuera de rango (0 a 50)' USING ERRCODE='check_violation';
  END IF;
  IF NEW.actual_weight_kg IS NULL OR NEW.actual_weight_kg<=0 OR NEW.actual_weight_kg>200000 THEN
    RAISE EXCEPTION 'Peso del lote fuera de rango' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pilot_validate_lot ON public.agave_lots;
CREATE TRIGGER pilot_validate_lot BEFORE INSERT OR UPDATE OF harvest_order_id,farm_id,organization_id,agave_count,average_brix,actual_weight_kg,status ON public.agave_lots
FOR EACH ROW EXECUTE FUNCTION public.validate_pilot_lot();

CREATE OR REPLACE FUNCTION public.validate_pilot_weighing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_status text;
BEGIN
  SELECT status::text INTO v_status FROM public.trips WHERE id=NEW.trip_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El viaje no existe' USING ERRCODE='foreign_key_violation'; END IF;
  IF NEW.gross_weight_kg<=NEW.tare_weight_kg OR NEW.tare_weight_kg<0 OR NEW.gross_weight_kg>200000 THEN
    RAISE EXCEPTION 'Pesaje fuera de rango: el bruto debe superar la tara' USING ERRCODE='check_violation';
  END IF;
  IF abs(NEW.net_weight_kg-(NEW.gross_weight_kg-NEW.tare_weight_kg))>0.01 THEN
    RAISE EXCEPTION 'El peso neto no coincide con bruto menos tara' USING ERRCODE='check_violation';
  END IF;
  IF NEW.weighing_type::text='ORIGIN' AND v_status NOT IN ('ASSIGNED','LOADING') THEN
    RAISE EXCEPTION 'El pesaje de origen sólo se registra antes de salir' USING ERRCODE='check_violation';
  ELSIF NEW.weighing_type::text='DESTINATION' AND v_status<>'ARRIVED' THEN
    RAISE EXCEPTION 'El pesaje de destino sólo se registra después de la llegada' USING ERRCODE='check_violation';
  ELSIF NEW.weighing_type::text NOT IN ('ORIGIN','DESTINATION') THEN
    RAISE EXCEPTION 'Tipo de pesaje no permitido' USING ERRCODE='check_violation';
  END IF;
  IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.weighings w WHERE w.trip_id=NEW.trip_id AND w.weighing_type=NEW.weighing_type) THEN
    RAISE EXCEPTION 'Ya existe el pesaje % para este viaje', NEW.weighing_type USING ERRCODE='unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pilot_validate_weighing ON public.weighings;
CREATE TRIGGER pilot_validate_weighing BEFORE INSERT OR UPDATE ON public.weighings
FOR EACH ROW EXECUTE FUNCTION public.validate_pilot_weighing();

CREATE OR REPLACE FUNCTION public.advance_harvest(p_harvest_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_status text; v_org uuid;
BEGIN
  SELECT status::text,organization_id INTO v_status,v_org FROM public.harvest_orders WHERE id=p_harvest_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La jima no existe'; END IF;
  IF NOT public.is_admin_of_org(v_org) AND NOT public.can_manage_harvest(p_harvest_id) THEN RAISE EXCEPTION 'No tienes permiso para administrar esta jima' USING ERRCODE='insufficient_privilege'; END IF;
  IF v_status='ASSIGNED' THEN
    UPDATE public.harvest_orders SET status='IN_PROGRESS',started_at=now() WHERE id=p_harvest_id;
    RETURN 'IN_PROGRESS';
  ELSIF v_status='IN_PROGRESS' THEN
    IF NOT EXISTS(SELECT 1 FROM public.agave_lots WHERE harvest_order_id=p_harvest_id) THEN RAISE EXCEPTION 'Registra al menos un lote antes de terminar'; END IF;
    IF EXISTS(SELECT 1 FROM public.agave_lots WHERE harvest_order_id=p_harvest_id AND (agave_count IS NULL OR agave_count<1 OR average_brix IS NULL OR average_brix<0 OR average_brix>50 OR actual_weight_kg IS NULL OR actual_weight_kg<=0)) THEN RAISE EXCEPTION 'Completa las mediciones válidas de todos los lotes'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.harvest_evidence WHERE harvest_order_id=p_harvest_id) THEN RAISE EXCEPTION 'Adjunta una fotografía antes de terminar'; END IF;
    UPDATE public.agave_lots SET status='HARVESTED' WHERE harvest_order_id=p_harvest_id AND status::text='OPEN';
    UPDATE public.harvest_orders SET status='HARVESTED',completed_at=now() WHERE id=p_harvest_id;
    RETURN 'HARVESTED';
  END IF;
  RAISE EXCEPTION 'La jima no puede avanzar desde el estado %',v_status USING ERRCODE='check_violation';
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_trip(p_trip_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_status text; v_org uuid;
BEGIN
  SELECT status::text,organization_id INTO v_status,v_org FROM public.trips WHERE id=p_trip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El viaje no existe'; END IF;
  IF NOT public.is_admin_of_org(v_org) AND NOT public.can_driver_manage_trip(p_trip_id) THEN RAISE EXCEPTION 'No tienes permiso para administrar este viaje' USING ERRCODE='insufficient_privilege'; END IF;
  IF v_status='ASSIGNED' THEN
    UPDATE public.trips SET status='LOADING',loaded_at=now() WHERE id=p_trip_id; RETURN 'LOADING';
  ELSIF v_status='LOADING' THEN
    IF NOT EXISTS(SELECT 1 FROM public.trip_lots WHERE trip_id=p_trip_id) THEN RAISE EXCEPTION 'Asigna al menos un lote antes de salir'; END IF;
    IF EXISTS(SELECT 1 FROM public.trip_lots tl JOIN public.agave_lots l ON l.id=tl.agave_lot_id WHERE tl.trip_id=p_trip_id AND l.status::text<>'HARVESTED') THEN RAISE EXCEPTION 'Todos los lotes deben estar cosechados antes de salir'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.weighings WHERE trip_id=p_trip_id AND weighing_type::text='ORIGIN') THEN RAISE EXCEPTION 'Registra el pesaje de origen antes de salir'; END IF;
    UPDATE public.trips SET status='IN_TRANSIT',departed_at=now() WHERE id=p_trip_id; RETURN 'IN_TRANSIT';
  ELSIF v_status='IN_TRANSIT' THEN
    UPDATE public.trips SET status='ARRIVED',arrived_at=now() WHERE id=p_trip_id; RETURN 'ARRIVED';
  END IF;
  RAISE EXCEPTION 'El viaje no puede avanzar desde el estado %',v_status USING ERRCODE='check_violation';
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_delivery(p_delivery_id uuid,p_received_by_name text,p_accepted_weight_kg numeric,p_rejected_weight_kg numeric,p_rejection_reason text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_org uuid; v_trip uuid; v_trip_status text; v_destination_net numeric; v_total numeric; v_name text:=btrim(regexp_replace(coalesce(p_received_by_name,''),'\s+',' ','g')); v_reason text:=nullif(btrim(coalesce(p_rejection_reason,'')),'');
BEGIN
  SELECT organization_id,trip_id INTO v_org,v_trip FROM public.deliveries WHERE id=p_delivery_id AND status::text='PENDING' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La entrega no existe o ya está cerrada'; END IF;
  IF NOT public.is_admin_of_org(v_org) AND NOT public.can_driver_manage_delivery(p_delivery_id) THEN RAISE EXCEPTION 'No tienes permiso para cerrar esta entrega' USING ERRCODE='insufficient_privilege'; END IF;
  SELECT status::text INTO v_trip_status FROM public.trips WHERE id=v_trip FOR UPDATE;
  IF v_trip_status<>'ARRIVED' THEN RAISE EXCEPTION 'El viaje debe estar en ARRIVED'; END IF;
  IF length(v_name)<2 OR length(v_name)>120 THEN RAISE EXCEPTION 'Nombre del receptor inválido'; END IF;
  IF p_accepted_weight_kg<0 OR p_rejected_weight_kg<0 OR p_accepted_weight_kg>200000 OR p_rejected_weight_kg>200000 THEN RAISE EXCEPTION 'Pesos de entrega fuera de rango'; END IF;
  v_total:=p_accepted_weight_kg+p_rejected_weight_kg; IF v_total<=0 THEN RAISE EXCEPTION 'El peso total recibido debe ser mayor que cero'; END IF;
  IF p_rejected_weight_kg>0 AND v_reason IS NULL THEN RAISE EXCEPTION 'Indica el motivo del rechazo'; END IF;
  IF length(coalesce(v_reason,''))>300 THEN RAISE EXCEPTION 'El motivo del rechazo es demasiado largo'; END IF;
  SELECT net_weight_kg INTO v_destination_net FROM public.weighings WHERE trip_id=v_trip AND weighing_type::text='DESTINATION';
  IF NOT FOUND THEN RAISE EXCEPTION 'Falta el pesaje de destino'; END IF;
  IF abs(v_total-v_destination_net)>1 THEN RAISE EXCEPTION 'Aceptado más rechazado debe coincidir con el peso neto de destino (tolerancia 1 kg)'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.delivery_evidence WHERE delivery_id=p_delivery_id) THEN RAISE EXCEPTION 'Falta la fotografía del recibo'; END IF;
  UPDATE public.deliveries SET status='COMPLETED',received_at=now(),arrival_at=coalesce((SELECT arrived_at FROM public.trips WHERE id=v_trip),now()),received_by_name=v_name,accepted_weight_kg=p_accepted_weight_kg,rejected_weight_kg=p_rejected_weight_kg,rejection_reason=v_reason WHERE id=p_delivery_id;
  UPDATE public.trips SET status='DELIVERED',delivered_at=now() WHERE id=v_trip;
  RETURN 'COMPLETED';
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_pilot_evidence_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, storage, pg_temp
AS $$
DECLARE v_org uuid; v_entity uuid; v_expected_bucket text;
BEGIN
  IF TG_TABLE_NAME='harvest_evidence' THEN
    v_entity:=NEW.harvest_order_id; v_expected_bucket:='harvest-evidence';
    SELECT organization_id INTO v_org FROM public.harvest_orders WHERE id=v_entity;
  ELSE
    v_entity:=NEW.delivery_id; v_expected_bucket:='delivery-evidence';
    SELECT organization_id INTO v_org FROM public.deliveries WHERE id=v_entity;
  END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'La entidad de la evidencia no existe' USING ERRCODE='foreign_key_violation'; END IF;
  IF NEW.uploaded_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'uploaded_by debe ser el usuario autenticado' USING ERRCODE='insufficient_privilege'; END IF;
  IF NEW.storage_bucket<>v_expected_bucket OR split_part(NEW.storage_path,'/',1)<>v_org::text OR split_part(NEW.storage_path,'/',2)<>v_entity::text OR split_part(NEW.storage_path,'/',3)<>auth.uid()::text THEN
    RAISE EXCEPTION 'La ruta de la evidencia no coincide con organización, entidad y usuario' USING ERRCODE='check_violation';
  END IF;
  IF NEW.mime_type NOT IN ('image/jpeg','image/png') OR NEW.file_size_bytes<=0 OR NEW.file_size_bytes>12582912 THEN
    RAISE EXCEPTION 'Tipo o tamaño de evidencia no permitido' USING ERRCODE='check_violation';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=NEW.storage_bucket AND o.name=NEW.storage_path) THEN
    RAISE EXCEPTION 'El archivo no existe en Storage';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pilot_validate_harvest_evidence ON public.harvest_evidence;
CREATE TRIGGER pilot_validate_harvest_evidence BEFORE INSERT OR UPDATE ON public.harvest_evidence
FOR EACH ROW EXECUTE FUNCTION public.validate_pilot_evidence_metadata();
DROP TRIGGER IF EXISTS pilot_validate_delivery_evidence ON public.delivery_evidence;
CREATE TRIGGER pilot_validate_delivery_evidence BEFORE INSERT OR UPDATE ON public.delivery_evidence
FOR EACH ROW EXECUTE FUNCTION public.validate_pilot_evidence_metadata();

CREATE OR REPLACE FUNCTION public.validate_pilot_weighing_ticket()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, storage, pg_temp
AS $$
DECLARE v_org uuid;
BEGIN
  IF NEW.recorded_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'recorded_by debe ser el usuario autenticado' USING ERRCODE='insufficient_privilege'; END IF;
  IF NEW.ticket_storage_path IS NULL THEN
    IF NEW.storage_bucket IS NOT NULL THEN RAISE EXCEPTION 'No puede existir bucket sin ruta de ticket'; END IF;
    RETURN NEW;
  END IF;
  SELECT organization_id INTO v_org FROM public.trips WHERE id=NEW.trip_id;
  IF NEW.storage_bucket<>'weighing-tickets' OR split_part(NEW.ticket_storage_path,'/',1)<>v_org::text OR split_part(NEW.ticket_storage_path,'/',2)<>NEW.trip_id::text OR split_part(NEW.ticket_storage_path,'/',3)<>auth.uid()::text THEN
    RAISE EXCEPTION 'La ruta del ticket no coincide con organización, viaje y usuario' USING ERRCODE='check_violation';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='weighing-tickets' AND o.name=NEW.ticket_storage_path) THEN RAISE EXCEPTION 'El ticket no existe en Storage'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pilot_validate_weighing_ticket ON public.weighings;
CREATE TRIGGER pilot_validate_weighing_ticket BEFORE INSERT OR UPDATE OF trip_id,storage_bucket,ticket_storage_path,recorded_by ON public.weighings
FOR EACH ROW EXECUTE FUNCTION public.validate_pilot_weighing_ticket();

REVOKE ALL ON FUNCTION public.advance_harvest(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_trip(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_delivery(uuid,text,numeric,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_harvest(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_trip(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_delivery(uuid,text,numeric,numeric,text) TO authenticated;

-- Los cambios de estado se realizan sólo mediante las funciones atómicas anteriores.
REVOKE UPDATE ON public.harvest_orders,public.trips,public.deliveries FROM authenticated;

COMMIT;
