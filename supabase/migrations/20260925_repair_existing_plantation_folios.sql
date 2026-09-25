-- Corrige los viajes históricos cuyo predio recibió un ID por separado.
-- Cada folio emitido permanece intacto; los faltantes reciben el primer número disponible.
CREATE OR REPLACE FUNCTION public.assign_plantation_id(p_farm_id uuid,p_plantation_id text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_farm public.farms%ROWTYPE; v_trip record; v_number integer:=0; v_count integer:=0;
BEGIN
 SELECT * INTO v_farm FROM public.farms WHERE id=p_farm_id FOR UPDATE;
 IF NOT FOUND OR NOT public.is_admin_of_org(v_farm.organization_id) THEN
  RAISE EXCEPTION 'Sin permiso para asignar el ID de plantación' USING ERRCODE='insufficient_privilege';
 END IF;
 IF p_plantation_id IS NULL OR p_plantation_id !~ '^[0-9]{1,20}$' THEN
  RAISE EXCEPTION 'El ID de plantación debe tener de 1 a 20 dígitos';
 END IF;
 IF v_farm.plantation_id IS NOT NULL AND v_farm.plantation_id<>p_plantation_id THEN
  RAISE EXCEPTION 'El ID de plantación asignado no se puede cambiar';
 END IF;
 IF v_farm.plantation_id IS NULL THEN
  UPDATE public.farms SET plantation_id=p_plantation_id WHERE id=p_farm_id;
 END IF;
 FOR v_trip IN SELECT id,plantation_folio,plantation_trip_number FROM public.trips
   WHERE origin_farm_id=p_farm_id ORDER BY created_at,id FOR UPDATE LOOP
  IF v_trip.plantation_folio IS NOT NULL THEN
   IF v_trip.plantation_folio<>p_plantation_id||'-'||v_trip.plantation_trip_number THEN
    RAISE EXCEPTION 'Hay un folio de otra plantación; revisión manual necesaria';
   END IF;
   v_number:=greatest(v_number,v_trip.plantation_trip_number);
  ELSE
   v_number:=v_number+1;
   WHILE EXISTS(SELECT 1 FROM public.trips WHERE origin_farm_id=p_farm_id AND plantation_trip_number=v_number) LOOP
    v_number:=v_number+1;
   END LOOP;
   UPDATE public.trips SET plantation_trip_number=v_number,plantation_folio=p_plantation_id||'-'||v_number WHERE id=v_trip.id;
   v_count:=v_count+1;
  END IF;
 END LOOP;
 RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.assign_plantation_id(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assign_plantation_id(uuid,text) TO authenticated;

-- Repara de forma atómica todos los predios a los que ya se les asignó ID.
DO $$
DECLARE v_farm record; v_admin uuid;
BEGIN
 FOR v_farm IN SELECT f.id,f.organization_id,f.plantation_id FROM public.farms f
   WHERE f.plantation_id IS NOT NULL AND EXISTS
   (SELECT 1 FROM public.trips t WHERE t.origin_farm_id=f.id AND t.plantation_folio IS NULL) LOOP
  SELECT m.profile_id INTO v_admin FROM public.organization_members m JOIN public.profiles p ON p.id=m.profile_id
   WHERE m.organization_id=v_farm.organization_id AND m.active AND p.role::text='ADMIN' AND p.status::text='ACTIVE' LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'Falta un administrador activo para reparar la plantación %',v_farm.plantation_id; END IF;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM public.assign_plantation_id(v_farm.id,v_farm.plantation_id);
 END LOOP;
END $$;
