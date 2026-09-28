-- Fotografía privada del chofer con equipo de protección antes de la llegada.
-- No se incorpora al expediente externo del comprador.
begin;

alter table public.destinations
 add column if not exists safety_photo_required boolean not null default false,
 add column if not exists safety_requirements text[] not null default '{}';
alter table public.destinations add constraint destination_safety_list check (
 cardinality(safety_requirements)<=20 and
 (not safety_photo_required or cardinality(safety_requirements)>0) and
 array_position(safety_requirements,null) is null
);

-- Sólo los dos elementos indicados expresamente; ADMIN puede completar el catálogo.
update public.destinations set safety_photo_required=true,safety_requirements=array['Casco','Chaleco']::text[]
 where id='2750da1f-8103-4e7c-9b34-e08c5f1b8504'::uuid
 and organization_id='ca95fafe-5ba6-4bde-8d95-7bc5df80cb72'::uuid
 and name='Diageo-Charcon';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('arrival-safety','arrival-safety',false,12582912,array['image/jpeg','image/png'])
 on conflict (id) do nothing;

create table public.trip_arrival_safety_evidence (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 trip_id uuid not null references public.trips(id),
 uploaded_by uuid not null references public.profiles(id),
 storage_bucket text not null default 'arrival-safety' check(storage_bucket='arrival-safety'),
 storage_path text not null unique,
 mime_type text not null check(mime_type in ('image/jpeg','image/png')),
 file_size_bytes bigint not null check(file_size_bytes between 1 and 12582912),
 captured_at timestamptz not null,
 recorded_at timestamptz not null default now(),
 equipment_confirmed boolean not null check(equipment_confirmed),
 evidence_number bigint,
 evidence_code text,
 unique(trip_id,storage_path)
);
alter table public.trip_arrival_safety_evidence enable row level security;
grant select,insert on public.trip_arrival_safety_evidence to authenticated;
revoke update,delete on public.trip_arrival_safety_evidence from authenticated;
create policy arrival_safety_select on public.trip_arrival_safety_evidence for select to authenticated
 using (exists(select 1 from public.trips t where t.id=trip_id and t.organization_id=organization_id
 and (public.is_admin_of_org(t.organization_id) or public.can_driver_manage_trip(t.id))));
create policy arrival_safety_insert on public.trip_arrival_safety_evidence for insert to authenticated
 with check(uploaded_by=auth.uid() and exists(select 1 from public.trips t where t.id=trip_id and t.organization_id=organization_id
 and t.driver_id=auth.uid() and public.can_driver_manage_trip(t.id) and t.status::text='IN_TRANSIT'));

create policy arrival_safety_object_insert on storage.objects for insert to authenticated with check(
 bucket_id='arrival-safety'
 and name ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}[.](jpg|png)$'
 and (storage.foldername(name))[3]=auth.uid()::text
 and exists(select 1 from public.trips t where t.id=(storage.foldername(name))[2]::uuid
 and t.organization_id=(storage.foldername(name))[1]::uuid and t.driver_id=auth.uid()
 and t.status::text='IN_TRANSIT' and public.can_driver_manage_trip(t.id)));
create policy arrival_safety_object_select on storage.objects for select to authenticated using(
 bucket_id='arrival-safety'
 and name ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/'
 and exists(select 1 from public.trips t where t.id=(storage.foldername(name))[2]::uuid
 and t.organization_id=(storage.foldername(name))[1]::uuid
 and (public.is_admin_of_org(t.organization_id) or public.can_driver_manage_trip(t.id))));

create function public.validate_arrival_safety_photo() returns trigger language plpgsql security definer set search_path='' as $$
declare v_trip public.trips%rowtype;
begin
 select * into v_trip from public.trips where id=new.trip_id;
 if not found or v_trip.organization_id<>new.organization_id or v_trip.driver_id is distinct from auth.uid()
   or new.uploaded_by is distinct from auth.uid() or v_trip.status::text<>'IN_TRANSIT'
   or not public.can_driver_manage_trip(new.trip_id) then
  raise exception 'Sólo el chofer asignado puede registrar su foto antes de llegar' using errcode='insufficient_privilege';
 end if;
 if new.storage_path !~* '^[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+[.](jpg|png)$'
 or split_part(new.storage_path,'/',1)<>new.organization_id::text
 or split_part(new.storage_path,'/',2)<>new.trip_id::text
 or split_part(new.storage_path,'/',3)<>auth.uid()::text
 or not exists(select 1 from storage.objects o where o.bucket_id='arrival-safety' and o.name=new.storage_path) then
  raise exception 'Primero sincroniza la fotografía original en Storage' using errcode='check_violation';
 end if;
 return new;
