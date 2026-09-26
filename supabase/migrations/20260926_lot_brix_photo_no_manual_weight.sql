-- Reutiliza harvest_evidence.agave_lot_id y el bucket privado harvest-evidence.
-- No altera pesajes ni valores históricos; los nuevos lotes dejan el peso en NULL.
BEGIN;

-- El FK harvest_evidence_agave_lot_id_fkey ya existe en producción.
CREATE INDEX IF NOT EXISTS harvest_evidence_agave_lot_id_idx ON public.harvest_evidence(agave_lot_id) WHERE agave_lot_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_pilot_lot()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_org uuid; v_farm uuid; v_harvest_status text;
BEGIN
 SELECT organization_id,farm_id,status::text INTO v_org,v_farm,v_harvest_status
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
 IF NEW.actual_weight_kg IS NOT NULL AND (NEW.actual_weight_kg<=0 OR NEW.actual_weight_kg>200000) THEN
  RAISE EXCEPTION 'Peso histórico del lote fuera de rango' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.validate_lot_brix_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.agave_lot_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.agave_lots l
  WHERE l.id=NEW.agave_lot_id AND l.harvest_order_id=NEW.harvest_order_id
 ) THEN RAISE EXCEPTION 'La evidencia °Brix debe pertenecer al lote de esta jima' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER validate_lot_brix_evidence BEFORE INSERT OR UPDATE OF agave_lot_id,harvest_order_id ON public.harvest_evidence
 FOR EACH ROW EXECUTE FUNCTION public.validate_lot_brix_evidence();

CREATE OR REPLACE FUNCTION public.save_lot_with_brix_evidence(
 p_harvest_id uuid,p_agave_count integer,p_average_brix numeric,p_storage_path text,
 p_mime_type text,p_file_size_bytes bigint,p_captured_at timestamptz,
 p_latitude numeric DEFAULT NULL,p_longitude numeric DEFAULT NULL,p_lot_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
DECLARE v_harvest public.harvest_orders%ROWTYPE; v_lot uuid; v_organization uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesión requerida' USING ERRCODE='insufficient_privilege'; END IF;
 SELECT * INTO v_harvest FROM public.harvest_orders WHERE id=p_harvest_id FOR UPDATE;
 IF NOT FOUND OR v_harvest.status::text<>'IN_PROGRESS' THEN RAISE EXCEPTION 'La jima debe estar en curso'; END IF;
 v_organization:=v_harvest.organization_id;
 IF NOT (public.is_admin_of_org(v_organization) OR public.can_manage_harvest(p_harvest_id)) THEN
  RAISE EXCEPTION 'No tienes permiso para registrar este lote' USING ERRCODE='insufficient_privilege';
 END IF;
 IF p_agave_count IS NULL OR p_agave_count NOT BETWEEN 1 AND 100000 OR p_average_brix IS NULL OR p_average_brix NOT BETWEEN 0 AND 50 THEN
  RAISE EXCEPTION 'Agaves o °Brix fuera de rango' USING ERRCODE='check_violation';
 END IF;
 IF p_storage_path IS NULL OR split_part(p_storage_path,'/',1)<>v_organization::text
    OR split_part(p_storage_path,'/',2)<>p_harvest_id::text
    OR split_part(p_storage_path,'/',3)<>auth.uid()::text
    OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='harvest-evidence' AND name=p_storage_path) THEN
  RAISE EXCEPTION 'La fotografía original de °Brix no está disponible en el archivo privado' USING ERRCODE='check_violation';
 END IF;
 IF p_lot_id IS NULL THEN
  INSERT INTO public.agave_lots(organization_id,harvest_order_id,farm_id,agave_count,average_brix,actual_weight_kg,harvest_date,created_by)
  VALUES(v_organization,p_harvest_id,v_harvest.farm_id,p_agave_count,p_average_brix,NULL,(now() AT TIME ZONE 'America/Mexico_City')::date,auth.uid()) RETURNING id INTO v_lot;
 ELSE
  UPDATE public.agave_lots SET agave_count=p_agave_count,average_brix=p_average_brix
  WHERE id=p_lot_id AND harvest_order_id=p_harvest_id AND organization_id=v_organization AND status::text='OPEN'
  RETURNING id INTO v_lot;
  IF v_lot IS NULL THEN RAISE EXCEPTION 'El lote no está abierto en esta jima'; END IF;
 END IF;
 INSERT INTO public.harvest_evidence(harvest_order_id,agave_lot_id,evidence_type,storage_bucket,storage_path,mime_type,file_size_bytes,captured_at,latitude,longitude,uploaded_by)
 VALUES(p_harvest_id,v_lot,'PHOTO','harvest-evidence',p_storage_path,p_mime_type,p_file_size_bytes,p_captured_at,p_latitude,p_longitude,auth.uid());
 RETURN v_lot;
END; $$;
REVOKE ALL ON FUNCTION public.save_lot_with_brix_evidence(uuid,integer,numeric,text,text,bigint,timestamptz,numeric,numeric,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_lot_with_brix_evidence(uuid,integer,numeric,text,text,bigint,timestamptz,numeric,numeric,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.advance_harvest(p_harvest_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_status text; v_org uuid;
BEGIN
 SELECT status::text,organization_id INTO v_status,v_org FROM public.harvest_orders WHERE id=p_harvest_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La jima no existe'; END IF;
 IF NOT public.is_admin_of_org(v_org) AND NOT public.can_manage_harvest(p_harvest_id) THEN
  RAISE EXCEPTION 'No tienes permiso para administrar esta jima' USING ERRCODE='insufficient_privilege';
 END IF;
 IF v_status='ASSIGNED' THEN
  UPDATE public.harvest_orders SET status='IN_PROGRESS',started_at=now() WHERE id=p_harvest_id;
  RETURN 'IN_PROGRESS';
 ELSIF v_status='IN_PROGRESS' THEN
  IF NOT EXISTS(SELECT 1 FROM public.agave_lots WHERE harvest_order_id=p_harvest_id) THEN RAISE EXCEPTION 'Registra al menos un lote antes de terminar'; END IF;
  IF EXISTS(SELECT 1 FROM public.agave_lots WHERE harvest_order_id=p_harvest_id AND (agave_count IS NULL OR agave_count<1 OR average_brix IS NULL OR average_brix<0 OR average_brix>50 OR actual_weight_kg IS NOT NULL AND actual_weight_kg<=0
    OR actual_weight_kg IS NULL AND NOT EXISTS(SELECT 1 FROM public.harvest_evidence e WHERE e.agave_lot_id=agave_lots.id AND e.harvest_order_id=p_harvest_id))) THEN
   RAISE EXCEPTION 'Completa las mediciones y fotografía °Brix de todos los lotes';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.harvest_evidence WHERE harvest_order_id=p_harvest_id AND agave_lot_id IS NULL) THEN RAISE EXCEPTION 'Adjunta una fotografía de jima antes de terminar'; END IF;
  UPDATE public.agave_lots SET status='HARVESTED' WHERE harvest_order_id=p_harvest_id AND status::text='OPEN';
  UPDATE public.harvest_orders SET status='HARVESTED',completed_at=now() WHERE id=p_harvest_id;
  RETURN 'HARVESTED';
 END IF;
 RAISE EXCEPTION 'La jima no puede avanzar desde el estado %',v_status USING ERRCODE='check_violation';
END; $$;

COMMIT;
