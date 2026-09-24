-- Buckets already exist and remain private. Paths: org_uuid/entity_uuid/uploader_uuid/file_uuid.jpg|png
-- Append-only: these policies grant SELECT and INSERT only; no UPDATE or DELETE.
BEGIN;

CREATE POLICY harvest_photo_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
 bucket_id='harvest-evidence'
 AND name ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|png)$'
 AND (storage.foldername(name))[3]=auth.uid()::text
 AND EXISTS (SELECT 1 FROM public.harvest_orders h WHERE h.id=(storage.foldername(name))[2]::uuid AND h.organization_id=(storage.foldername(name))[1]::uuid AND public.can_manage_harvest(h.id))
);
CREATE POLICY harvest_photo_select ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='harvest-evidence' AND name ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/'
 AND EXISTS (SELECT 1 FROM public.harvest_orders h WHERE h.id=(storage.foldername(name))[2]::uuid AND h.organization_id=(storage.foldername(name))[1]::uuid AND public.can_access_harvest(h.id)));

CREATE POLICY delivery_photo_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
 bucket_id='delivery-evidence'
 AND name ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|png)$'
 AND (storage.foldername(name))[3]=auth.uid()::text
 AND EXISTS (SELECT 1 FROM public.deliveries d WHERE d.id=(storage.foldername(name))[2]::uuid AND d.organization_id=(storage.foldername(name))[1]::uuid
 AND (public.is_admin_of_org(d.organization_id) OR public.can_driver_manage_delivery(d.id)))
);
CREATE POLICY delivery_photo_select ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='delivery-evidence' AND name ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/'
 AND EXISTS (SELECT 1 FROM public.deliveries d WHERE d.id=(storage.foldername(name))[2]::uuid AND d.organization_id=(storage.foldername(name))[1]::uuid AND public.can_access_delivery(d.id)));

CREATE POLICY weighing_ticket_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
 bucket_id='weighing-tickets'
 AND name ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|png)$'
 AND (storage.foldername(name))[3]=auth.uid()::text
 AND EXISTS (SELECT 1 FROM public.trips t WHERE t.id=(storage.foldername(name))[2]::uuid AND t.organization_id=(storage.foldername(name))[1]::uuid
 AND (public.is_admin_of_org(t.organization_id) OR public.can_driver_manage_trip(t.id)))
);
CREATE POLICY weighing_ticket_select ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='weighing-tickets' AND name ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/'
 AND EXISTS (SELECT 1 FROM public.trips t WHERE t.id=(storage.foldername(name))[2]::uuid AND t.organization_id=(storage.foldername(name))[1]::uuid AND public.can_access_trip(t.id)));

COMMIT;