end $$;
revoke all on function public.validate_arrival_safety_photo() from public,anon,authenticated;
create trigger validate_arrival_safety_photo before insert on public.trip_arrival_safety_evidence
 for each row execute function public.validate_arrival_safety_photo();

alter table public.trip_evidence_register drop constraint trip_evidence_register_source_table_check;
alter table public.trip_evidence_register add constraint trip_evidence_register_source_table_check
 check(source_table in ('harvest_evidence','weighings','delivery_evidence','trip_arrival_safety_evidence'));
create or replace function public.assign_trip_evidence_number()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_trip_id uuid; v_folio text; v_number bigint;
begin
 if tg_table_name='harvest_evidence' then
  select id,plantation_folio into v_trip_id,v_folio from public.trips where harvest_order_id=new.harvest_order_id order by created_at limit 1;
 elsif tg_table_name='weighings' then
  if new.ticket_storage_path is null then return new; end if;
  v_trip_id:=new.trip_id; select plantation_folio into v_folio from public.trips where id=v_trip_id;
 elsif tg_table_name='delivery_evidence' then
  select t.id,t.plantation_folio into v_trip_id,v_folio from public.deliveries d join public.trips t on t.id=d.trip_id where d.id=new.delivery_id;
 elsif tg_table_name='trip_arrival_safety_evidence' then
  v_trip_id:=new.trip_id; select plantation_folio into v_folio from public.trips where id=v_trip_id;
 else raise exception 'Tipo de evidencia no reconocido'; end if;
 if v_trip_id is null or v_folio is null then raise exception 'La fotografía requiere un viaje vinculado con folio de plantación'; end if;
 insert into public.trip_evidence_counters as c(trip_id,last_number) values(v_trip_id,1)
 on conflict(trip_id) do update set last_number=c.last_number+1 returning last_number into v_number;
 new.evidence_number:=v_number;new.evidence_code:=v_folio||'-'||v_number;
 insert into public.trip_evidence_register(trip_id,evidence_number,evidence_code,source_table,source_id)
 values(v_trip_id,v_number,new.evidence_code,tg_table_name,new.id);
 return new;
end $$;
create trigger number_arrival_safety_photo before insert on public.trip_arrival_safety_evidence
 for each row execute function public.assign_trip_evidence_number();
create trigger protect_arrival_safety_number before update on public.trip_arrival_safety_evidence
 for each row execute function public.protect_trip_evidence_number();

-- Un UPDATE directo del estado queda bloqueado igual que la RPC advance_trip.
create function public.require_arrival_safety_photo() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status::text='IN_TRANSIT' and new.status::text='ARRIVED'
 and exists(select 1 from public.destinations d where d.id=old.destination_id
  and d.organization_id=old.organization_id and d.safety_photo_required)
 and not exists(select 1 from public.trip_arrival_safety_evidence e where e.trip_id=old.id
  and e.organization_id=old.organization_id and e.uploaded_by=old.driver_id and e.equipment_confirmed) then
  raise exception 'Sincroniza primero la fotografía con el equipo de protección para registrar llegada'
   using errcode='check_violation';
 end if;
 return new;
end $$;
create trigger require_arrival_safety_photo before update of status on public.trips
 for each row execute function public.require_arrival_safety_photo();

create function public.trip_safety_requirements(p_trip_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_trip public.trips%rowtype;v_required boolean;v_items text[];
begin
 select * into v_trip from public.trips where id=p_trip_id;
 if not found or auth.uid() is null or not (public.is_admin_of_org(v_trip.organization_id)
 or v_trip.driver_id=auth.uid() and public.can_driver_manage_trip(v_trip.id)) then
  raise exception 'No tienes acceso al equipo requerido para este viaje' using errcode='insufficient_privilege';
 end if;
 select safety_photo_required,safety_requirements into v_required,v_items from public.destinations
 where id=v_trip.destination_id and organization_id=v_trip.organization_id;
 return jsonb_build_object('required',coalesce(v_required,false),'items',coalesce(v_items,'{}'::text[]));
end $$;
revoke all on function public.trip_safety_requirements(uuid) from public,anon;
grant execute on function public.trip_safety_requirements(uuid) to authenticated;
commit;
