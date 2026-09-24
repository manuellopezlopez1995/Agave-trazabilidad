-- Ejecutar en Supabase antes de publicar la interfaz de control. No modifica registros cerrados.
BEGIN;

CREATE TABLE IF NOT EXISTS public.organization_variance_settings (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
 limit_kg numeric NOT NULL DEFAULT 10 CHECK (limit_kg>=0 AND limit_kg<=10000),
 limit_percent numeric NOT NULL DEFAULT 2 CHECK (limit_percent>=0 AND limit_percent<=100),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES public.profiles(id)
);
ALTER TABLE public.organization_variance_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.organization_variance_settings TO authenticated;
DROP POLICY IF EXISTS variance_settings_read ON public.organization_variance_settings;
CREATE POLICY variance_settings_read ON public.organization_variance_settings FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=organization_variance_settings.organization_id AND m.profile_id=auth.uid() AND m.active));
DROP POLICY IF EXISTS variance_settings_admin_insert ON public.organization_variance_settings;
CREATE POLICY variance_settings_admin_insert ON public.organization_variance_settings FOR INSERT TO authenticated WITH CHECK (public.is_admin_of_org(organization_id) AND updated_by=auth.uid());
DROP POLICY IF EXISTS variance_settings_admin_update ON public.organization_variance_settings;
CREATE POLICY variance_settings_admin_update ON public.organization_variance_settings FOR UPDATE TO authenticated USING (public.is_admin_of_org(organization_id)) WITH CHECK (public.is_admin_of_org(organization_id) AND updated_by=auth.uid());

