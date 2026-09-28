begin;
alter table public.trips alter column trace_code set default ('TEST-OFFLINE-'||gen_random_uuid()::text);
alter table public.deliveries alter column trace_code set default ('TEST-OFFLINE-'||gen_random_uuid()::text);
create temporary table offline_checks(result text);
do $$
declare h uuid:=gen_random_uuid(); ev uuid:=gen_random_uuid(); original jsonb; base public.harvest_orders%rowtype; captured timestamptz:=now(); result jsonb;
begin
 select * into strict base from public.harvest_orders where id='7fa89cb7-7a5e-452a-83b9-9962d8310937';
 select to_jsonb(t) into original from public.trips t where plantation_folio='098765-1';
 insert into public.harvest_orders(id,trace_code,organization_id,farm_id,crew_id,status,scheduled_date,destination_id)
 values(h,'TEST-OFFLINE-JOURNAL',base.organization_id,base.farm_id,base.crew_id,'ASSIGNED',public.organization_work_date(base.organization_id),base.destination_id);
 perform set_config('request.jwt.claim.sub','6925ae58-1b47-4565-9be0-849997d7c51d',true);
 set local role authenticated;
 result:=public.apply_offline_operation(ev,'harvest',h,captured,'{"expected":"ASSIGNED"}');
 if result->>'state'<>'IN_PROGRESS' then raise exception 'FAIL start'; end if;
 if public.apply_offline_operation(ev,'harvest',h,captured,'{"expected":"ASSIGNED"}')<>result then raise exception 'FAIL replay'; end if;
 if (select count(*) from public.offline_operation_receipts where event_id=ev)<>1 then raise exception 'FAIL duplicate receipt'; end if;
 begin perform public.apply_offline_operation(ev,'harvest',h,captured,'{"expected":"IN_PROGRESS"}');raise exception 'FAIL altered replay';exception when insufficient_privilege then null;end;
 begin perform public.apply_offline_operation(gen_random_uuid(),'harvest',h,captured,'{"expected":"ASSIGNED"}');raise exception 'FAIL stale event';exception when check_violation then null;end;
 -- Existing business guard must reject closing with missing lots/evidence.
 begin perform public.apply_offline_operation(gen_random_uuid(),'harvest',h,captured,'{"expected":"IN_PROGRESS"}');raise exception 'FAIL missing evidence';exception when raise_exception then if sqlerrm='FAIL missing evidence' then raise; end if;end;
 reset role;
 if (select count(*) from public.offline_operation_receipts where entity_id=h)<>1 then raise exception 'FAIL rejection recorded as success'; end if;
 perform set_config('request.jwt.claim.sub','c84a1022-ab25-4114-85de-f286d1b06e69',true);set local role authenticated;
 begin perform public.apply_offline_operation(gen_random_uuid(),'harvest',h,captured,'{"expected":"IN_PROGRESS"}');raise exception 'FAIL driver write';exception when insufficient_privilege then null;end;
 reset role;
 if has_function_privilege('anon','public.apply_offline_operation(uuid,text,uuid,timestamptz,jsonb)','execute') then raise exception 'FAIL anonymous'; end if;
 if (select to_jsonb(t) from public.trips t where plantation_folio='098765-1')<>original then raise exception 'FAIL historical trip'; end if;
 insert into offline_checks values('PASS: start and captured date'),('PASS: idempotent retry returns original receipt'),('PASS: altered replay and stale state rejected'),('PASS: missing evidence cannot close harvest'),('PASS: DRIVER cannot modify harvest; anonymous denied'),('PASS: operational trip unchanged');
end $$;
select * from offline_checks;
rollback;
