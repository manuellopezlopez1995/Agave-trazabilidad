begin;

-- Staff changes go through the guarded RPCs. Existing broad policies could
-- change roles or disable the last administrator from a browser client.
drop policy if exists profiles_admin_update on public.profiles;
drop policy if exists organization_members_admin_insert on public.organization_members;
drop policy if exists organization_members_admin_update on public.organization_members;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
 using (id=auth.uid() or exists(select 1 from public.organization_members m
  where m.profile_id=profiles.id and public.is_admin_of_org(m.organization_id)));

-- These constraints protect the organization even if a privileged service
-- deletes a user or another SQL path updates membership directly.
create function public.guard_last_team_admin() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_other integer;
begin
 if tg_table_name='organization_members' then
  if tg_op='UPDATE' and (old.active is not distinct from new.active) and old.organization_id=new.organization_id and old.profile_id=new.profile_id then return new; end if;
  if tg_op='UPDATE' and (old.organization_id<>new.organization_id or old.profile_id<>new.profile_id) then
   raise exception 'No se puede trasladar una membresía' using errcode='check_violation';
  end if;
  if old.active and exists(select 1 from public.profiles p where p.id=old.profile_id and p.role::text='ADMIN' and p.status::text='ACTIVE') then
   v_org:=old.organization_id;
   perform 1 from public.organizations where id=v_org for update;
   select count(*) into v_other from public.organization_members m join public.profiles p on p.id=m.profile_id
   where m.organization_id=v_org and m.profile_id<>old.profile_id and m.active and p.status::text='ACTIVE' and p.role::text='ADMIN';
   if v_other=0 then raise exception 'La organización necesita al menos un administrador activo' using errcode='check_violation'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
 end if;
 if tg_op='UPDATE' and old.role is not distinct from new.role and old.status is not distinct from new.status then return new; end if;
 if old.role::text='ADMIN' and old.status::text='ACTIVE' and
  (tg_op='DELETE' or (tg_op='UPDATE' and (new.role::text<>'ADMIN' or new.status::text<>'ACTIVE'))) then
  for v_org in select organization_id from public.organization_members where profile_id=old.id and active order by organization_id loop
   perform 1 from public.organizations where id=v_org for update;
   select count(*) into v_other from public.organization_members m join public.profiles p on p.id=m.profile_id
   where m.organization_id=v_org and m.profile_id<>old.id and m.active and p.status::text='ACTIVE' and p.role::text='ADMIN';
   if v_other=0 then raise exception 'La organización necesita al menos un administrador activo' using errcode='check_violation'; end if;
  end loop;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger guard_team_membership before update or delete on public.organization_members
 for each row execute function public.guard_last_team_admin();
create trigger guard_team_profile before update of role,status or delete on public.profiles
 for each row execute function public.guard_last_team_admin();
revoke all on function public.guard_last_team_admin() from public,anon,authenticated;

