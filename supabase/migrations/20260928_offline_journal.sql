begin;
create table if not exists public.offline_operation_receipts(
 event_id uuid primary key,organization_id uuid not null references public.organizations(id),
 actor_id uuid not null references public.profiles(id),kind text not null,entity_id uuid not null,
 captured_at timestamptz not null,received_at timestamptz not null default now(),request jsonb not null,result jsonb not null
);
alter table public.offline_operation_receipts enable row level security;
create policy offline_receipts_read on public.offline_operation_receipts for select to authenticated
 using(actor_id=auth.uid() or public.is_admin_of_org(organization_id));
revoke all on public.offline_operation_receipts from anon,authenticated;
grant select on public.offline_operation_receipts to authenticated;
create or replace function public.apply_offline_operation(p_event_id uuid,p_kind text,p_entity_id uuid,p_captured_at timestamptz,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_state text; v_created timestamptz; v_result jsonb; v_old public.offline_operation_receipts%rowtype; v_request jsonb;
begin
 if auth.uid() is null then raise exception 'Sesión requerida' using errcode='insufficient_privilege'; end if;
 if p_event_id is null or p_entity_id is null or p_captured_at is null or p_captured_at>now()+interval '5 minutes' or p_payload is null then raise exception 'Evento offline inválido' using errcode='check_violation'; end if;
 v_request:=jsonb_build_object('kind',p_kind,'entity',p_entity_id,'captured_at',p_captured_at,'payload',p_payload);
 perform pg_advisory_xact_lock(hashtextextended(p_event_id::text,0));
 select * into v_old from public.offline_operation_receipts where event_id=p_event_id;
 if found then
  if v_old.actor_id<>auth.uid() or v_old.request<>v_request then raise exception 'El identificador del evento ya corresponde a otra operación' using errcode='insufficient_privilege'; end if;
  if not exists(select 1 from public.organization_members m join public.profiles p on p.id=m.profile_id where m.profile_id=auth.uid() and m.organization_id=v_old.organization_id and m.active and p.status::text='ACTIVE') then raise exception 'Acceso revocado' using errcode='insufficient_privilege'; end if;
  return v_old.result;
 end if;
 if not exists(select 1 from public.profiles where id=auth.uid() and status::text='ACTIVE' and (role::text='ADMIN' or p_kind in ('harvest','lot') and role::text='CREW_LEADER' or p_kind in ('trip','field_arrival') and role::text='DRIVER')) then raise exception 'Rol no autorizado para esta operación' using errcode='insufficient_privilege'; end if;
 if p_kind in ('harvest','lot') then
  select organization_id,status::text,created_at into v_org,v_state,v_created from public.harvest_orders where id=p_entity_id for update;
  if v_org is null or not (public.is_admin_of_org(v_org) or public.can_manage_harvest(p_entity_id)) then raise exception 'Sin permiso para esta jima' using errcode='insufficient_privilege'; end if;
 elsif p_kind in ('trip','field_arrival') then
  select organization_id,status::text,created_at into v_org,v_state,v_created from public.trips where id=p_entity_id for update;
  if v_org is null or not (public.is_admin_of_org(v_org) or public.can_driver_manage_trip(p_entity_id)) then raise exception 'Sin permiso para este viaje' using errcode='insufficient_privilege'; end if;
 else raise exception 'Operación offline no admitida' using errcode='check_violation'; end if;
 if p_captured_at<v_created-interval '5 minutes' then raise exception 'La captura precede al registro' using errcode='check_violation'; end if;
 if p_payload->>'expected' is distinct from v_state then raise exception 'Estado del servidor % distinto del esperado %. Revisa el pendiente.',v_state,p_payload->>'expected' using errcode='check_violation'; end if;
 if p_kind='harvest' then
  v_state:=public.advance_harvest(p_entity_id);
  if v_state='IN_PROGRESS' then update public.harvest_orders set started_at=p_captured_at where id=p_entity_id;
  elsif v_state='HARVESTED' then update public.harvest_orders set completed_at=p_captured_at where id=p_entity_id; end if;
  v_result:=jsonb_build_object('state',v_state);
 elsif p_kind='lot' then
  v_result:=jsonb_build_object('lot_id',public.save_lot_with_brix_evidence(p_entity_id,(p_payload->>'count')::integer,(p_payload->>'brix')::numeric,
   p_payload->>'path',p_payload->>'mime',(p_payload->>'bytes')::bigint,p_captured_at,
   (p_payload->>'latitude')::numeric,(p_payload->>'longitude')::numeric,(p_payload->>'lot_id')::uuid));
 elsif p_kind='field_arrival' then
  v_state:=public.mark_trip_at_field(p_entity_id,p_event_id,p_captured_at,(p_payload->>'latitude')::numeric,(p_payload->>'longitude')::numeric);
  v_result:=jsonb_build_object('state',v_state);
 else
  -- Arrival at destination stays online-only; its existing safety guards remain authoritative.
  if v_state not in ('AT_FIELD','LOADING') then raise exception 'Este avance necesita confirmación en línea' using errcode='check_violation'; end if;
  v_state:=public.advance_trip(p_entity_id);
  if v_state='LOADING' then update public.trips set loaded_at=p_captured_at where id=p_entity_id;
  elsif v_state='IN_TRANSIT' then update public.trips set departed_at=p_captured_at where id=p_entity_id; end if;
  v_result:=jsonb_build_object('state',v_state);
 end if;
 insert into public.offline_operation_receipts(event_id,organization_id,actor_id,kind,entity_id,captured_at,request,result)
 values(p_event_id,v_org,auth.uid(),p_kind,p_entity_id,p_captured_at,v_request,v_result);
 return v_result;
end $$;
revoke all on function public.apply_offline_operation(uuid,text,uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.apply_offline_operation(uuid,text,uuid,timestamptz,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
