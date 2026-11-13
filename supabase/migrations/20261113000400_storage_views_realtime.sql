-- =============================================================================
-- JAVORA DESK — 0400 Storage, read models, realtime
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Visibility refinement: a newly assigned editor may see the storyboard that
-- was already approved for the project (it remains the agreed plan).
-- -----------------------------------------------------------------------------
drop policy if exists storyboards_read on public.storyboards;
create policy storyboards_read on public.storyboards
  for select to authenticated using (
    public.is_manager()
    or editor_id = auth.uid()
    or (status = 'approved' and public.is_current_editor(project_id))
  );

drop policy if exists project_files_read on public.project_files;
create policy project_files_read on public.project_files
  for select to authenticated using (
    public.is_manager()
    or uploaded_by = auth.uid()
    or (purpose = 'material' and public.can_view_project(project_id))
    or (
      purpose = 'storyboard'
      and public.is_current_editor(project_id)
      and exists (select 1 from public.storyboards s where s.id = storyboard_id and s.status = 'approved')
    )
  );

-- -----------------------------------------------------------------------------
-- Private storage bucket. Object names: <project_id>/<category>/<uuid>-<file>
--   category ∈ materials | understanding | storyboards
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-files', 'project-files', false, 52428800,
  array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_path_project(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end
$$;

create or replace function public.storage_path_category(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when array_length(string_to_array(p_name, '/'), 1) = 3 then split_part(p_name, '/', 2)
  end
$$;

create or replace function public.is_registered_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.project_files where storage_path = p_name)
$$;

revoke all on function public.storage_path_project(text) from public, anon;
revoke all on function public.storage_path_category(text) from public, anon;
revoke all on function public.is_registered_file(text) from public, anon;
grant execute on function public.storage_path_project(text) to authenticated;
grant execute on function public.storage_path_category(text) to authenticated;
grant execute on function public.is_registered_file(text) to authenticated;

drop policy if exists "javora: read project files" on storage.objects;
create policy "javora: read project files" on storage.objects
  for select to authenticated using (
    bucket_id = 'project-files'
    and public.current_app_role() is not null
    and (
      public.is_manager()
      or owner_id = auth.uid()::text
      or (
        public.storage_path_category(name) = 'materials'
        and public.can_view_project(public.storage_path_project(name))
      )
      or (
        public.storage_path_category(name) = 'storyboards'
        and public.is_current_editor(public.storage_path_project(name))
      )
    )
  );

drop policy if exists "javora: upload project files" on storage.objects;
create policy "javora: upload project files" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'project-files'
    and public.storage_path_project(name) is not null
    and (
      (public.storage_path_category(name) = 'materials' and public.is_manager())
      or (
        public.storage_path_category(name) in ('understanding', 'storyboards')
        and public.is_current_editor(public.storage_path_project(name))
      )
    )
  );

-- Only unregistered objects (abandoned uploads, or files of a deleted draft) can be removed.
drop policy if exists "javora: delete unregistered files" on storage.objects;
create policy "javora: delete unregistered files" on storage.objects
  for delete to authenticated using (
    bucket_id = 'project-files'
    and (owner_id = auth.uid()::text or public.is_manager())
    and not public.is_registered_file(name)
  );

-- -----------------------------------------------------------------------------
-- Read model: work sessions with DB-computed active time.
-- An open interval is capped at last heartbeat + stale threshold, so a closed
-- laptop never inflates the total even before the cleanup job runs.
-- security_invoker => the caller's RLS applies (editors see only their own).
-- -----------------------------------------------------------------------------
create or replace view public.work_session_summaries
with (security_invoker = true) as
select
  s.id,
  s.project_id,
  s.editor_id,
  s.status,
  s.started_at,
  s.ended_at,
  s.end_reason,
  s.last_heartbeat_at,
  coalesce(
    sum(
      greatest(
        0,
        extract(epoch from (
          coalesce(i.ended_at, least(now(), s.last_heartbeat_at + make_interval(mins => ws.stale_session_minutes)))
          - i.started_at
        ))
      )
    ),
    0
  )::bigint as active_seconds,
  max(i.started_at) filter (where i.ended_at is null) as running_since,
  count(i.id)::integer as interval_count,
  now() as server_now
from public.work_sessions s
cross join public.workspace_settings ws
left join public.work_session_intervals i on i.session_id = s.id
group by s.id, ws.stale_session_minutes;