-- Called only by the authenticated server function after creating the Auth
-- invitation. A fresh Auth user cannot acquire any organization on its own.
create function public.team_attach_invite(p_org uuid,p_actor uuid,p_user uuid,p_name text,p_role text,p_plate text,p_crew uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_name text:=nullif(btrim(p_name),''); v_plate text:=nullif(upper(btrim(p_plate)),'');
begin
 perform 1 from public.organizations where id=p_org for update;
 if not exists(select 1 from public.organization_members m join public.profiles p on p.id=m.profile_id
  where m.organization_id=p_org and m.profile_id=p_actor and m.active and p.status::text='ACTIVE' and p.role::text='ADMIN') then
  raise exception 'Sólo administración activa puede invitar usuarios' using errcode='insufficient_privilege';
 end if;
 if v_name is null or length(v_name)>120 or p_role not in ('ADMIN','CREW_LEADER','DRIVER') then raise exception 'Nombre o rol inválido' using errcode='check_violation'; end if;
 if p_role='DRIVER' and v_plate is null then raise exception 'Las placas son obligatorias para el chofer' using errcode='check_violation'; end if;
 if p_role<>'DRIVER' and v_plate is not null or p_role<>'CREW_LEADER' and p_crew is not null then raise exception 'Placas o cuadrilla no corresponden al rol' using errcode='check_violation'; end if;
 if not exists(select 1 from auth.users where id=p_user) or exists(select 1 from public.profiles where id=p_user) then
  raise exception 'La cuenta ya existe o no fue creada' using errcode='check_violation';
 end if;
 insert into public.profiles(id,full_name,role,status,vehicle_plate,created_by)
 values(p_user,v_name,p_role::public.app_role,'ACTIVE'::public.user_status,v_plate,p_actor);
 insert into public.organization_members(organization_id,profile_id,active,created_by)
 values(p_org,p_user,true,p_actor);
 if p_crew is not null then
  update public.crews set crew_leader_id=p_user where id=p_crew and organization_id=p_org and active and crew_leader_id is null;
  if not found then raise exception 'La cuadrilla no está disponible' using errcode='check_violation'; end if;
 end if;
end $$;
revoke all on function public.team_attach_invite(uuid,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.team_attach_invite(uuid,uuid,uuid,text,text,text,uuid) to service_role;

create function public.team_manage_member(p_org uuid,p_user uuid,p_name text,p_role text,p_plate text,p_crew uuid,p_active boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_old public.profiles%rowtype; v_member public.organization_members%rowtype; v_name text:=nullif(btrim(p_name),''); v_plate text:=nullif(upper(btrim(p_plate)),''); v_shared boolean;
begin
 perform 1 from public.organizations where id=p_org for update;
 if not public.is_admin_of_org(p_org) then raise exception 'Sólo administración puede cambiar cuentas' using errcode='insufficient_privilege'; end if;
 select * into v_member from public.organization_members where organization_id=p_org and profile_id=p_user for update;
 select * into v_old from public.profiles where id=p_user for update;
 if v_member.id is null or v_old.id is null then raise exception 'Usuario fuera de esta organización' using errcode='insufficient_privilege'; end if;
 if p_active is null or v_name is null or length(v_name)>120 or p_role not in ('ADMIN','CREW_LEADER','DRIVER') then raise exception 'Datos de usuario inválidos' using errcode='check_violation'; end if;
 if p_user=auth.uid() and (not p_active or p_role<>'ADMIN') then raise exception 'No puedes quitarte tu propio acceso de administrador' using errcode='check_violation'; end if;
 if p_role='DRIVER' and v_plate is null or p_role<>'DRIVER' and v_plate is not null or p_role<>'CREW_LEADER' and p_crew is not null then
  raise exception 'Placas o cuadrilla no corresponden al rol' using errcode='check_violation';
 end if;
 select exists(select 1 from public.organization_members where profile_id=p_user and organization_id<>p_org) into v_shared;
 if v_shared and (v_old.full_name is distinct from v_name or v_old.role::text<>p_role or v_old.vehicle_plate is distinct from v_plate) then
  raise exception 'Cuenta compartida: cambia solamente su acceso a esta organización' using errcode='check_violation';
 end if;
 if v_old.role::text<>p_role and (exists(select 1 from public.trips where driver_id=p_user)
  or exists(select 1 from public.crews where crew_leader_id=p_user)
  or exists(select 1 from public.harvest_assignments where profile_id=p_user)) then
  raise exception 'Conserva el rol de una cuenta con asignaciones; crea otra cuenta para la nueva función' using errcode='check_violation';
 end if;
 update public.profiles set full_name=v_name,role=p_role::public.app_role,vehicle_plate=v_plate where id=p_user;
 update public.organization_members set active=p_active where id=v_member.id;
 if p_role='CREW_LEADER' and p_crew is not null then
  update public.crews set crew_leader_id=null where organization_id=p_org and crew_leader_id=p_user and id<>p_crew;
  update public.crews set crew_leader_id=p_user where id=p_crew and organization_id=p_org and active and (crew_leader_id is null or crew_leader_id=p_user);
  if not found then raise exception 'La cuadrilla no está disponible' using errcode='check_violation'; end if;
 end if;
end $$;
revoke all on function public.team_manage_member(uuid,uuid,text,text,text,uuid,boolean) from public,anon;
grant execute on function public.team_manage_member(uuid,uuid,text,text,text,uuid,boolean) to authenticated;

-- Block Auth deletion if *any* public row would lose an author or a link.
create function public.team_can_delete(p_org uuid,p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_fk record; v_used boolean;
begin
 if not public.is_admin_of_org(p_org) then raise exception 'Sólo administración puede eliminar cuentas' using errcode='insufficient_privilege'; end if;
 if p_user=auth.uid() then return jsonb_build_object('allowed',false,'reason','No puedes eliminar tu propia cuenta'); end if;
 if not exists(select 1 from public.organization_members where organization_id=p_org and profile_id=p_user) then
  return jsonb_build_object('allowed',false,'reason','Usuario fuera de esta organización'); end if;
 if exists(select 1 from public.organization_members where profile_id=p_user and organization_id<>p_org) then
  return jsonb_build_object('allowed',false,'reason','La cuenta pertenece a otra organización'); end if;
 if exists(select 1 from public.organization_members m join public.profiles p on p.id=m.profile_id
  where m.organization_id=p_org and m.profile_id=p_user and m.active and p.status::text='ACTIVE' and p.role::text='ADMIN')
  and not exists(select 1 from public.organization_members m join public.profiles p on p.id=m.profile_id
   where m.organization_id=p_org and m.profile_id<>p_user and m.active and p.status::text='ACTIVE' and p.role::text='ADMIN') then
  return jsonb_build_object('allowed',false,'reason','La organización necesita un administrador activo'); end if;
 for v_fk in select con.conrelid::regclass as tbl,a.attname as col,con.conrelid::regclass::text as name
  from pg_catalog.pg_constraint con join pg_catalog.pg_attribute a on a.attrelid=con.conrelid and a.attnum=con.conkey[1]
  where con.contype='f' and con.confrelid in ('public.profiles'::regclass,'auth.users'::regclass)
   and array_length(con.conkey,1)=1 and con.connamespace='public'::regnamespace
   and not (con.conrelid='public.profiles'::regclass and a.attname='id')
   and not (con.conrelid='public.organization_members'::regclass and a.attname='profile_id')
 loop
  execute format('select exists(select 1 from %s where %I=$1)',v_fk.tbl,v_fk.col) into v_used using p_user;
  if v_used then return jsonb_build_object('allowed',false,'reason','La cuenta figura en registros o asignaciones; desactívala para conservar la trazabilidad'); end if;
 end loop;
 return jsonb_build_object('allowed',true);
end $$;
revoke all on function public.team_can_delete(uuid,uuid) from public,anon;
grant execute on function public.team_can_delete(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
