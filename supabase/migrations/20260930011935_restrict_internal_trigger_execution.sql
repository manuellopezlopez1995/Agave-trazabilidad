-- Triggers execute through their table/event trigger, never as client RPCs.
revoke execute on function public.audit_trip_change(),
 public.enforce_evidence_and_variance(), public.link_completed_lot_to_harvest_trip(),
 public.reserve_harvest_trip(), public.rls_auto_enable(),
 public.validate_harvest_trip_link() from public, anon, authenticated;
