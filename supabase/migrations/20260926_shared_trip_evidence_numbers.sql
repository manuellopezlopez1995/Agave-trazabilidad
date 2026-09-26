-- Identificador público de evidencia: folio de viaje + contador transaccional único.
-- Las filas anteriores a esta migración conservan sus valores y no reciben folio nuevo.
BEGIN;

ALTER TABLE public.harvest_evidence ADD COLUMN IF NOT EXISTS evidence_number bigint;
ALTER TABLE public.harvest_evidence ADD COLUMN IF NOT EXISTS evidence_code text;
ALTER TABLE public.weighings ADD COLUMN IF NOT EXISTS evidence_number bigint;
ALTER TABLE public.weighings ADD COLUMN IF NOT EXISTS evidence_code text;
ALTER TABLE public.delivery_evidence ADD COLUMN IF NOT EXISTS evidence_number bigint;
ALTER TABLE public.delivery_evidence ADD COLUMN IF NOT EXISTS evidence_code text;

CREATE TABLE IF NOT EXISTS public.trip_evidence_counters (
 trip_id uuid PRIMARY KEY REFERENCES public.trips(id) ON DELETE RESTRICT,
 last_number bigint NOT NULL CHECK(last_number>0)
);
CREATE TABLE IF NOT EXISTS public.trip_evidence_register (
 trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE RESTRICT,
 evidence_number bigint NOT NULL CHECK(evidence_number>0),
 evidence_code text NOT NULL,
 source_table text NOT NULL CHECK(source_table IN ('harvest_evidence','weighings','delivery_evidence')),
 source_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(trip_id,evidence_number),
 UNIQUE(trip_id,evidence_code),
 UNIQUE(source_table,source_id)
);
ALTER TABLE public.trip_evidence_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_evidence_register ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trip_evidence_counters,public.trip_evidence_register FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.assign_trip_evidence_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_trip_id uuid; v_folio text; v_number bigint;
BEGIN
 IF TG_TABLE_NAME='harvest_evidence' THEN
  SELECT id,plantation_folio INTO v_trip_id,v_folio FROM public.trips
  WHERE harvest_order_id=NEW.harvest_order_id ORDER BY created_at LIMIT 1;
 ELSIF TG_TABLE_NAME='weighings' THEN
  IF NEW.ticket_storage_path IS NULL THEN RETURN NEW; END IF;
  v_trip_id:=NEW.trip_id;
  SELECT plantation_folio INTO v_folio FROM public.trips WHERE id=v_trip_id;
 ELSIF TG_TABLE_NAME='delivery_evidence' THEN
  SELECT t.id,t.plantation_folio INTO v_trip_id,v_folio
  FROM public.deliveries d JOIN public.trips t ON t.id=d.trip_id WHERE d.id=NEW.delivery_id;
 ELSE RAISE EXCEPTION 'Tipo de evidencia no reconocido'; END IF;
 IF v_trip_id IS NULL OR v_folio IS NULL THEN
  RAISE EXCEPTION 'La fotografía requiere un viaje vinculado con folio de plantación';
 END IF;
 -- UPSERT bloquea exclusivamente la fila de este viaje; los fallos revierten el contador.
 INSERT INTO public.trip_evidence_counters AS c(trip_id,last_number)
 VALUES(v_trip_id,1)
 ON CONFLICT(trip_id) DO UPDATE SET last_number=c.last_number+1
 RETURNING last_number INTO v_number;
 NEW.evidence_number:=v_number;
 NEW.evidence_code:=v_folio||'-'||v_number;
 INSERT INTO public.trip_evidence_register(trip_id,evidence_number,evidence_code,source_table,source_id)
 VALUES(v_trip_id,v_number,NEW.evidence_code,TG_TABLE_NAME,NEW.id);
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.assign_trip_evidence_number() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER number_harvest_photo BEFORE INSERT ON public.harvest_evidence
 FOR EACH ROW EXECUTE FUNCTION public.assign_trip_evidence_number();
CREATE TRIGGER number_weighing_ticket BEFORE INSERT ON public.weighings
 FOR EACH ROW EXECUTE FUNCTION public.assign_trip_evidence_number();
CREATE TRIGGER number_delivery_photo BEFORE INSERT ON public.delivery_evidence
 FOR EACH ROW EXECUTE FUNCTION public.assign_trip_evidence_number();

CREATE OR REPLACE FUNCTION public.protect_trip_evidence_number()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.evidence_number IS DISTINCT FROM OLD.evidence_number OR NEW.evidence_code IS DISTINCT FROM OLD.evidence_code THEN
  RAISE EXCEPTION 'El identificador histórico de evidencia no puede cambiar';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER protect_harvest_photo_number BEFORE UPDATE ON public.harvest_evidence
 FOR EACH ROW EXECUTE FUNCTION public.protect_trip_evidence_number();
CREATE TRIGGER protect_weighing_ticket_number BEFORE UPDATE ON public.weighings
 FOR EACH ROW EXECUTE FUNCTION public.protect_trip_evidence_number();
CREATE TRIGGER protect_delivery_photo_number BEFORE UPDATE ON public.delivery_evidence
 FOR EACH ROW EXECUTE FUNCTION public.protect_trip_evidence_number();
COMMIT;
