begin;
create or replace function public.team_manage_member(p_org uuid,p_user uuid,p_name text,p_role text,p_plate text,p_crew uuid,p_active boolean)
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
 update public.crews set crew_leader_id=null where organization_id=p_org and crew_leader_id=p_user
  and (not p_active or p_role<>'CREW_LEADER' or p_crew is null or id<>p_crew);
 if p_active and p_role='CREW_LEADER' and p_crew is not null then
  update public.crews set crew_leader_id=p_user where id=p_crew and organization_id=p_org and active and (crew_leader_id is null or crew_leader_id=p_user);
  if not found then raise exception 'La cuadrilla no está disponible' using errcode='check_violation'; end if;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
