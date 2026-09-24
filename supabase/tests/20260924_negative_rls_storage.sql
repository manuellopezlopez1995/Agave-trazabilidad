-- Ejecutar DESPUÉS de 20260924_pilot_hardening.sql.
-- La transacción siempre termina en ROLLBACK; no conserva fixtures ni archivos.
BEGIN;

DO $$
DECLARE
  v_admin_org uuid; v_other_org uuid:=gen_random_uuid();
  v_farm uuid; v_other_farm uuid:=gen_random_uuid();
  v_crew uuid; v_other_crew uuid:=gen_random_uuid();
  v_harvest uuid; v_other_harvest uuid:=gen_random_uuid();
  v_trip uuid; v_other_trip uuid:=gen_random_uuid();
  v_delivery uuid; v_other_delivery uuid:=gen_random_uuid();
  v_user record; v_count integer; v_rows integer; v_path text; v_denied boolean;
  v_suffix text:=replace(gen_random_uuid()::text,'-','');
BEGIN
  SELECT om.organization_id INTO STRICT v_admin_org
  FROM public.organization_members om JOIN auth.users u ON u.id=om.profile_id
  WHERE lower(u.email)='agaveramanuel1@hotmail.com' AND om.active=true;
  SELECT id INTO STRICT v_farm FROM public.farms WHERE organization_id=v_admin_org LIMIT 1;
  SELECT id INTO STRICT v_crew FROM public.crews WHERE organization_id=v_admin_org LIMIT 1;
  SELECT id INTO STRICT v_harvest FROM public.harvest_orders WHERE organization_id=v_admin_org LIMIT 1;
  SELECT id INTO STRICT v_trip FROM public.trips WHERE organization_id=v_admin_org LIMIT 1;
  SELECT id INTO STRICT v_delivery FROM public.deliveries WHERE organization_id=v_admin_org LIMIT 1;

  -- Fixtures completos de una segunda organización. Se clonan para conservar cualquier
  -- columna NOT NULL propia del esquema instalado y se revierten al terminar.
  INSERT INTO public.organizations
  SELECT (jsonb_populate_record(NULL::public.organizations,to_jsonb(x)||jsonb_build_object(
    'id',v_other_org,'name','RLS OTHER '||v_suffix,'slug','rls-other-'||v_suffix,
    'code','RLS-'||left(v_suffix,16),'rfc','XAXX010101000-'||left(v_suffix,8),'tax_id','RLS-'||v_suffix))).*
  FROM public.organizations x WHERE id=v_admin_org;
  INSERT INTO public.farms
  SELECT (jsonb_populate_record(NULL::public.farms,to_jsonb(x)||jsonb_build_object(
    'id',v_other_farm,'organization_id',v_other_org,'code','RLS-FARM-'||left(v_suffix,12),'name','Predio RLS ajeno'))).*
  FROM public.farms x WHERE id=v_farm;
  INSERT INTO public.crews
  SELECT (jsonb_populate_record(NULL::public.crews,to_jsonb(x)||jsonb_build_object(
    'id',v_other_crew,'organization_id',v_other_org,'code','RLS-CREW-'||left(v_suffix,12),'name','Cuadrilla RLS ajena','crew_leader_id',NULL))).*
  FROM public.crews x WHERE id=v_crew;
  INSERT INTO public.harvest_orders
  SELECT (jsonb_populate_record(NULL::public.harvest_orders,to_jsonb(x)||jsonb_build_object(
    'id',v_other_harvest,'organization_id',v_other_org,'farm_id',v_other_farm,'crew_id',v_other_crew,
    'trace_code','RLS-H-'||left(v_suffix,16),'status','ASSIGNED','started_at',NULL,'completed_at',NULL))).*
  FROM public.harvest_orders x WHERE id=v_harvest;
  INSERT INTO public.trips
  SELECT (jsonb_populate_record(NULL::public.trips,to_jsonb(x)||jsonb_build_object(
    'id',v_other_trip,'organization_id',v_other_org,'origin_farm_id',v_other_farm,
    'trace_code','RLS-T-'||left(v_suffix,16),'status','ASSIGNED','driver_id',NULL,'loaded_at',NULL,'departed_at',NULL,'arrived_at',NULL,'delivered_at',NULL))).*
  FROM public.trips x WHERE id=v_trip;
  INSERT INTO public.deliveries
  SELECT (jsonb_populate_record(NULL::public.deliveries,to_jsonb(x)||jsonb_build_object(
    'id',v_other_delivery,'organization_id',v_other_org,'trip_id',v_other_trip,
    'trace_code','RLS-D-'||left(v_suffix,16),'status','PENDING','received_at',NULL))).*
  FROM public.deliveries x WHERE id=v_delivery;

  INSERT INTO storage.objects(id,bucket_id,name) VALUES
    (gen_random_uuid(),'harvest-evidence',v_other_org||'/'||v_other_harvest||'/'||gen_random_uuid()||'/'||gen_random_uuid()||'.jpg'),
    (gen_random_uuid(),'delivery-evidence',v_other_org||'/'||v_other_delivery||'/'||gen_random_uuid()||'/'||gen_random_uuid()||'.jpg'),
    (gen_random_uuid(),'weighing-tickets',v_other_org||'/'||v_other_trip||'/'||gen_random_uuid()||'/'||gen_random_uuid()||'.jpg');
  FOR v_user IN
    SELECT u.id,u.email,p.role::text AS app_role
    FROM auth.users u JOIN public.profiles p ON p.id=u.id
    WHERE lower(u.email) IN ('agaveramanuel1@hotmail.com','crew_leader@outlook.com','driver_agave@outlook.com')
    ORDER BY u.email
  LOOP
    PERFORM set_config('request.jwt.claim.sub',v_user.id::text,true);
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    -- SELECT ajeno debe ser invisible.
    SELECT count(*) INTO v_count FROM public.farms WHERE id=v_other_farm;
    IF v_count<>0 THEN RAISE EXCEPTION 'RLS FAIL [%]: pudo leer predio ajeno',v_user.email; END IF;

    -- INSERT con organization_id ajena debe ser rechazado por WITH CHECK.
    v_denied:=false;
    BEGIN
      EXECUTE format('INSERT INTO public.farms(organization_id,code,name,state,country,created_by) VALUES(%L,%L,%L,%L,%L,%L)',v_other_org,'RLS-ATTEMPT-'||left(v_suffix,8), 'Intento ajeno','Jalisco','México',v_user.id);
    EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
    END;
    IF NOT v_denied THEN RAISE EXCEPTION 'RLS FAIL [%]: pudo insertar predio en organización ajena',v_user.email; END IF;

    -- UPDATE ajeno debe afectar cero filas (o carecer de privilegio de tabla).
    BEGIN
      UPDATE public.farms SET name=name WHERE id=v_other_farm;
      GET DIAGNOSTICS v_rows=ROW_COUNT;
      IF v_rows<>0 THEN RAISE EXCEPTION 'RLS FAIL [%]: pudo actualizar predio ajeno',v_user.email; END IF;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- Las tablas de estados ya no admiten UPDATE directo, ni siquiera sobre registros propios.
    v_denied:=false;
    BEGIN EXECUTE format('UPDATE public.harvest_orders SET status=status WHERE id=%L',v_harvest);
    EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
    IF NOT v_denied THEN RAISE EXCEPTION 'GRANT FAIL [%]: UPDATE directo de estado sigue habilitado',v_user.email; END IF;

    -- Ningún objeto Storage de otra organización debe ser visible.
    SELECT count(*) INTO v_count FROM storage.objects
    WHERE bucket_id IN ('harvest-evidence','delivery-evidence','weighing-tickets')
      AND (storage.foldername(name))[1]=v_other_org::text;
    IF v_count<>0 THEN RAISE EXCEPTION 'STORAGE RLS FAIL [%]: pudo leer objetos ajenos',v_user.email; END IF;

    -- Tampoco puede fabricar una ruta hacia una entidad ajena.
    IF v_user.app_role IN ('ADMIN','CREW_LEADER') THEN
      v_path:=v_other_org||'/'||v_other_harvest||'/'||v_user.id||'/'||gen_random_uuid()||'.jpg';
      v_denied:=false;
      BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('harvest-evidence',v_path);
      EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
      IF NOT v_denied THEN RAISE EXCEPTION 'STORAGE FAIL [%]: pudo insertar foto de jima ajena',v_user.email; END IF;
    END IF;
    IF v_user.app_role IN ('ADMIN','DRIVER') THEN
      v_path:=v_other_org||'/'||v_other_delivery||'/'||v_user.id||'/'||gen_random_uuid()||'.jpg';
      v_denied:=false;
      BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('delivery-evidence',v_path);
      EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
      IF NOT v_denied THEN RAISE EXCEPTION 'STORAGE FAIL [%]: pudo insertar recibo ajeno',v_user.email; END IF;
      v_path:=v_other_org||'/'||v_other_trip||'/'||v_user.id||'/'||gen_random_uuid()||'.jpg';
      v_denied:=false;
      BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('weighing-tickets',v_path);
      EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
      IF NOT v_denied THEN RAISE EXCEPTION 'STORAGE FAIL [%]: pudo insertar ticket ajeno',v_user.email; END IF;
    END IF;

    RAISE NOTICE 'PASS % (%): lectura/escritura ajena, UPDATE directo y Storage bloqueados',v_user.email,v_user.app_role;
    EXECUTE 'RESET ROLE';
  END LOOP;

  RAISE NOTICE 'RLS_NEGATIVE_WRITE_STORAGE_PASS: 3 usuarios verificados; fixtures temporales se revertirán';
END
$$;

ROLLBACK;
