-- Separate financial ledger. Operational trips, tickets and dossiers are read only.
begin;

create table public.client_price_rules (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 client_name text not null check(length(btrim(client_name)) between 2 and 120),
 effective_on date not null, price_mxn_per_kg numeric(14,4) not null check(price_mxn_per_kg>0 and price_mxn_per_kg<=1000000),
 reason text not null check(length(btrim(reason)) between 10 and 1000),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create index client_price_rules_lookup on public.client_price_rules(organization_id,lower(client_name),effective_on desc,created_at desc);
create table public.trip_price_revisions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 trip_id uuid not null references public.trips(id), price_mxn_per_kg numeric(14,4) not null check(price_mxn_per_kg>0 and price_mxn_per_kg<=1000000),
 reason text not null check(length(btrim(reason)) between 10 and 1000),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create index trip_price_revisions_lookup on public.trip_price_revisions(trip_id,created_at desc,id desc);
create table public.client_payments (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 client_name text not null check(length(btrim(client_name)) between 2 and 120),
 paid_on date not null, amount_mxn numeric(16,2) not null check(amount_mxn>0),
 reference text not null check(length(btrim(reference)) between 2 and 120),
 receipt_path text, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 unique(organization_id,client_name,reference)
);
create unique index client_payment_reference_ci on public.client_payments(organization_id,lower(client_name),lower(reference));
create table public.client_payment_allocations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 payment_id uuid not null references public.client_payments(id),trip_id uuid not null references public.trips(id),
 amount_mxn numeric(16,2) not null check(amount_mxn>0),created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),unique(payment_id,trip_id)
);
create table public.client_payment_reversals (
 payment_id uuid primary key references public.client_payments(id), organization_id uuid not null references public.organizations(id),
 reason text not null check(length(btrim(reason)) between 10 and 1000),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);

-- No direct writes: every ledger mutation goes through the validated RPCs below.
alter table public.client_price_rules enable row level security;
alter table public.trip_price_revisions enable row level security;
alter table public.client_payments enable row level security;
alter table public.client_payment_allocations enable row level security;
alter table public.client_payment_reversals enable row level security;
create policy finance_rules_admin on public.client_price_rules for select to authenticated using(public.is_admin_of_org(organization_id));
create policy finance_revisions_admin on public.trip_price_revisions for select to authenticated using(public.is_admin_of_org(organization_id));
create policy finance_payments_admin on public.client_payments for select to authenticated using(public.is_admin_of_org(organization_id));
create policy finance_allocations_admin on public.client_payment_allocations for select to authenticated using(public.is_admin_of_org(organization_id));
create policy finance_reversals_admin on public.client_payment_reversals for select to authenticated using(public.is_admin_of_org(organization_id));
revoke all on public.client_price_rules,public.trip_price_revisions,public.client_payments,public.client_payment_allocations,public.client_payment_reversals from anon,authenticated;
grant select on public.client_price_rules,public.trip_price_revisions,public.client_payments,public.client_payment_allocations,public.client_payment_reversals to authenticated;

create or replace function public.finance_confirmed_trips(p_org uuid)
returns table(trip_id uuid,client_name text,folio text,delivered_at timestamptz,net_kg numeric)
language sql stable security definer set search_path='' as $$
 select t.id,btrim(t.destination_name),coalesce(t.plantation_folio,t.trace_code),t.delivered_at,w.net_weight_kg
 from public.trips t join public.deliveries d on d.trip_id=t.id and d.organization_id=t.organization_id and d.status::text='COMPLETED'
 join public.weighings w on w.trip_id=t.id and w.weighing_type::text='DESTINATION'
 where t.organization_id=p_org and t.status::text='DELIVERED' and t.delivered_at is not null
 and nullif(btrim(t.destination_name),'') is not null and w.net_weight_kg>0
 and w.legibility_confirmed and nullif(btrim(w.ticket_number),'') is not null and w.ticket_storage_path is not null
 and exists(select 1 from storage.objects o where o.bucket_id='weighing-tickets' and o.name=w.ticket_storage_path)
 $$;
