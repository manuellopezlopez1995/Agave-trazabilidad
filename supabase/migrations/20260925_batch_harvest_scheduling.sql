-- Atomic harvest scheduling and database-enforced crew/date exclusivity.
begin;
create unique index if not exists harvest_one_crew_per_day
  on public.harvest_orders (organization_id,crew_id,scheduled_date)
  where crew_id is not null and scheduled_date is not null
    and status in ('PLANNED','ASSIGNED','IN_PROGRESS','HARVESTED');

create or replace function public.schedule_harvest_batch(p_organization_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  item_number integer := 0;
  farm uuid;
  crew uuid;
  planned_date date;
  date_text text;
  result jsonb := '[]'::jsonb;
  created record;
begin
  if auth.uid() is null or not public.is_admin_of_org(p_organization_id) then
    raise exception 'No tienes permiso para programar jimas en esta organización' using errcode='insufficient_privilege';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'Programa de 1 a 50 jimas por operación' using errcode='check_violation';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    item_number := item_number + 1;
    if jsonb_typeof(item) <> 'object' or coalesce(item->>'farm_id','') = ''
      or coalesce(item->>'crew_id','') = '' or coalesce(item->>'scheduled_date','') = '' then
      raise exception 'Faltan predio, cuadrilla o fecha en la jima %', item_number using errcode='check_violation';
    end if;
    farm := (item->>'farm_id')::uuid;
    crew := (item->>'crew_id')::uuid;
    date_text := item->>'scheduled_date';
    if date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Fecha inválida en la jima %', item_number using errcode='check_violation';
    end if;
    planned_date := to_date(date_text,'YYYY-MM-DD');
    if to_char(planned_date,'YYYY-MM-DD') <> date_text then
      raise exception 'Fecha inválida en la jima %', item_number using errcode='check_violation';
    end if;
    if not exists (select 1 from public.farms f where f.id=farm and f.organization_id=p_organization_id and f.active) then
      raise exception 'Predio no disponible en la jima %', item_number using errcode='check_violation';
    end if;
    if not exists (select 1 from public.crews c where c.id=crew and c.organization_id=p_organization_id and c.active) then
      raise exception 'Cuadrilla no disponible en la jima %', item_number using errcode='check_violation';
    end if;
    begin
      insert into public.harvest_orders (organization_id,farm_id,crew_id,scheduled_date,status,created_by)
      values (p_organization_id,farm,crew,planned_date,'ASSIGNED',auth.uid())
      returning id,trace_code into created;
    exception when unique_violation then
      raise exception 'La cuadrilla de la jima % ya está programada para esa fecha', item_number using errcode='unique_violation';
    end;
    result := result || jsonb_build_array(jsonb_build_object('id',created.id,'trace_code',created.trace_code));
  end loop;
  return result;
end;
$$;
revoke all on function public.schedule_harvest_batch(uuid,jsonb) from public,anon;
grant execute on function public.schedule_harvest_batch(uuid,jsonb) to authenticated;
commit;
