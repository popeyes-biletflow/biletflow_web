-- Pre-demo database check. Paste into the Supabase SQL editor (read-only, changes nothing).
-- Every row should show ok = true. A false row names the migration to apply, in order:
--   008 -> 018 -> 019 -> 020 (backend/migrations), then run this again.

with checks(migration, what, ok) as (
  values
  -- 008: staff, notifications, settings, atomic check-in functions
  ('008', 'table event_staff',
     to_regclass('public.event_staff') is not null),
  ('008', 'table notifications',
     to_regclass('public.notifications') is not null),
  ('008', 'table platform_settings',
     to_regclass('public.platform_settings') is not null),
  ('008', 'events.is_suspended',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'events' and column_name = 'is_suspended')),
  ('008', 'function checkin_ticket_atomic',
     exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'checkin_ticket_atomic')),
  ('008', 'function undo_checkin_atomic',
     exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'undo_checkin_atomic')),

  -- 018: admin moderation and campaign visibility
  ('018', 'policy "owners read own campaigns" on campaigns',
     exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'campaigns'
             and policyname = 'owners read own campaigns')),
  ('018', 'policy "platform admin moderates events" on events',
     exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'events'
             and policyname = 'platform admin moderates events')),
  ('018', 'policy "platform admin moderates profiles" on profiles',
     exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
             and policyname = 'platform admin moderates profiles')),

  -- 019: atomic check-in usable by assigned staff, per-assignment undo
  ('019', 'event_staff.can_undo',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'event_staff' and column_name = 'can_undo')),
  ('019', 'checkin_ticket_atomic runs as owner (SECURITY DEFINER)',
     coalesce((select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'checkin_ticket_atomic' limit 1), false)),
  ('019', 'undo_checkin_atomic runs as owner (SECURITY DEFINER)',
     coalesce((select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'undo_checkin_atomic' limit 1), false)),
  ('019', 'check-in function is not executable by anon',
     coalesce(not has_function_privilege('anon', to_regprocedure('public.checkin_ticket_atomic(uuid,uuid,uuid)'), 'execute'), false)),
  ('019', 'policy "assigned staff read event tickets" on tickets',
     exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tickets'
             and policyname = 'assigned staff read event tickets')),

  -- 020: paid-sales state cannot be written directly
  ('020', 'trigger guard_paid_sales_columns on events',
     exists (select 1 from pg_trigger t where t.tgrelid = 'public.events'::regclass
             and t.tgname = 'guard_paid_sales_columns' and not t.tgisinternal)),
  ('020', 'activate_paid_sales runs as owner (SECURITY DEFINER)',
     coalesce((select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'activate_paid_sales' limit 1), false))
)
select migration, what, ok from checks order by migration, what;
