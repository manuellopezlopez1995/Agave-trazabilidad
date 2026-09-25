-- Reserve internal farm numbers by organization in PostgreSQL, independently of plantation IDs.
-- Apply once in a transaction so existing numbers are counted before inserts can resume.
begin;
lock table public.farms in share row exclusive mode;

create table if not exists public.farm_code_counters (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_value bigint not null check (last_value >= 0)
);
alter table public.farm_code_counters enable row level security;
revoke all on public.farm_code_counters from anon, authenticated;

insert into public.farm_code_counters (organization_id, last_value)
select organization_id, max(substring(code from 6)::bigint)
from public.farms
where code ~ '^PRED-[0-9]{6,18}$'
group by organization_id
on conflict (organization_id) do update
set last_value = greatest(public.farm_code_counters.last_value, excluded.last_value);

create or replace function public.assign_farm_internal_code()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  next_number bigint;
begin
  if tg_op = 'UPDATE' then
    if new.code is distinct from old.code then
      raise exception 'El código interno del predio no puede modificarse';
    end if;
    if new.organization_id is distinct from old.organization_id then
      raise exception 'La organización del predio no puede modificarse';
    end if;
    return new;
  end if;

  insert into public.farm_code_counters (organization_id, last_value)
  values (new.organization_id, 1)
  on conflict (organization_id) do update
  set last_value = public.farm_code_counters.last_value + 1
  returning last_value into next_number;

  new.code := 'PRED-' || lpad(next_number::text, greatest(6, length(next_number::text)), '0');
  return new;
end;
$$;
revoke all on function public.assign_farm_internal_code() from public, anon, authenticated;

drop trigger if exists farms_assign_internal_code on public.farms;
create trigger farms_assign_internal_code
before insert or update of code, organization_id on public.farms
for each row execute function public.assign_farm_internal_code();
commit;
