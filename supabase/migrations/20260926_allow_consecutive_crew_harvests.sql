-- The existing partial unique index included HARVESTED, so a completed jima
-- still occupied its crew for the remainder of the scheduled day.
-- The enum in production is DRAFT, PLANNED, ASSIGNED, IN_PROGRESS,
-- HARVESTED, CANCELLED. Only scheduled/active work reserves a crew.
BEGIN;
DO $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM public.harvest_orders
  WHERE crew_id IS NOT NULL AND scheduled_date IS NOT NULL
    AND status IN ('PLANNED','ASSIGNED','IN_PROGRESS')
  GROUP BY organization_id,crew_id,scheduled_date HAVING count(*)>1
 ) THEN
  RAISE EXCEPTION 'Existen asignaciones activas duplicadas; revisar antes de sustituir el índice';
 END IF;
END $$;
DROP INDEX IF EXISTS public.harvest_one_crew_per_day;
CREATE UNIQUE INDEX harvest_one_crew_per_day
 ON public.harvest_orders (organization_id,crew_id,scheduled_date)
 WHERE crew_id IS NOT NULL AND scheduled_date IS NOT NULL
   AND status IN ('PLANNED','ASSIGNED','IN_PROGRESS');
COMMIT;
