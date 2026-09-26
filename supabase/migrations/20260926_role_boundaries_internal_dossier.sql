-- The internal dossier is assembled on the client. Its source rows and private
-- objects must therefore be inaccessible to non-administrators except for the
-- driver's own operational ticket and receipt flow.
begin;

create or replace function public.assert_internal_trip_pdf_access(p_trip_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_org uuid;
begin
 if auth.uid() is null then raise exception 'Inicia sesión' using errcode='insufficient_privilege'; end if;
 select organization_id into v_org from public.trips where id=p_trip_id;
 if v_org is null or not public.is_admin_of_org(v_org) then
  raise exception 'Expediente interno reservado a administración' using errcode='insufficient_privilege';
 end if;
 return true;
end $$;
revoke all on function public.assert_internal_trip_pdf_access(uuid) from public,anon;
grant execute on function public.assert_internal_trip_pdf_access(uuid) to authenticated;

drop policy if exists weighings_select on public.weighings;
create policy weighings_select on public.weighings for select to authenticated
 using (exists(select 1 from public.trips t where t.id=trip_id
   and (public.is_admin_of_org(t.organization_id) or public.can_driver_manage_trip(t.id))));

drop policy if exists deliveries_select on public.deliveries;
create policy deliveries_select on public.deliveries for select to authenticated
 using (public.is_admin_of_org(organization_id) or public.can_driver_manage_delivery(id));
drop policy if exists delivery_evidence_select on public.delivery_evidence;
create policy delivery_evidence_select on public.delivery_evidence for select to authenticated
 using (exists(select 1 from public.deliveries d where d.id=delivery_id
  and (public.is_admin_of_org(d.organization_id) or public.can_driver_manage_delivery(d.id))));

drop policy if exists weighing_ticket_select on storage.objects;
create policy weighing_ticket_select on storage.objects for select to authenticated
 using (bucket_id='weighing-tickets'
  and name ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/'
  and exists(select 1 from public.trips t where t.id=(storage.foldername(name))[2]::uuid
   and t.organization_id=(storage.foldername(name))[1]::uuid
   and (public.is_admin_of_org(t.organization_id) or public.can_driver_manage_trip(t.id))));
drop policy if exists delivery_photo_select on storage.objects;
create policy delivery_photo_select on storage.objects for select to authenticated
 using (bucket_id='delivery-evidence'
  and name ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/'
  and exists(select 1 from public.deliveries d where d.id=(storage.foldername(name))[2]::uuid
   and d.organization_id=(storage.foldername(name))[1]::uuid
   and (public.is_admin_of_org(d.organization_id) or public.can_driver_manage_delivery(d.id))));

-- Membership and staff directories are administrative, apart from one's own row.
drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members for select to authenticated
 using (profile_id=auth.uid() or public.is_admin_of_org(organization_id));
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
 using (id=auth.uid() or exists(select 1 from public.organization_members target_member
  where target_member.profile_id=profiles.id and target_member.active
   and public.is_admin_of_org(target_member.organization_id)));

drop policy if exists farm_documents_select on public.farm_documents;
create policy farm_documents_select on public.farm_documents for select to authenticated
 using (exists(select 1 from public.farms f where f.id=farm_id and public.is_admin_of_org(f.organization_id)));
drop policy if exists farm_polygons_select on public.farm_polygons;
create policy farm_polygons_select on public.farm_polygons for select to authenticated
 using (exists(select 1 from public.farms f where f.id=farm_id and public.is_admin_of_org(f.organization_id)));

drop policy if exists variance_settings_read on public.organization_variance_settings;
create policy variance_settings_read on public.organization_variance_settings for select to authenticated
 using (public.is_admin_of_org(organization_id) or public.is_driver_of_org(organization_id));

commit;
