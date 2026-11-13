-- Optional but recommended: run JAVORA DESK maintenance every 5 minutes.
--   * auto-pauses timers whose browser stopped sending heartbeats
--   * sends "deadline approaching" notifications
-- Without this, maintenance still runs whenever someone opens the dashboard.
--
-- 1. Supabase Dashboard → Database → Extensions → enable "pg_cron".
-- 2. Run this script in the SQL Editor.
select cron.schedule(
  'javora-desk-maintenance',
  '*/5 * * * *',
  $$ select public.run_maintenance(); $$
);
-- To remove: select cron.unschedule('javora-desk-maintenance');
