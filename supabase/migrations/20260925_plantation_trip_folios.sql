-- El folio pertenece al ID de plantación, no al código interno del predio.
ALTER TABLE public.farms ADD COLUMN IF NOT EXISTS plantation_id text;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS plantation_folio text;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS plantation_trip_number integer;

ALTER TABLE public.farms ADD CONSTRAINT farms_plantation_id_format
 CHECK (plantation_id IS NULL OR plantation_id ~ '^[0-9]{1,20}$');
ALTER TABLE public.trips ADD CONSTRAINT trips_plantation_folio_pair
 CHECK ((plantation_folio IS NULL AND plantation_trip_number IS NULL)
     OR (plantation_folio IS NOT NULL AND plantation_trip_number > 0 AND origin_farm_id IS NOT NULL));
CREATE UNIQUE INDEX farms_org_plantation_id_unique ON public.farms(organization_id,plantation_id) WHERE plantation_id IS NOT NULL;
CREATE UNIQUE INDEX trips_org_farm_sequence_unique ON public.trips(organization_id,origin_farm_id,plantation_trip_number) WHERE plantation_trip_number IS NOT NULL;
CREATE UNIQUE INDEX trips_org_plantation_folio_unique ON public.trips(organization_id,plantation_folio) WHERE plantation_folio IS NOT NULL;
CREATE UNIQUE INDEX trip_lots_unique_lot_assignment ON public.trip_lots(agave_lot_id);

CREATE OR REPLACE FUNCTION public.protect_plantation_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='trips' AND TG_OP='INSERT' THEN
  IF auth.uid() IS NOT NULL AND current_setting('app.creating_plantation_trip',true) IS DISTINCT FROM 'yes' THEN
   RAISE EXCEPTION 'Crea el viaje con su folio desde la función de plantaciones';
  END IF;
  RETURN NEW;
 ELSIF TG_TABLE_NAME='farms' THEN
  IF OLD.plantation_id IS NOT NULL AND NEW.plantation_id IS DISTINCT FROM OLD.plantation_id THEN
   RAISE EXCEPTION 'No se puede cambiar el ID de plantación una vez asignado';
  END IF;
 ELSE
  IF OLD.plantation_folio IS NOT NULL AND (NEW.plantation_folio IS DISTINCT FROM OLD.plantation_folio
    OR NEW.plantation_trip_number IS DISTINCT FROM OLD.plantation_trip_number
    OR NEW.origin_farm_id IS DISTINCT FROM OLD.origin_farm_id) THEN
   RAISE EXCEPTION 'El folio de un viaje emitido es inalterable';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_farm_plantation_id BEFORE UPDATE ON public.farms
 FOR EACH ROW EXECUTE FUNCTION public.protect_plantation_identity();
CREATE TRIGGER protect_trip_plantation_folio BEFORE INSERT OR UPDATE ON public.trips
 FOR EACH ROW EXECUTE FUNCTION public.protect_plantation_identity();

CREATE OR REPLACE FUNCTION public.check_trip_lot_plantation() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.trips t JOIN public.agave_lots l ON l.id=NEW.agave_lot_id
   WHERE t.id=NEW.trip_id AND t.origin_farm_id=l.farm_id AND t.organization_id=l.organization_id) THEN
  RAISE EXCEPTION 'El lote debe pertenecer a la misma plantación que el viaje';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_trip_lot_plantation BEFORE INSERT OR UPDATE ON public.trip_lots
 FOR EACH ROW EXECUTE FUNCTION public.check_trip_lot_plantation();

