-- Preserve existing weighings and RLS; add only optional immutable recognition metadata.
ALTER TABLE public.weighings ADD COLUMN IF NOT EXISTS ocr_reading jsonb;
ALTER TABLE public.weighings ADD COLUMN IF NOT EXISTS ocr_corrected_fields text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.weighings ADD COLUMN IF NOT EXISTS ticket_sha256 text;
ALTER TABLE public.weighings ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS weighing_ticket_sha256_unique
 ON public.weighings(ticket_sha256) WHERE ticket_sha256 IS NOT NULL;
ALTER TABLE public.weighings ADD CONSTRAINT weighing_ocr_reading_object
 CHECK (ocr_reading IS NULL OR jsonb_typeof(ocr_reading)='object');
ALTER TABLE public.weighings ADD CONSTRAINT weighing_sha256_format
 CHECK (ticket_sha256 IS NULL OR ticket_sha256 ~ '^[0-9a-f]{64}$');
-- Existing validate_pilot_weighing already checks gross > tare, net and trip status.
-- This guard covers metadata without changing historical NULL values.
CREATE OR REPLACE FUNCTION public.validate_ticket_ocr_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.ticket_sha256 IS NOT NULL THEN
  IF NEW.ocr_reading IS NULL OR NEW.confirmed_at IS NULL THEN
   RAISE EXCEPTION 'La lectura del ticket requiere revisión y confirmación' USING ERRCODE='check_violation';
  END IF;
  IF NOT (NEW.ocr_corrected_fields <@ ARRAY['gross','tare','folio','printedNet']::text[]) THEN
   RAISE EXCEPTION 'Campo corregido no reconocido' USING ERRCODE='check_violation';
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND (OLD.ocr_reading IS DISTINCT FROM NEW.ocr_reading OR OLD.ticket_sha256 IS DISTINCT FROM NEW.ticket_sha256 OR OLD.ocr_corrected_fields IS DISTINCT FROM NEW.ocr_corrected_fields OR OLD.confirmed_at IS DISTINCT FROM NEW.confirmed_at) THEN
  RAISE EXCEPTION 'No se puede sobrescribir la lectura original del ticket' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS weighing_ticket_ocr_audit ON public.weighings;
CREATE TRIGGER weighing_ticket_ocr_audit BEFORE INSERT OR UPDATE ON public.weighings
FOR EACH ROW EXECUTE FUNCTION public.validate_ticket_ocr_audit();
