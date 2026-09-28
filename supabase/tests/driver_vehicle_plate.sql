-- Integration regression. Run as postgres in a test session; every change is rolled back.
-- Uses an existing organization/farm as read-only references; no operational row is changed.
begin;
-- Avoid consuming production folio sequence for temporary delivery fixtures.
alter table public.deliveries alter column trace_code set default ('TEST-PLATE-'||gen_random_uuid()::text);
create temporary table plate_test_results(test text);
do $$
declare
 base public.trips%rowtype;
 actor uuid:=gen_random_uuid(); legacy uuid:=gen_random_uuid();
 h1 uuid:=gen_random_uuid(); h2 uuid:=gen_random_uuid(); t1 uuid:=gen_random_uuid(); t2 uuid:=gen_random_uuid();
 old_history jsonb; n integer;
begin
 select * into strict base from public.trips where plantation_folio='098765-1';
 select to_jsonb(t) into old_history from public.trips t where id=base.id;
 insert into auth.users(id) values(actor),(legacy);
 begin
  insert into public.profiles(id,full_name,role,status) values(actor,'TEST plates','DRIVER','ACTIVE');
  raise exception 'FAIL: new DRIVER accepted without plates';
 exception when check_violation then null; end;
 insert into public.profiles(id,full_name,role,status,vehicle_plate) values(actor,'TEST plates','DRIVER','ACTIVE',' tst-111 ');
 if (select vehicle_plate from public.profiles where id=actor)<>'TST-111' then raise exception 'FAIL: normalization'; end if;
 -- Emulate a pre-migration profile without disabling the actual validation trigger.
 insert into public.profiles(id,full_name,role,status) values(legacy,'TEST legacy','CREW_LEADER','ACTIVE');
 begin
  update public.profiles set role='DRIVER' where id=legacy;
  raise exception 'FAIL: role switch without plates';
 exception when check_violation then null; end;
 insert into public.organization_members(organization_id,profile_id) values(base.organization_id,actor),(base.organization_id,legacy);
 insert into public.harvest_orders(id,trace_code,organization_id,farm_id,status,scheduled_date,destination_id)
 values(h1,'TEST-PLATE-H1',base.organization_id,base.origin_farm_id,'HARVESTED',public.organization_work_date(base.organization_id),base.destination_id),
       (h2,'TEST-PLATE-H2',base.organization_id,base.origin_farm_id,'HARVESTED',public.organization_work_date(base.organization_id),base.destination_id);
 insert into public.trips(id,trace_code,organization_id,origin_farm_id,harvest_order_id,status,destination_name,destination_id)
 values(t1,'TEST-PLATE-T1',base.organization_id,base.origin_farm_id,h1,'PENDING_DRIVER',base.destination_name,base.destination_id),
       (t2,'TEST-PLATE-T2',base.organization_id,base.origin_farm_id,h2,'PENDING_DRIVER',base.destination_name,base.destination_id);
 insert into plate_test_results values('PASS: account creation requires plates; normalization; role switch blocked');
 -- Existing driver's missing plate is checked by the real claim RPC, without changing that profile.
 if (select vehicle_plate from public.profiles where id=base.driver_id) is null then
  perform set_config('request.jwt.claim.sub',base.driver_id::text,true);
  set local role authenticated;
  begin
   perform public.claim_harvest_trip(t1);
   raise exception 'FAIL: legacy DRIVER claimed without plates';
  exception when check_violation then null; end;
  reset role;
  if (select driver_id from public.trips where id=t1) is not null then raise exception 'FAIL: partial claim after rejection'; end if;
  insert into plate_test_results values('PASS: existing DRIVER without plates blocked; no partial assignment');
 end if;
 -- Exercise RPCs as authenticated (same JWT subject mechanism used by PostgREST).
 perform set_config('request.jwt.claim.sub',legacy::text,true);
 set local role authenticated;
 begin
  perform public.set_my_vehicle_plate('BAD-111');
  raise exception 'FAIL: non-DRIVER can set plates';
 exception when insufficient_privilege then null; end;
 begin
  perform public.claim_harvest_trip(t1);
  raise exception 'FAIL: non-DRIVER claim';
 exception when insufficient_privilege then null; end;
 reset role;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 set local role authenticated;
 begin
  perform public.set_my_vehicle_plate('');
  raise exception 'FAIL: blank plate accepted';
 exception when check_violation then null; end;
 begin
  perform public.set_my_vehicle_plate('ABC/<script>');
  raise exception 'FAIL: invalid plate accepted';
 exception when check_violation then null; end;
 if public.claim_harvest_trip(t1)<>'ASSIGNED' then raise exception 'FAIL: claim'; end if;
 if (select vehicle_plate from public.trips where id=t1)<>'TST-111' then raise exception 'FAIL: automatic plate'; end if;
 if not exists(select 1 from public.deliveries where trip_id=t1 and status::text='PENDING') then raise exception 'FAIL: prepare delivery'; end if;
 perform public.set_my_vehicle_plate('new-222');
 perform public.claim_harvest_trip(t1); -- Retry must not change already assigned plate.
 if (select vehicle_plate from public.trips where id=t1)<>'TST-111' then raise exception 'FAIL: prior plate changed'; end if;
 perform public.claim_harvest_trip(t2);
 if (select vehicle_plate from public.trips where id=t2)<>'NEW-222' then raise exception 'FAIL: new plate not copied'; end if;
 begin
  perform public.configure_harvest_trip(t1,base.destination_name,'NEW-222');
  raise exception 'FAIL: configure overwrote historical snapshot';
 exception when check_violation then null; end;
 update public.profiles set role='ADMIN' where id=actor;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'FAIL: profile RLS privilege escalation'; end if;
 reset role;
 begin
  update public.trips set vehicle_plate='ILLEGAL' where id=t1;
  raise exception 'FAIL: direct update bypassed snapshot';
 exception when check_violation then null; end;
 if (select to_jsonb(t) from public.trips t where id=base.id) is distinct from old_history then raise exception 'FAIL: real history changed'; end if;
 if has_function_privilege('anon','public.set_my_vehicle_plate(text)','execute') then raise exception 'FAIL: anonymous privilege'; end if;
 insert into plate_test_results values('PASS: active-driver authorization, blank/invalid plate rejected, profile RLS unchanged'),
 ('PASS: automatic trip plate and pending delivery'),('PASS: truck change applies only to future assignments; retry idempotent'),
 ('PASS: configure and direct UPDATE cannot rewrite snapshot; real trip untouched; anon denied');
end $$;
select * from plate_test_results;
rollback;
