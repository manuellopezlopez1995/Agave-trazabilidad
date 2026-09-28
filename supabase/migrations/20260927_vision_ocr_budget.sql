-- Global project budget for one Google DOCUMENT_TEXT_DETECTION call per ticket.
-- A 32-day rolling window avoids a reset that could exceed Google's calendar
-- month allowance near a timezone boundary. Reservations are never refunded:
-- a network timeout can still be billed by Google.
begin;

create table if not exists public.vision_ocr_reservations (
  id uuid primary key default gen_random_uuid(),
  google_project_id text not null check (length(google_project_id) between 6 and 100),
  organization_id uuid not null references public.organizations(id),
  trip_id uuid not null references public.trips(id),
  requested_by uuid not null references auth.users(id),
  image_sha256 text not null check (image_sha256 ~ '^[0-9a-f]{64}$'),
  reserved_at timestamptz not null default clock_timestamp()
);
create index if not exists vision_ocr_reservations_project_time
  on public.vision_ocr_reservations (google_project_id,reserved_at);
create index if not exists vision_ocr_reservations_user_time
  on public.vision_ocr_reservations (requested_by,reserved_at);
alter table public.vision_ocr_reservations enable row level security;
revoke all on public.vision_ocr_reservations from public,anon,authenticated,service_role;
grant select,insert on public.vision_ocr_reservations to service_role;

create or replace function public.reserve_vision_ocr_unit(
  p_project_id text,p_organization_id uuid,p_trip_id uuid,
  p_requested_by uuid,p_image_sha256 text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_used integer;v_recent integer;v_id uuid;
begin
  if p_project_id is null or length(p_project_id) not between 6 and 100
    or p_organization_id is null or p_requested_by is null
    or p_image_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Reserva OCR inválida' using errcode='invalid_parameter_value';
  end if;
  if not exists (select 1 from public.trips t where t.id=p_trip_id
    and t.organization_id=p_organization_id) then
    raise exception 'Viaje no autorizado' using errcode='insufficient_privilege';
  end if;
  -- Serialize every reservation for this Google project, across all organizations.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_project_id,42717));
  select count(*) into v_used from public.vision_ocr_reservations
    where google_project_id=p_project_id
      and reserved_at > pg_catalog.clock_timestamp()-interval '32 days';
  if v_used >= 950 then
    raise exception 'VISION_MONTHLY_LIMIT: cupo OCR agotado' using errcode='check_violation';
  end if;
  select count(*) into v_recent from public.vision_ocr_reservations
    where google_project_id=p_project_id and requested_by=p_requested_by
      and reserved_at > pg_catalog.clock_timestamp()-interval '1 hour';
  if v_recent >= 30 then
    raise exception 'VISION_USER_LIMIT: demasiadas lecturas recientes' using errcode='check_violation';
  end if;
  insert into public.vision_ocr_reservations
    (google_project_id,organization_id,trip_id,requested_by,image_sha256)
    values (p_project_id,p_organization_id,p_trip_id,p_requested_by,p_image_sha256)
    returning id into v_id;
  return pg_catalog.jsonb_build_object('reservationId',v_id,'used',v_used+1,'limit',950);
end $$;
revoke all on function public.reserve_vision_ocr_unit(text,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_vision_ocr_unit(text,uuid,uuid,uuid,text) to service_role;
commit;
