-- Ejecutar después de 20260924_operations_control.sql.
BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.trip_closures (
 trip_id uuid PRIMARY KEY REFERENCES public.trips(id),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 approved_by uuid NOT NULL REFERENCES public.profiles(id),
 approved_at timestamptz NOT NULL DEFAULT now(),
 checklist jsonb NOT NULL,
 CONSTRAINT closure_checklist_object CHECK (jsonb_typeof(checklist)='object')
);
ALTER TABLE public.trip_closures ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.trip_closures TO authenticated;
CREATE POLICY closure_org_read ON public.trip_closures FOR SELECT TO authenticated
 USING (public.is_admin_of_org(organization_id) OR public.can_driver_manage_trip(trip_id));

-- La lista se calcula en el servidor, con datos actuales, no con el estado del navegador.
CREATE FUNCTION public.trip_closure_gaps(p_trip_id uuid) RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_trip public.trips%ROWTYPE; v_gaps text[]:=ARRAY[]::text[]; v_field numeric; v_origin numeric; v_dest numeric;
 v_accepted numeric; v_rejected numeric; v_kg numeric:=10; v_percent numeric:=2; v_limit numeric;
BEGIN
 SELECT * INTO v_trip FROM public.trips WHERE id=p_trip_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Viaje no encontrado'; END IF;
 IF NOT public.is_admin_of_org(v_trip.organization_id) AND NOT public.can_driver_manage_trip(p_trip_id)
 THEN RAISE EXCEPTION 'Sin acceso a este viaje' USING ERRCODE='insufficient_privilege'; END IF;
 IF v_trip.status::text<>'DELIVERED' THEN v_gaps:=array_append(v_gaps,'El viaje aún no se entregó'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.trip_lots WHERE trip_id=p_trip_id) THEN v_gaps:=array_append(v_gaps,'No hay lotes cargados'); END IF;
 SELECT sum(loaded_weight_kg) INTO v_field FROM public.trip_lots WHERE trip_id=p_trip_id;
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
 IF (v_field IS NOT NULL AND v_origin IS NOT NULL AND abs(v_field-v_origin)>v_limit)
  OR (v_origin IS NOT NULL AND v_dest IS NOT NULL AND abs(v_origin-v_dest)>v_limit)
  OR (v_dest IS NOT NULL AND v_accepted IS NOT NULL AND v_rejected IS NOT NULL AND abs(v_dest-v_accepted-v_rejected)>v_limit)
 THEN
  IF NOT EXISTS(SELECT 1 FROM public.trip_variance_reviews WHERE trip_id=p_trip_id AND length(btrim(reason))>=10)
  THEN v_gaps:=array_append(v_gaps,'Diferencia fuera de tolerancia sin explicación'); END IF;
 END IF;
 RETURN v_gaps;
