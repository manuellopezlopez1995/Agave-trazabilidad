-- Permite rectificar únicamente la hora impresa de un ticket de destino
-- entregado, con una nota administrativa previa. El cierre formal sigue
-- protegiendo el pesaje mediante protect_closed_weighing.
CREATE OR REPLACE FUNCTION public.validate_pilot_weighing()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_status text; v_arrived_at timestamptz; v_delivered_at timestamptz;
BEGIN
  SELECT status::text, arrived_at, delivered_at
    INTO v_status, v_arrived_at, v_delivered_at
    FROM public.trips WHERE id=NEW.trip_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El viaje no existe' USING ERRCODE='foreign_key_violation'; END IF;
  IF NEW.gross_weight_kg<=NEW.tare_weight_kg OR NEW.tare_weight_kg<0 OR NEW.gross_weight_kg>200000 THEN
    RAISE EXCEPTION 'Pesaje fuera de rango: el bruto debe superar la tara' USING ERRCODE='check_violation';
  END IF;
  IF abs(NEW.net_weight_kg-(NEW.gross_weight_kg-NEW.tare_weight_kg))>0.01 THEN
    RAISE EXCEPTION 'El peso neto no coincide con bruto menos tara' USING ERRCODE='check_violation';
  END IF;

  IF TG_OP='UPDATE' AND v_status='DELIVERED'
     AND NEW.weighing_type='DESTINATION'
     AND NEW.weighed_at IS DISTINCT FROM OLD.weighed_at
     AND (to_jsonb(NEW)-'weighed_at')=(to_jsonb(OLD)-'weighed_at')
     AND NEW.weighed_at BETWEEN v_arrived_at AND v_delivered_at
     AND EXISTS (
       SELECT 1 FROM public.trip_correction_notes c
       WHERE c.trip_id=NEW.trip_id
         AND c.field_name LIKE '%(weighed_at)%'
         AND c.corrected_value LIKE '%' || to_char(NEW.weighed_at AT TIME ZONE 'America/Mexico_City','DD/MM/YYYY HH24:MI') || '%'
     ) THEN
    RETURN NEW;
  END IF;

  IF NEW.weighing_type='ORIGIN' AND v_status NOT IN ('ASSIGNED','LOADING') THEN
    RAISE EXCEPTION 'El pesaje de origen sólo se registra antes de salir' USING ERRCODE='check_violation';
  ELSIF NEW.weighing_type='DESTINATION' AND v_status<>'ARRIVED' THEN
    RAISE EXCEPTION 'El pesaje de destino sólo se registra después de la llegada' USING ERRCODE='check_violation';
  ELSIF NEW.weighing_type NOT IN ('ORIGIN','DESTINATION') THEN
    RAISE EXCEPTION 'Tipo de pesaje no permitido' USING ERRCODE='check_violation';
  END IF;
  IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.weighings w WHERE w.trip_id=NEW.trip_id AND w.weighing_type=NEW.weighing_type) THEN
    RAISE EXCEPTION 'Ya existe el pesaje % para este viaje', NEW.weighing_type USING ERRCODE='unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
