-- Run in Supabase SQL Editor. All test ledger entries are rolled back.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','f0824571-4d65-449f-94ca-43141e712b3b',true);
do $$
declare v_org uuid:='4b2d20d5-9f98-4a47-8f20-dfafdb58d9f0';
 v_a uuid:='a07b442f-59d7-4dd3-8ec3-ae0ab7565dc1';
 v_b uuid:='245bdad3-153f-4658-91f8-d0e4fcb1ead6';
 v_payment uuid;v_advance uuid;v_report jsonb;v_lines jsonb;
begin
 v_report:=public.finance_report(v_org);v_lines:=v_report->'lines';
 if jsonb_array_length(v_lines)<2 or (select count(*) from jsonb_array_elements(v_lines) x where x->>'price_mxn_per_kg' is null)<2 then raise exception 'Precio pendiente no visible'; end if;
 perform public.finance_set_trip_price(v_a,1.20,'Precio inicial de prueba');
 perform public.finance_set_trip_price(v_b,2.00,'Precio alterno de prueba');
 v_payment:=public.finance_record_payment(v_org,'PRUEBA OFFLINE',current_date,1000,'PRUEBA FINANZAS 1',null,
  jsonb_build_array(jsonb_build_object('trip_id',v_a,'amount_mxn',500),jsonb_build_object('trip_id',v_b,'amount_mxn',300)));
 v_advance:=public.finance_record_payment(v_org,'PRUEBA OFFLINE',current_date,200,'PRUEBA FINANZAS ANTICIPO',null,'[]'::jsonb);
 if (select count(*) from public.client_payment_allocations where payment_id=v_payment)<>2 then raise exception 'Pago multiviaje incorrecto'; end if;
 if (select count(*) from public.client_payment_allocations where payment_id=v_advance)<>0 then raise exception 'Anticipo aplicado sin instrucción'; end if;
 perform public.finance_allocate_payment(v_advance,jsonb_build_array(jsonb_build_object('trip_id',v_b,'amount_mxn',100)));
 perform public.finance_set_trip_price(v_a,1.25,'Corrección auditada de precio');
 if (select count(*) from public.trip_price_revisions where trip_id=v_a)<>2 then raise exception 'Se perdió la revisión de precio'; end if;
 v_report:=public.finance_report(v_org);
 if (select (x->>'price_mxn_per_kg')::numeric from jsonb_array_elements(v_report->'lines') x where x->>'trip_id'=v_a::text)<>1.25 then raise exception 'Precio vigente incorrecto'; end if;
 if (select count(*) from jsonb_array_elements(v_report->'payments') x where x->>'id'=v_payment::text and jsonb_array_length(x->'allocations')=2)<>1 then raise exception 'Aplicaciones no visibles'; end if;
 perform public.finance_reverse_payment(v_payment,'Reversión auditada de prueba');
 if not exists(select 1 from public.client_payment_reversals where payment_id=v_payment) then raise exception 'Reversión no auditada'; end if;
end $$;
-- Confirm non-admin cannot read or mutate the financial report.
select set_config('request.jwt.claim.sub','c84a1022-ab25-4114-85de-f286d1b06e69',true);
do $$ begin
 begin perform public.finance_report('4b2d20d5-9f98-4a47-8f20-dfafdb58d9f0');raise exception 'DRIVER pudo consultar finanzas';
 exception when insufficient_privilege then null;end;
 begin perform public.finance_set_trip_price('a07b442f-59d7-4dd3-8ec3-ae0ab7565dc1',9,'Acceso de prueba prohibido');raise exception 'DRIVER pudo cambiar precio';
 exception when insufficient_privilege then null;end;
end $$;
rollback;
