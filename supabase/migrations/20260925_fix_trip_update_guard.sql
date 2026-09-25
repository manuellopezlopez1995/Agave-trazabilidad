-- En un disparador BEFORE UPDATE, devolver OLD descarta silenciosamente
-- cualquier cambio autorizado. Los viajes conciliados siguen bloqueados.
CREATE OR REPLACE FUNCTION public.protect_approved_trip() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_trip uuid;
BEGIN
 IF TG_TABLE_NAME='trips' THEN
  v_trip:=OLD.id;
 ELSIF TG_TABLE_NAME IN ('deliveries','weighings','trip_lots') THEN
  v_trip:=OLD.trip_id;
 ELSE
  RAISE EXCEPTION 'Tabla no admitida en protección de viajes';
 END IF;
 IF EXISTS(SELECT 1 FROM public.trip_closures WHERE trip_id=v_trip) THEN
  RAISE EXCEPTION 'Viaje conciliado: registra una nota de ajuste; no cambies los datos originales' USING ERRCODE='check_violation';
 END IF;
 IF TG_OP='UPDATE' THEN
  RETURN NEW;
 END IF;
 RETURN OLD;
END $$;
