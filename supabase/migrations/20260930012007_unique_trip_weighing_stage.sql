-- A BEFORE trigger alone cannot prevent two concurrent inserts.
-- Abort rather than delete or consolidate historical data if duplicates exist.
create unique index if not exists weighings_one_per_trip_stage
 on public.weighings(trip_id,weighing_type);
