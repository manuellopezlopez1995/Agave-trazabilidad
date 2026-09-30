-- Acceptance check on the prepared test-only trip; all effects are rolled back.
-- The private runner sets agave.test.driver, agave.test.organization and
-- agave.test.trip_folio locally. Never commit internal identifiers here.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('agave.test.driver'),true);
do $$
declare t uuid; e1 uuid:=gen_random_uuid(); e2 uuid:=gen_random_uuid(); c1 timestamptz:=now()-interval '10 seconds'; c2 timestamptz:=now()-interval '5 seconds'; r jsonb;
begin
 select id into t from public.trips where organization_id=current_setting('agave.test.organization')::uuid and plantation_folio=current_setting('agave.test.trip_folio') and status::text='ASSIGNED';
 if t is null then raise exception 'Prepared isolated trip unavailable'; end if;
 perform public.apply_offline_operation(e1,'field_arrival',t,c1,'{"expected":"ASSIGNED","latitude":20.69,"longitude":-102.35}');
 if not exists(select 1 from public.trips where id=t and at_field_at=c1) or not exists(select 1 from public.trip_status_events where event_key=e1 and captured_at=c1 and latitude=20.69) then raise exception 'Arrival capture metadata not preserved'; end if;
 r:=public.apply_offline_operation(e2,'trip',t,c2,'{"expected":"AT_FIELD"}');
 if not exists(select 1 from public.trips where id=t and loaded_at=c2) or not exists(select 1 from public.trip_status_events where event_key=e2 and captured_at=c2 and recorded_at>captured_at) then raise exception 'Loading capture metadata not preserved'; end if;
 if public.apply_offline_operation(e2,'trip',t,c2,'{"expected":"AT_FIELD"}')<>r then raise exception 'Replay mismatch'; end if;
 if (select count(*) from public.trip_status_events where event_key=e2)<>1 then raise exception 'Duplicated event'; end if;
end $$;
select 'PASS: capture dates, available coordinates, receive date and safe replay preserved; rollback leaves trip ASSIGNED' as result;
rollback;