revoke all on function public.finance_confirmed_trips(uuid) from public,anon,authenticated;

create or replace function public.finance_trip_price(p_trip uuid)
returns numeric language sql stable security definer set search_path='' as $$
 select coalesce(
 (select r.price_mxn_per_kg from public.trip_price_revisions r where r.trip_id=p_trip order by r.created_at desc,r.id desc limit 1),
 (select r.price_mxn_per_kg from public.client_price_rules r join public.finance_confirmed_trips(r.organization_id) t
  on t.trip_id=p_trip and lower(t.client_name)=lower(r.client_name)
  where r.effective_on <= (t.delivered_at at time zone coalesce((select o.operational_timezone from public.organizations o where o.id=r.organization_id),'America/Mexico_City'))::date
  order by r.effective_on desc,r.created_at desc,r.id desc limit 1))
 $$;
revoke all on function public.finance_trip_price(uuid) from public,anon,authenticated;

create or replace function public.finance_set_trip_price(p_trip uuid,p_price numeric,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_trip record;v_id uuid;v_net numeric;v_applied numeric;
begin
 select t.* into v_trip from public.trips t where t.id=p_trip for update;
 if not found or not public.is_admin_of_org(v_trip.organization_id) then raise exception 'Sin permiso para fijar precio' using errcode='insufficient_privilege'; end if;
 select net_kg into v_net from public.finance_confirmed_trips(v_trip.organization_id) f where f.trip_id=p_trip;
 if v_net is null then raise exception 'Sólo viajes entregados con ticket DESTINATION confirmado'; end if;
 if p_price is null or p_price<=0 or p_price>1000000 or scale(p_price)>4 or length(btrim(coalesce(p_reason,''))) not between 10 and 1000 then raise exception 'Precio o motivo inválido'; end if;
 select coalesce(sum(a.amount_mxn),0) into v_applied from public.client_payment_allocations a where a.trip_id=p_trip
  and not exists(select 1 from public.client_payment_reversals r where r.payment_id=a.payment_id);
 if round(v_net*p_price,2)<v_applied then raise exception 'El nuevo precio no puede quedar por debajo de los pagos aplicados'; end if;
 insert into public.trip_price_revisions(organization_id,trip_id,price_mxn_per_kg,reason,created_by)
 values(v_trip.organization_id,p_trip,p_price,btrim(p_reason),auth.uid()) returning id into v_id;
 return v_id;
end $$;

create or replace function public.finance_set_client_price(p_org uuid,p_client text,p_from date,p_price numeric,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_name text:=btrim(p_client);
begin
 if not public.is_admin_of_org(p_org) then raise exception 'Sin permiso para fijar precio' using errcode='insufficient_privilege'; end if;
 if length(v_name) not between 2 and 120 or not exists(select 1 from public.destinations d where d.organization_id=p_org and lower(d.buyer_name)=lower(v_name))
 and not exists(select 1 from public.trips t where t.organization_id=p_org and lower(t.destination_name)=lower(v_name)) then raise exception 'Cliente ajeno a la organización'; end if;
 if p_from is null or p_price is null or p_price<=0 or p_price>1000000 or scale(p_price)>4 or length(btrim(coalesce(p_reason,''))) not between 10 and 1000 then raise exception 'Vigencia, precio o motivo inválido'; end if;
 -- A new rate cannot rewrite the price previously shown for a delivered trip.
 if exists(select 1 from public.finance_confirmed_trips(p_org) t where lower(t.client_name)=lower(v_name)
  and (t.delivered_at at time zone coalesce((select o.operational_timezone from public.organizations o where o.id=p_org),'America/Mexico_City'))::date>=p_from)
 then raise exception 'La vigencia debe empezar después de las entregas confirmadas; usa el ajuste por viaje para datos históricos'; end if;
 insert into public.client_price_rules(organization_id,client_name,effective_on,price_mxn_per_kg,reason,created_by)
 values(p_org,v_name,p_from,p_price,btrim(p_reason),auth.uid()) returning id into v_id;return v_id;
end $$;

create or replace function public.finance_allocate_payment(p_payment uuid,p_allocations jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_payment public.client_payments%rowtype;v_item jsonb;v_trip uuid;v_amount numeric;v_price numeric;v_net numeric;v_existing numeric;v_sum numeric:=0;v_seen uuid[]:='{}';
begin
 select * into v_payment from public.client_payments where id=p_payment for update;
 if not found or not public.is_admin_of_org(v_payment.organization_id) then raise exception 'Sin permiso para aplicar pago' using errcode='insufficient_privilege'; end if;
 if exists(select 1 from public.client_payment_reversals where payment_id=p_payment) then raise exception 'El pago fue revertido'; end if;
 if p_allocations is null or jsonb_typeof(p_allocations)<>'array' then raise exception 'Aplicaciones inválidas'; end if;
 if jsonb_array_length(p_allocations)>100 then raise exception 'Demasiados viajes'; end if;
 for v_item in select value from jsonb_array_elements(p_allocations) loop
  v_trip:=(v_item->>'trip_id')::uuid;v_amount:=(v_item->>'amount_mxn')::numeric;
  if v_trip=any(v_seen) or v_amount is null or v_amount<=0 or scale(v_amount)>2 then raise exception 'Viaje duplicado o importe inválido'; end if;
  v_seen:=array_append(v_seen,v_trip);
  perform 1 from public.trips where id=v_trip for update;
  select t.net_kg into v_net from public.finance_confirmed_trips(v_payment.organization_id) t
   where t.trip_id=v_trip and lower(t.client_name)=lower(v_payment.client_name);
  v_price:=public.finance_trip_price(v_trip);
  if v_net is null or v_price is null then raise exception 'El viaje no tiene entrega y precio confirmados para este cliente'; end if;
  select coalesce(sum(a.amount_mxn),0) into v_existing from public.client_payment_allocations a
   where a.trip_id=v_trip and not exists(select 1 from public.client_payment_reversals r where r.payment_id=a.payment_id);
  if v_existing+v_amount>round(v_net*v_price,2) then raise exception 'La aplicación supera el saldo del viaje'; end if;
  v_sum:=v_sum+v_amount;
 end loop;
 select v_sum+coalesce(sum(amount_mxn),0) into v_sum from public.client_payment_allocations where payment_id=p_payment;
 if v_sum>v_payment.amount_mxn then raise exception 'Las aplicaciones superan el pago'; end if;
 for v_item in select value from jsonb_array_elements(p_allocations) loop
  insert into public.client_payment_allocations(organization_id,payment_id,trip_id,amount_mxn,created_by)
  values(v_payment.organization_id,p_payment,(v_item->>'trip_id')::uuid,(v_item->>'amount_mxn')::numeric,auth.uid());
 end loop;return p_payment;
end $$;

create or replace function public.finance_record_payment(p_org uuid,p_client text,p_paid_on date,p_amount numeric,p_reference text,p_receipt_path text,p_allocations jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_client text:=btrim(p_client);
begin
 if not public.is_admin_of_org(p_org) then raise exception 'Sin permiso para registrar pago' using errcode='insufficient_privilege'; end if;
 if length(v_client) not between 2 and 120 or not exists(select 1 from public.destinations where organization_id=p_org and lower(buyer_name)=lower(v_client))
  and not exists(select 1 from public.finance_confirmed_trips(p_org) where lower(client_name)=lower(v_client)) then raise exception 'Cliente ajeno a la organización'; end if;
 if p_paid_on is null or p_amount is null or p_amount<=0 or scale(p_amount)>2 or length(btrim(coalesce(p_reference,''))) not between 2 and 120 then raise exception 'Fecha, importe o referencia inválidos'; end if;
 if nullif(btrim(coalesce(p_receipt_path,'')),'') is not null and not exists(select 1 from storage.objects where bucket_id='finance-receipts' and name=p_receipt_path and split_part(name,'/',1)=p_org::text and split_part(name,'/',2)=auth.uid()::text) then raise exception 'Comprobante no encontrado'; end if;
 insert into public.client_payments(organization_id,client_name,paid_on,amount_mxn,reference,receipt_path,created_by)
 values(p_org,v_client,p_paid_on,p_amount,btrim(p_reference),nullif(btrim(p_receipt_path),''),auth.uid()) returning id into v_id;
 perform public.finance_allocate_payment(v_id,p_allocations);return v_id;
end $$;

create or replace function public.finance_reverse_payment(p_payment uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_payment public.client_payments%rowtype;
begin
 select * into v_payment from public.client_payments where id=p_payment for update;
 if not found or not public.is_admin_of_org(v_payment.organization_id) then raise exception 'Sin permiso para revertir pago' using errcode='insufficient_privilege'; end if;
 if length(btrim(coalesce(p_reason,''))) not between 10 and 1000 then raise exception 'Indica el motivo de la reversión'; end if;
 insert into public.client_payment_reversals(payment_id,organization_id,reason,created_by) values(p_payment,v_payment.organization_id,btrim(p_reason),auth.uid());return p_payment;
end $$;

create or replace function public.finance_report(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_lines jsonb;v_payments jsonb;v_rules jsonb;v_revisions jsonb;
begin
 if not public.is_admin_of_org(p_org) then raise exception 'Finanzas disponibles sólo para ADMIN' using errcode='insufficient_privilege'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('trip_id',t.trip_id,'client_name',t.client_name,'folio',t.folio,'delivered_at',t.delivered_at,'net_kg',t.net_kg,
  'price_mxn_per_kg',public.finance_trip_price(t.trip_id),'amount_mxn',case when public.finance_trip_price(t.trip_id) is null then null else round(t.net_kg*public.finance_trip_price(t.trip_id),2) end)
  order by t.delivered_at,t.folio),'[]'::jsonb) into v_lines from public.finance_confirmed_trips(p_org) t;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'client_name',p.client_name,'paid_on',p.paid_on,'amount_mxn',p.amount_mxn,
 'reference',p.reference,'receipt_path',p.receipt_path,'created_by',p.created_by,'created_at',p.created_at,'reversed',r.payment_id is not null,
 'reversal_reason',r.reason,'allocations',coalesce((select jsonb_agg(jsonb_build_object('trip_id',a.trip_id,'amount_mxn',a.amount_mxn)) from public.client_payment_allocations a where a.payment_id=p.id),'[]'::jsonb))
 order by p.paid_on,p.created_at),'[]'::jsonb) into v_payments from public.client_payments p left join public.client_payment_reversals r on r.payment_id=p.id where p.organization_id=p_org;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at),'[]'::jsonb) into v_rules from public.client_price_rules x where x.organization_id=p_org;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at),'[]'::jsonb) into v_revisions from public.trip_price_revisions x where x.organization_id=p_org;
 return jsonb_build_object('lines',v_lines,'payments',v_payments,'rules',v_rules,'revisions',v_revisions);
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('finance-receipts','finance-receipts',false,10485760,array['image/jpeg','image/png','application/pdf']::text[])
on conflict (id) do nothing;
create policy finance_receipt_insert on storage.objects for insert to authenticated with check(
 bucket_id='finance-receipts' and name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|pdf)$'
 and split_part(name,'/',2)=auth.uid()::text and public.is_admin_of_org(split_part(name,'/',1)::uuid));
create policy finance_receipt_read on storage.objects for select to authenticated using(
 bucket_id='finance-receipts' and public.is_admin_of_org(split_part(name,'/',1)::uuid));

revoke all on function public.finance_set_trip_price(uuid,numeric,text),public.finance_set_client_price(uuid,text,date,numeric,text),public.finance_allocate_payment(uuid,jsonb),public.finance_record_payment(uuid,text,date,numeric,text,text,jsonb),public.finance_reverse_payment(uuid,text),public.finance_report(uuid) from public,anon;
grant execute on function public.finance_set_trip_price(uuid,numeric,text),public.finance_set_client_price(uuid,text,date,numeric,text),public.finance_allocate_payment(uuid,jsonb),public.finance_record_payment(uuid,text,date,numeric,text,text,jsonb),public.finance_reverse_payment(uuid,text),public.finance_report(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