END $$;
REVOKE ALL ON FUNCTION public.trip_closure_gaps(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trip_closure_gaps(uuid) TO authenticated;

CREATE FUNCTION public.approve_trip_closure(p_trip_id uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid; v_gaps text[]; v_at timestamptz;
BEGIN
 SELECT organization_id INTO v_org FROM public.trips WHERE id=p_trip_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Viaje no encontrado'; END IF;
 IF NOT public.is_admin_of_org(v_org) THEN RAISE EXCEPTION 'Sólo administración puede aprobar el cierre' USING ERRCODE='insufficient_privilege'; END IF;
 IF EXISTS(SELECT 1 FROM public.trip_closures WHERE trip_id=p_trip_id) THEN RAISE EXCEPTION 'Este viaje ya está conciliado'; END IF;
 v_gaps:=public.trip_closure_gaps(p_trip_id);
 IF cardinality(v_gaps)>0 THEN RAISE EXCEPTION 'Cierre pendiente: %',array_to_string(v_gaps,'; '); END IF;
 INSERT INTO public.trip_closures(trip_id,organization_id,approved_by,checklist)
 VALUES(p_trip_id,v_org,auth.uid(),jsonb_build_object('status','complete','checked_at',now(),'gaps',v_gaps)) RETURNING approved_at INTO v_at;
 RETURN v_at;
END $$;
REVOKE ALL ON FUNCTION public.approve_trip_closure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_trip_closure(uuid) TO authenticated;

CREATE TABLE public.buyer_dossier_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 harvest_order_id uuid NOT NULL REFERENCES public.harvest_orders(id),
 buyer_name text NOT NULL CHECK (length(btrim(buyer_name)) BETWEEN 2 AND 120),
 version integer NOT NULL CHECK (version>0),
 cutoff_at timestamptz NOT NULL DEFAULT now(),
 issued_by uuid NOT NULL REFERENCES public.profiles(id),
 snapshot jsonb NOT NULL,
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 UNIQUE(organization_id,harvest_order_id,buyer_name,version)
);
ALTER TABLE public.buyer_dossier_versions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.buyer_dossier_versions TO authenticated;
CREATE POLICY dossier_org_read ON public.buyer_dossier_versions FOR SELECT TO authenticated USING (public.is_admin_of_org(organization_id));

-- El servidor construye la instantánea. Las fotografías privadas se referencian por ruta;
-- el respaldo independiente de Storage preserva sus bytes.
CREATE FUNCTION public.finalize_buyer_dossier(p_harvest_id uuid,p_buyer text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid; v_buyer text:=btrim(regexp_replace(coalesce(p_buyer,''),'\s+',' ','g'));
 v_trip_ids uuid[]; v_snapshot jsonb; v_version integer; v_id uuid;
BEGIN
 SELECT organization_id INTO v_org FROM public.harvest_orders WHERE id=p_harvest_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Jima no encontrada'; END IF;
 IF NOT public.is_admin_of_org(v_org) THEN RAISE EXCEPTION 'Sólo administración puede emitir expedientes' USING ERRCODE='insufficient_privilege'; END IF;
 IF length(v_buyer) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'Comprador inválido'; END IF;
 -- Evita emitir dos versiones simultáneas del mismo comprador y jima.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_harvest_id::text||lower(v_buyer),0));
 SELECT array_agg(DISTINCT t.id) INTO v_trip_ids FROM public.trips t
 JOIN public.trip_lots tl ON tl.trip_id=t.id JOIN public.agave_lots l ON l.id=tl.agave_lot_id
 JOIN public.deliveries d ON d.trip_id=t.id
 WHERE l.harvest_order_id=p_harvest_id AND t.organization_id=v_org AND lower(btrim(d.recipient_company))=lower(v_buyer);
 IF coalesce(cardinality(v_trip_ids),0)=0 THEN RAISE EXCEPTION 'No hay camiones entregados a este comprador en la jima'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(v_trip_ids) id WHERE NOT EXISTS(SELECT 1 FROM public.trip_closures c WHERE c.trip_id=id))
 THEN RAISE EXCEPTION 'Aprueba la conciliación de todos los camiones del comprador antes de emitir'; END IF;
 SELECT jsonb_build_object('schema',1,'organization_id',v_org,'harvest',to_jsonb(h),
  'farm',(SELECT to_jsonb(f) FROM public.farms f WHERE f.id=h.farm_id),
  'crew',(SELECT to_jsonb(c) FROM public.crews c WHERE c.id=h.crew_id),
  'buyer',v_buyer,'trip_ids',to_jsonb(v_trip_ids),
  'drivers',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name)),'[]'::jsonb) FROM public.profiles p WHERE p.id IN (SELECT t.driver_id FROM public.trips t WHERE t.id=ANY(v_trip_ids))),
  'variance_settings',(SELECT to_jsonb(s) FROM public.organization_variance_settings s WHERE s.organization_id=v_org),
  'lots',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.trace_code),'[]'::jsonb) FROM public.agave_lots l WHERE l.harvest_order_id=p_harvest_id AND EXISTS(SELECT 1 FROM public.trip_lots tl WHERE tl.agave_lot_id=l.id AND tl.trip_id=ANY(v_trip_ids))),
  'trips',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.trace_code),'[]'::jsonb) FROM public.trips t WHERE t.id=ANY(v_trip_ids)),
  'links',(SELECT coalesce(jsonb_agg(to_jsonb(tl)),'[]'::jsonb) FROM public.trip_lots tl WHERE tl.trip_id=ANY(v_trip_ids)),
  'weighings',(SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) FROM public.weighings w WHERE w.trip_id=ANY(v_trip_ids)),
  'deliveries',(SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) FROM public.deliveries d WHERE d.trip_id=ANY(v_trip_ids)),
  'tickets',(SELECT coalesce(jsonb_agg(jsonb_build_object('bucket',w.storage_bucket,'path',w.ticket_storage_path)),'[]'::jsonb) FROM public.weighings w WHERE w.trip_id=ANY(v_trip_ids)),
  'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) FROM public.delivery_evidence e JOIN public.deliveries d ON d.id=e.delivery_id WHERE d.trip_id=ANY(v_trip_ids)),
  'harvest_evidence',(SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) FROM public.harvest_evidence e WHERE e.harvest_order_id=p_harvest_id),
  'approvals',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM public.trip_closures c WHERE c.trip_id=ANY(v_trip_ids)),
  'variance_reviews',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM public.trip_variance_reviews r WHERE r.trip_id=ANY(v_trip_ids)),
  'corrections',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM public.trip_correction_notes c WHERE c.trip_id=ANY(v_trip_ids))) INTO v_snapshot
 FROM public.harvest_orders h WHERE h.id=p_harvest_id;
 SELECT coalesce(max(version),0)+1 INTO v_version FROM public.buyer_dossier_versions WHERE harvest_order_id=p_harvest_id AND lower(buyer_name)=lower(v_buyer);
 INSERT INTO public.buyer_dossier_versions(organization_id,harvest_order_id,buyer_name,version,issued_by,snapshot,sha256)
 VALUES(v_org,p_harvest_id,v_buyer,v_version,auth.uid(),v_snapshot,encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex')) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.finalize_buyer_dossier(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_buyer_dossier(uuid,text) TO authenticated;

CREATE FUNCTION public.verify_buyer_dossier(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_row public.buyer_dossier_versions%ROWTYPE;
BEGIN
 SELECT * INTO v_row FROM public.buyer_dossier_versions WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Versión no encontrada'; END IF;
 IF NOT public.is_admin_of_org(v_row.organization_id) THEN RAISE EXCEPTION 'Sin acceso al expediente' USING ERRCODE='insufficient_privilege'; END IF;
 RETURN v_row.sha256=encode(extensions.digest(convert_to(v_row.snapshot::text,'UTF8'),'sha256'),'hex');
END $$;
REVOKE ALL ON FUNCTION public.verify_buyer_dossier(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_buyer_dossier(uuid) TO authenticated;

CREATE FUNCTION public.protect_approved_trip() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_trip uuid;
BEGIN
 IF TG_TABLE_NAME='trips' THEN v_trip:=OLD.id;
 ELSIF TG_TABLE_NAME='deliveries' OR TG_TABLE_NAME='weighings' OR TG_TABLE_NAME='trip_lots' THEN
  v_trip:=CASE WHEN TG_OP='INSERT' THEN NEW.trip_id ELSE OLD.trip_id END;
 ELSE RETURN COALESCE(NEW,OLD); END IF;
 IF EXISTS(SELECT 1 FROM public.trip_closures WHERE trip_id=v_trip) THEN
  RAISE EXCEPTION 'Viaje conciliado: registra una nota de ajuste; no cambies los datos originales' USING ERRCODE='check_violation';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER protect_closed_trip BEFORE UPDATE OR DELETE ON public.trips FOR EACH ROW EXECUTE FUNCTION public.protect_approved_trip();
CREATE TRIGGER protect_closed_delivery BEFORE INSERT OR UPDATE OR DELETE ON public.deliveries FOR EACH ROW EXECUTE FUNCTION public.protect_approved_trip();
CREATE TRIGGER protect_closed_weighing BEFORE INSERT OR UPDATE OR DELETE ON public.weighings FOR EACH ROW EXECUTE FUNCTION public.protect_approved_trip();
CREATE TRIGGER protect_closed_link BEFORE INSERT OR UPDATE OR DELETE ON public.trip_lots FOR EACH ROW EXECUTE FUNCTION public.protect_approved_trip();

-- Ni el navegador ni otro rol autenticado pueden cambiar o borrar cierres/versiones.
REVOKE INSERT,UPDATE,DELETE ON public.trip_closures,public.buyer_dossier_versions FROM authenticated;
COMMIT;
