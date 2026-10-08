-- Restrict the dashboard-created event-trigger helper; only its owner needs it.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- Index owner lookups and the expiry sweep without exposing session snapshots.
create index if not exists reading_sessions_owner_id_idx
  on public.reading_sessions(owner_id);
create index if not exists reading_sessions_expires_at_idx
  on public.reading_sessions(expires_at);

-- Supabase-hosted maintenance. Session snapshots are disposable after expiry
-- or explicit revocation; projects and script history are never touched.
create extension if not exists pg_cron;
select cron.schedule(
  'souffle-reading-session-cleanup',
  '17 * * * *',
  $job$
    delete from public.reading_sessions where expires_at <= now() or revoked;
    delete from cron.job_run_details
    where jobid = (select jobid from cron.job where jobname = 'souffle-reading-session-cleanup')
      and end_time < now() - interval '7 days';
  $job$
);
