BEGIN;
CREATE OR REPLACE FUNCTION public.protect_approved_trip() RETURNS trigger
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
DROP TRIGGER IF EXISTS protect_closed_delivery ON public.deliveries;
CREATE TRIGGER protect_closed_delivery BEFORE INSERT OR UPDATE OR DELETE ON public.deliveries FOR EACH ROW EXECUTE FUNCTION public.protect_approved_trip();
DROP TRIGGER IF EXISTS protect_closed_weighing ON public.weighings;
CREATE TRIGGER protect_closed_weighing BEFORE INSERT OR UPDATE OR DELETE ON public.weighings FOR EACH ROW EXECUTE FUNCTION public.protect_approved_trip();
DROP TRIGGER IF EXISTS protect_closed_link ON public.trip_lots;
CREATE TRIGGER protect_closed_link BEFORE INSERT OR UPDATE OR DELETE ON public.trip_lots FOR EACH ROW EXECUTE FUNCTION public.protect_approved_trip();
COMMIT;
