-- Reutiliza la evidencia privada y el contador compartido del viaje.
begin;
alter table public.trip_arrival_safety_evidence
 add column photo_kind text not null default 'PPE'
 check(photo_kind in ('PPE','TRUCK'));

-- Las fotografías existentes y las pendientes anteriores son del chofer (PPE).
drop policy arrival_safety_select on public.trip_arrival_safety_evidence;
create policy arrival_safety_select on public.trip_arrival_safety_evidence for select to authenticated
 using(exists(select 1 from public.trips t
 where t.id=trip_arrival_safety_evidence.trip_id
 and t.organization_id=trip_arrival_safety_evidence.organization_id
 and (public.is_admin_of_org(t.organization_id) or public.can_driver_manage_trip(t.id))));
drop policy arrival_safety_insert on public.trip_arrival_safety_evidence;
create policy arrival_safety_insert on public.trip_arrival_safety_evidence for insert to authenticated
 with check(uploaded_by=auth.uid() and exists(select 1 from public.trips t
 where t.id=trip_arrival_safety_evidence.trip_id
 and t.organization_id=trip_arrival_safety_evidence.organization_id
 and t.driver_id=auth.uid() and public.can_driver_manage_trip(t.id) and t.status::text='IN_TRANSIT'));

-- SECURITY DEFINER permite comprobar el catálogo aunque DRIVER no pueda leerlo.
-- El guard se ejecuta tanto desde advance_trip como desde un UPDATE directo.
create or replace function public.require_arrival_safety_photo() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_missing text;
begin
 if old.status::text='IN_TRANSIT' and new.status::text='ARRIVED'
 and exists(select 1 from public.destinations d where d.id=old.destination_id
 and d.organization_id=old.organization_id and d.safety_photo_required) then
  select string_agg(case k.kind when 'PPE' then 'chofer con equipo de protección' else 'camión en destino' end, ', ')
   into v_missing from (values ('PPE'),('TRUCK')) as k(kind)
   where not exists(select 1 from public.trip_arrival_safety_evidence e
    join storage.objects o on o.bucket_id=e.storage_bucket and o.name=e.storage_path
    where e.trip_id=old.id and e.organization_id=old.organization_id
    and e.uploaded_by=old.driver_id and e.equipment_confirmed and e.photo_kind=k.kind);
  if v_missing is not null then
   raise exception 'Antes de registrar llegada, sincroniza la fotografía de: %',v_missing
    using errcode='check_violation';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.require_arrival_safety_photo() from public,anon,authenticated;
comment on column public.trip_arrival_safety_evidence.photo_kind is
 'PPE: chofer con equipo; TRUCK: camión en destino. Evidencias internas privadas.';
-- Conserva el bucket privado, sus políticas de chofer asignado y ADMIN,
-- el trigger que exige un objeto real y el consecutivo transaccional existente.
commit;