-- Permite asignar una sola vez el ID real a un predio anterior, y folia sus viajes históricos.
CREATE OR REPLACE FUNCTION public.assign_plantation_id(p_farm_id uuid,p_plantation_id text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_farm public.farms%ROWTYPE; v_trip record; v_number integer:=0;
BEGIN
 SELECT * INTO v_farm FROM public.farms WHERE id=p_farm_id FOR UPDATE;
 IF NOT FOUND OR NOT public.is_admin_of_org(v_farm.organization_id) THEN
  RAISE EXCEPTION 'Sin permiso para asignar el ID de plantación' USING ERRCODE='insufficient_privilege';
 END IF;
 IF p_plantation_id IS NULL OR p_plantation_id !~ '^[0-9]{1,20}$' THEN
  RAISE EXCEPTION 'El ID de plantación debe tener de 1 a 20 dígitos';
 END IF;
 IF v_farm.plantation_id IS NOT NULL THEN RAISE EXCEPTION 'Este predio ya tiene un ID de plantación'; END IF;
 UPDATE public.farms SET plantation_id=p_plantation_id WHERE id=p_farm_id;
 FOR v_trip IN SELECT id FROM public.trips WHERE origin_farm_id=p_farm_id
   ORDER BY created_at,id FOR UPDATE LOOP
  v_number:=v_number+1;
  UPDATE public.trips SET plantation_trip_number=v_number,plantation_folio=p_plantation_id||'-'||v_number WHERE id=v_trip.id;
 END LOOP;
 RETURN v_number;
END $$;

-- Un bloqueo de la fila del predio serializa el contador incluso con dos administradores simultáneos.
CREATE OR REPLACE FUNCTION public.create_plantation_trip(p_lot_id uuid,p_driver_id uuid,p_destination text,p_vehicle_plate text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_lot public.agave_lots%ROWTYPE; v_farm public.farms%ROWTYPE; v_org uuid; v_trip uuid; v_next integer;
BEGIN
 SELECT * INTO v_lot FROM public.agave_lots WHERE id=p_lot_id FOR UPDATE;
 IF NOT FOUND OR NOT public.is_admin_of_org(v_lot.organization_id) THEN
  RAISE EXCEPTION 'Sin permiso para crear el viaje' USING ERRCODE='insufficient_privilege';
 END IF;
 v_org:=v_lot.organization_id;
 SELECT * INTO v_farm FROM public.farms WHERE id=v_lot.farm_id AND organization_id=v_org FOR UPDATE;
 IF NOT FOUND OR v_farm.plantation_id IS NULL THEN RAISE EXCEPTION 'Asigna primero el ID de plantación al predio'; END IF;
 IF v_lot.status::text<>'HARVESTED' OR NOT EXISTS
   (SELECT 1 FROM public.harvest_orders h WHERE h.id=v_lot.harvest_order_id AND h.farm_id=v_farm.id AND h.status::text='HARVESTED') THEN
  RAISE EXCEPTION 'La jima y el lote deben estar cosechados';
 END IF;
 IF EXISTS(SELECT 1 FROM public.trip_lots WHERE agave_lot_id=p_lot_id) THEN RAISE EXCEPTION 'Este lote ya tiene viaje'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.organization_members m ON m.profile_id=p.id
   WHERE p.id=p_driver_id AND p.role::text='DRIVER' AND p.status::text='ACTIVE' AND m.organization_id=v_org AND m.active) THEN
  RAISE EXCEPTION 'El chofer debe estar activo en esta organización';
 END IF;
 IF nullif(btrim(p_destination),'') IS NULL OR length(btrim(p_destination))>120
   OR nullif(btrim(p_vehicle_plate),'') IS NULL OR length(btrim(p_vehicle_plate))>25 THEN
  RAISE EXCEPTION 'Destino y placa son obligatorios y deben tener longitud válida';
 END IF;
 SELECT coalesce(max(plantation_trip_number),0)+1 INTO v_next FROM public.trips WHERE origin_farm_id=v_farm.id;
 PERFORM set_config('app.creating_plantation_trip','yes',true);
 INSERT INTO public.trips(organization_id,driver_id,origin_farm_id,destination_name,vehicle_plate,status,created_by,plantation_folio,plantation_trip_number)
 VALUES(v_org,p_driver_id,v_farm.id,btrim(p_destination),upper(btrim(p_vehicle_plate)),'ASSIGNED',auth.uid(),v_farm.plantation_id||'-'||v_next,v_next) RETURNING id INTO v_trip;
 INSERT INTO public.trip_lots(trip_id,agave_lot_id,loaded_weight_kg,loaded_agave_count,created_by)
 VALUES(v_trip,p_lot_id,v_lot.actual_weight_kg,v_lot.agave_count,auth.uid());
 INSERT INTO public.deliveries(organization_id,trip_id,recipient_company,status,created_by)
 VALUES(v_org,v_trip,btrim(p_destination),'PENDING',auth.uid());
 RETURN v_trip;
END $$;

REVOKE ALL ON FUNCTION public.assign_plantation_id(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.create_plantation_trip(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assign_plantation_id(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_plantation_trip(uuid,uuid,text,text) TO authenticated;