revoke all on public.work_session_summaries from anon, authenticated;
grant select on public.work_session_summaries to authenticated;

-- -----------------------------------------------------------------------------
-- Dashboard statistics (security invoker: counts only what the caller may see)
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_stats()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'active', count(*) filter (where status not in ('draft', 'completed', 'cancelled') and archived_at is null),
    'available', count(*) filter (where status = 'available' and archived_at is null),
    'in_progress', count(*) filter (where status = 'in_progress'),
    'pending_confirmation', count(*) filter (where status = 'awaiting_confirmation'),
    'pending_storyboard', (
      select count(*) from public.storyboards sb
      join public.projects p2 on p2.id = sb.project_id
      where sb.status = 'pending' and p2.status = 'awaiting_storyboard_approval'
    ),
    'pending_submissions', count(*) filter (where status in ('submitted', 'dispatcher_review')),
    'revision_requested', count(*) filter (where status = 'revision_requested'),
    'completed', count(*) filter (where status = 'completed'),
    'overdue', count(*) filter (
      where deadline < now() and status not in ('draft', 'completed', 'cancelled', 'on_hold')
    ),
    'draft', count(*) filter (where status = 'draft'),
    'on_hold', count(*) filter (where status = 'on_hold')
  )
  from public.projects
$$;

-- -----------------------------------------------------------------------------
-- Team metrics (managers only). Logged time is reported separately and is NOT
-- used as a productivity score.
-- -----------------------------------------------------------------------------
create or replace function public.team_metrics()
returns table (
  editor_id uuid,
  full_name text,
  email text,
  is_active boolean,
  active_projects bigint,
  projects_completed bigint,
  avg_turnaround_hours numeric,
  revision_requests bigint,
  completed_with_deadline bigint,
  completed_on_time bigint,
  logged_seconds bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  return query
  with approved as (
    select s.editor_id, s.project_id, p.completed_at, p.deadline,
           (select a.assigned_at from public.project_assignments a
             where a.project_id = s.project_id and a.editor_id = s.editor_id
             order by a.assigned_at desc limit 1) as assigned_at
      from public.submissions s
      join public.projects p on p.id = s.project_id
     where s.status = 'approved'
  ),
  time_logged as (
    -- Same rule as work_session_summaries: an open interval counts only up to
    -- the last heartbeat + stale threshold, so offline time is never included.
    select i.editor_id,
           sum(greatest(0, extract(epoch from (
             coalesce(i.ended_at, least(now(), s.last_heartbeat_at + make_interval(mins => ws.stale_session_minutes))) - i.started_at
           ))))::bigint as secs
      from public.work_session_intervals i
      join public.work_sessions s on s.id = i.session_id
     cross join public.workspace_settings ws
     group by i.editor_id
  )
  select
    pr.id,
    pr.full_name,
    pr.email,
    pr.is_active,
    (select count(*) from public.projects p where p.assigned_editor_id = pr.id and p.status not in ('completed', 'cancelled')),
    (select count(*) from approved ap where ap.editor_id = pr.id),
    (select round(avg(extract(epoch from (ap.completed_at - ap.assigned_at)) / 3600)::numeric, 1)
       from approved ap where ap.editor_id = pr.id and ap.assigned_at is not null),
    (select count(*) from public.revision_requests rr join public.submissions s on s.id = rr.submission_id where s.editor_id = pr.id),
    (select count(*) from approved ap where ap.editor_id = pr.id and ap.deadline is not null),
    (select count(*) from approved ap where ap.editor_id = pr.id and ap.deadline is not null and ap.completed_at <= ap.deadline),
    coalesce((select tl.secs from time_logged tl where tl.editor_id = pr.id), 0)
  from public.profiles pr
  where pr.role = 'editor'
  order by pr.is_active desc, pr.full_name;
end;
$$;

revoke all on function public.dashboard_stats() from public, anon;
revoke all on function public.team_metrics() from public, anon;
grant execute on function public.dashboard_stats() to authenticated;
grant execute on function public.team_metrics() to authenticated;

-- -----------------------------------------------------------------------------
-- Realtime: notifications (per-user via RLS) and activity (drives live refresh)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
    alter publication supabase_realtime add table public.project_activity;
  end if;
end
$$;
