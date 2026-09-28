-- Applies to future closures only. Existing evidence and completed jimas are untouched.
create or replace function public.advance_harvest(p_harvest_id uuid)
returns text language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare v_status text; v_org uuid; v_jima integer; v_brix integer;
begin
 select status::text,organization_id into v_status,v_org from public.harvest_orders where id=p_harvest_id for update;
 if not found then raise exception 'La jima no existe'; end if;
 if not public.is_admin_of_org(v_org) and not public.can_manage_harvest(p_harvest_id) then
  raise exception 'No tienes permiso para administrar esta jima' using errcode='insufficient_privilege';
 end if;
 if v_status='ASSIGNED' then
  update public.harvest_orders set status='IN_PROGRESS',started_at=now() where id=p_harvest_id;
  return 'IN_PROGRESS';
 elsif v_status='IN_PROGRESS' then
  if not exists(select 1 from public.agave_lots where harvest_order_id=p_harvest_id) then raise exception 'Registra al menos un lote antes de terminar'; end if;
  if exists(select 1 from public.agave_lots where harvest_order_id=p_harvest_id and
   (agave_count is null or agave_count<1 or average_brix is null or average_brix<0 or average_brix>50 or
    actual_weight_kg is not null and actual_weight_kg<=0 or
    actual_weight_kg is null and not exists(select 1 from public.harvest_evidence e where e.agave_lot_id=agave_lots.id and e.harvest_order_id=p_harvest_id))) then
   raise exception 'Completa las mediciones y fotografía °Brix de todos los lotes';
  end if;
  select count(*) filter(where e.agave_lot_id is null),count(*) filter(where e.agave_lot_id is not null)
   into v_jima,v_brix from public.harvest_evidence e
   join storage.objects o on o.bucket_id=e.storage_bucket and o.name=e.storage_path
   where e.harvest_order_id=p_harvest_id and e.storage_bucket='harvest-evidence';
  if v_jima<2 or v_brix<2 then
   raise exception 'Antes de cerrar, sincroniza dos fotografías de jima y dos de °Brix (confirmadas: % y %)',v_jima,v_brix using errcode='check_violation';
  end if;
  update public.agave_lots set status='HARVESTED' where harvest_order_id=p_harvest_id and status::text='OPEN';
  update public.harvest_orders set status='HARVESTED',completed_at=now() where id=p_harvest_id;
  return 'HARVESTED';
 end if;
 raise exception 'Esta jima no tiene avance disponible' using errcode='check_violation';
end $$;
revoke all on function public.advance_harvest(uuid) from public,anon;
grant execute on function public.advance_harvest(uuid) to authenticated;
