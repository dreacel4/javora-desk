-- =============================================================================
-- JAVORA DESK — 0200 Access control
-- Role helpers + Row Level Security. Direct client writes are denied on every
-- table: there are deliberately NO insert/update/delete policies. All mutations
-- go through SECURITY DEFINER functions that validate role and state.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Role helpers (SECURITY DEFINER so they can read profiles without recursion).
-- Inactive (disabled) users resolve to NULL and therefore see nothing.
-- -----------------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() in ('owner', 'dispatcher'), false)
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'owner', false)
$$;

-- Has the current user ever been assigned to this project (current or past)?
create or replace function public.was_assigned_to(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_assignments a
    where a.project_id = p_project and a.editor_id = auth.uid()
  )
$$;

create or replace function public.is_current_editor(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects pr
    where pr.id = p_project and pr.assigned_editor_id = auth.uid()
  ) and public.current_app_role() = 'editor'
$$;

-- Project visibility:
--   managers: everything
--   editors : open (available, not archived) projects + projects they have been assigned to
create or replace function public.can_view_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case public.current_app_role()
    when 'owner' then true
    when 'dispatcher' then true
    when 'editor' then exists (
      select 1 from public.projects pr
      where pr.id = p_project
        and (
          (pr.status = 'available' and pr.archived_at is null)
          or exists (
            select 1 from public.project_assignments a
            where a.project_id = pr.id and a.editor_id = auth.uid()
          )
        )
    )
    else false
  end
$$;

revoke all on function public.current_app_role() from public, anon;
revoke all on function public.is_manager() from public, anon;
revoke all on function public.is_owner() from public, anon;
revoke all on function public.was_assigned_to(uuid) from public, anon;
revoke all on function public.is_current_editor(uuid) from public, anon;
revoke all on function public.can_view_project(uuid) from public, anon;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.was_assigned_to(uuid) to authenticated;
grant execute on function public.is_current_editor(uuid) to authenticated;
grant execute on function public.can_view_project(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Table privileges: anon gets nothing; authenticated gets SELECT only.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'workspace_settings', 'invitations', 'profiles', 'projects', 'project_briefs',
    'project_assets', 'project_assignments', 'editor_responses', 'storyboards',
    'storyboard_reviews', 'project_files', 'work_sessions', 'work_session_intervals',
    'submissions', 'submission_reviews', 'revision_requests', 'project_activity',
    'notifications', 'ai_reports', 'ai_findings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- SELECT policies
-- -----------------------------------------------------------------------------
create policy workspace_settings_read on public.workspace_settings
  for select to authenticated using (public.current_app_role() is not null);

create policy invitations_read on public.invitations
  for select to authenticated using (public.is_owner());

-- Every active member can see the team directory (names/roles); disabled members
-- are only visible to managers.
create policy profiles_read on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or public.is_manager()
    or (public.current_app_role() is not null and is_active)
  );

create policy projects_read on public.projects
  for select to authenticated using (
    public.is_manager()
    or (
      public.current_app_role() = 'editor'
      and (
        (status = 'available' and archived_at is null)
        or public.was_assigned_to(id)
      )
    )
  );

create policy project_briefs_read on public.project_briefs
  for select to authenticated using (public.can_view_project(project_id));

create policy project_assets_read on public.project_assets
  for select to authenticated using (public.can_view_project(project_id));

create policy project_assignments_read on public.project_assignments
  for select to authenticated using (public.is_manager() or editor_id = auth.uid());

create policy editor_responses_read on public.editor_responses
  for select to authenticated using (public.is_manager() or editor_id = auth.uid());

create policy storyboards_read on public.storyboards
  for select to authenticated using (public.is_manager() or editor_id = auth.uid());

create policy storyboard_reviews_read on public.storyboard_reviews
  for select to authenticated using (
    public.is_manager()
    or exists (select 1 from public.storyboards s where s.id = storyboard_id and s.editor_id = auth.uid())
  );

create policy project_files_read on public.project_files
  for select to authenticated using (
    public.is_manager()
    or uploaded_by = auth.uid()
    or (purpose = 'material' and public.can_view_project(project_id))
  );

-- Work sessions are private to the editor (and visible to managers).
create policy work_sessions_read on public.work_sessions
  for select to authenticated using (public.is_manager() or editor_id = auth.uid());

create policy work_session_intervals_read on public.work_session_intervals
  for select to authenticated using (public.is_manager() or editor_id = auth.uid());

create policy submissions_read on public.submissions
  for select to authenticated using (public.is_manager() or editor_id = auth.uid());

create policy submission_reviews_read on public.submission_reviews
  for select to authenticated using (
    public.is_manager()
    or exists (select 1 from public.submissions s where s.id = submission_id and s.editor_id = auth.uid())
  );

create policy revision_requests_read on public.revision_requests
  for select to authenticated using (
    public.is_manager()
    or exists (select 1 from public.submissions s where s.id = submission_id and s.editor_id = auth.uid())
  );

create policy project_activity_read on public.project_activity
  for select to authenticated using (
    public.is_manager()
    or (project_id is not null and public.was_assigned_to(project_id))
  );

create policy notifications_read on public.notifications
  for select to authenticated using (recipient_id = auth.uid());

create policy ai_reports_read on public.ai_reports
  for select to authenticated using (public.is_manager());

create policy ai_findings_read on public.ai_findings
  for select to authenticated using (public.is_manager());
