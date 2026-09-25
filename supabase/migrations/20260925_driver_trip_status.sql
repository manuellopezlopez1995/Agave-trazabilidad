-- PostgreSQL requires enum additions to commit before functions can use them.
alter type public.trip_status add value if not exists 'PENDING_DRIVER';
alter type public.trip_status add value if not exists 'AT_FIELD';