CREATE TABLE IF NOT EXISTS public.trip_variance_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 trip_id uuid NOT NULL REFERENCES public.trips(id),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 1000),
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.trip_correction_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 trip_id uuid NOT NULL REFERENCES public.trips(id),
 field_name text NOT NULL CHECK (length(btrim(field_name)) BETWEEN 2 AND 80),
 corrected_value text NOT NULL CHECK (length(btrim(corrected_value)) BETWEEN 1 AND 300),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 1000),
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trip_correction_notes ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.trip_correction_notes TO authenticated;
DROP POLICY IF EXISTS trip_corrections_read ON public.trip_correction_notes;
CREATE POLICY trip_corrections_read ON public.trip_correction_notes FOR SELECT TO authenticated USING (public.is_admin_of_org(organization_id) OR public.can_driver_manage_trip(trip_id));
CREATE OR REPLACE FUNCTION public.record_trip_correction(p_trip_id uuid,p_field_name text,p_corrected_value text,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid; v_id uuid;
BEGIN
 SELECT organization_id INTO v_org FROM public.trips WHERE id=p_trip_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'El viaje no existe'; END IF;
 IF NOT public.is_admin_of_org(v_org) THEN RAISE EXCEPTION 'Sólo administración puede anotar correcciones' USING ERRCODE='insufficient_privilege'; END IF;
 IF length(btrim(coalesce(p_field_name,''))) NOT BETWEEN 2 AND 80 OR length(btrim(coalesce(p_corrected_value,''))) NOT BETWEEN 1 AND 300 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'Campo, valor y motivo de corrección inválidos'; END IF;
 INSERT INTO public.trip_correction_notes(organization_id,trip_id,field_name,corrected_value,reason,created_by) VALUES(v_org,p_trip_id,btrim(p_field_name),btrim(p_corrected_value),btrim(p_reason),auth.uid()) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.record_trip_correction(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_trip_correction(uuid,text,text,text) TO authenticated;
CREATE INDEX IF NOT EXISTS idx_trip_variance_reviews_trip ON public.trip_variance_reviews(trip_id,created_at DESC);
ALTER TABLE public.trip_variance_reviews ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.trip_variance_reviews TO authenticated;
DROP POLICY IF EXISTS trip_reviews_read ON public.trip_variance_reviews;
CREATE POLICY trip_reviews_read ON public.trip_variance_reviews FOR SELECT TO authenticated USING (public.is_admin_of_org(organization_id) OR public.can_driver_manage_trip(trip_id));
-- Sin políticas UPDATE/DELETE: las aclaraciones son adiciones inmutables.
CREATE OR REPLACE FUNCTION public.record_trip_variance_review(p_trip_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid; v_id uuid; v_reason text:=btrim(coalesce(p_reason,''));
BEGIN
 SELECT organization_id INTO v_org FROM public.trips WHERE id=p_trip_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'El viaje no existe'; END IF;
 IF NOT public.is_admin_of_org(v_org) AND NOT public.can_driver_manage_trip(p_trip_id) THEN RAISE EXCEPTION 'Sin permiso para aclarar este viaje' USING ERRCODE='insufficient_privilege'; END IF;
 IF length(v_reason)<10 OR length(v_reason)>1000 THEN RAISE EXCEPTION 'Explica la diferencia en 10 a 1000 caracteres'; END IF;
 INSERT INTO public.trip_variance_reviews(organization_id,trip_id,reason,created_by) VALUES(v_org,p_trip_id,v_reason,auth.uid()) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.record_trip_variance_review(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_trip_variance_review(uuid,text) TO authenticated;

ALTER TABLE public.weighings ADD COLUMN IF NOT EXISTS legibility_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE public.delivery_evidence ADD COLUMN IF NOT EXISTS legibility_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE public.weighings ADD COLUMN IF NOT EXISTS captured_at timestamptz;
ALTER TABLE public.weighings ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE public.weighings ADD COLUMN IF NOT EXISTS longitude numeric;
ALTER TABLE public.delivery_evidence ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE public.delivery_evidence ADD COLUMN IF NOT EXISTS longitude numeric;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS vehicle_plate text;

-- Un viaje pertenece a un comprador. Una misma jima sí puede abastecer a varios viajes/compradores.
CREATE OR REPLACE FUNCTION public.enforce_single_trip_buyer()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.deliveries d WHERE d.trip_id=NEW.trip_id AND d.id<>NEW.id AND lower(btrim(d.recipient_company))<>lower(btrim(NEW.recipient_company))) THEN
  RAISE EXCEPTION 'Un viaje no puede mezclar compradores: separa la carga en viajes distintos' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS control_single_trip_buyer ON public.deliveries;
CREATE TRIGGER control_single_trip_buyer BEFORE INSERT OR UPDATE OF recipient_company,trip_id ON public.deliveries FOR EACH ROW EXECUTE FUNCTION public.enforce_single_trip_buyer();

CREATE OR REPLACE FUNCTION public.enforce_evidence_and_variance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid; v_origin numeric; v_dest numeric; v_field numeric; v_accepted numeric; v_rejected numeric; v_kg numeric:=10; v_percent numeric:=2; v_threshold numeric;
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
 SELECT sum(loaded_weight_kg) INTO v_field FROM public.trip_lots WHERE trip_id=NEW.trip_id;
 SELECT limit_kg,limit_percent INTO v_kg,v_percent FROM public.organization_variance_settings WHERE organization_id=v_org;
 v_kg:=coalesce(v_kg,10);v_percent:=coalesce(v_percent,2);v_threshold:=greatest(v_kg,abs(coalesce(v_origin,0))*v_percent/100);
 v_accepted:=NEW.accepted_weight_kg;v_rejected:=NEW.rejected_weight_kg;
 IF (v_field IS NOT NULL AND v_origin IS NOT NULL AND abs(v_field-v_origin)>v_threshold)
 OR (v_origin IS NOT NULL AND v_dest IS NOT NULL AND abs(v_origin-v_dest)>v_threshold)
 OR (v_dest IS NOT NULL AND v_accepted IS NOT NULL AND v_rejected IS NOT NULL AND abs(v_dest-v_accepted-v_rejected)>v_threshold)
 THEN
  IF NOT EXISTS(SELECT 1 FROM public.trip_variance_reviews r WHERE r.trip_id=NEW.trip_id) THEN
   RAISE EXCEPTION 'La diferencia supera la tolerancia: registra una explicación antes de cerrar';
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS control_weighing_evidence ON public.weighings;
CREATE TRIGGER control_weighing_evidence BEFORE INSERT ON public.weighings FOR EACH ROW EXECUTE FUNCTION public.enforce_evidence_and_variance();
DROP TRIGGER IF EXISTS control_delivery_evidence ON public.delivery_evidence;
CREATE TRIGGER control_delivery_evidence BEFORE INSERT ON public.delivery_evidence FOR EACH ROW EXECUTE FUNCTION public.enforce_evidence_and_variance();
DROP TRIGGER IF EXISTS control_delivery_close ON public.deliveries;
CREATE TRIGGER control_delivery_close BEFORE UPDATE OF status ON public.deliveries FOR EACH ROW EXECUTE FUNCTION public.enforce_evidence_and_variance();

-- La evidencia y sus mediciones se conservan. Una corrección se anota en un registro nuevo.
REVOKE UPDATE, DELETE ON public.weighings,public.harvest_evidence,public.delivery_evidence,public.trip_variance_reviews,public.trip_correction_notes FROM authenticated;
COMMIT;
