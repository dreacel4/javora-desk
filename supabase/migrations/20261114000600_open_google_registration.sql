-- =============================================================================
-- JAVORA DESK — 0600 Open registration with Google
--
-- Workspace owners can let anyone sign in with their own Google account. New
-- Google accounts join automatically as EDITOR (never a privileged role).
--   * Email/password accounts still require an invitation.
--   * Owners are notified whenever someone joins this way.
--   * Owners can close registration again in Settings → Workspace.
-- =============================================================================

alter table public.workspace_settings
  add column if not exists open_registration boolean not null default true;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
  v_provider text := coalesce(new.raw_app_meta_data ->> 'provider', '');
  v_name text := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    ''
  );
  v_open boolean;
begin
  select * into v_inv
    from public.invitations
   where email = lower(new.email)
     and status = 'pending'
     and expires_at > now()
   order by created_at desc
   limit 1;

  if found then
    -- An owner invitation without an inviter is only valid to bootstrap the
    -- very first owner of the workspace.
    if v_inv.role = 'owner' and v_inv.invited_by is null
       and exists (select 1 from public.profiles where role = 'owner') then
      raise exception 'Owner bootstrap is only allowed for the first owner.' using errcode = '42501';
    end if;

    insert into public.profiles (id, email, full_name, role, invited_by, timezone)
    values (
      new.id, lower(new.email), coalesce(nullif(v_inv.full_name, ''), v_name), v_inv.role, v_inv.invited_by,
      (select timezone from public.workspace_settings where id = 1)
    );
    update public.invitations
       set status = 'accepted', accepted_user_id = new.id, accepted_at = now()
     where id = v_inv.id;
    insert into public.project_activity (project_id, actor_id, action, details)
    values (null, new.id, 'member.joined', jsonb_build_object('role', v_inv.role, 'email', lower(new.email), 'via', 'invitation'));
    return new;
  end if;

  -- No invitation: only Google sign-ins may self-register, and only while the
  -- owner keeps registration open. Email/password sign-ups are always refused.
  select open_registration into v_open from public.workspace_settings where id = 1;
  if v_provider <> 'google' or not coalesce(v_open, false) then
    raise exception 'Registration is by invitation only.' using errcode = '42501';
  end if;

  insert into public.profiles (id, email, full_name, role, invited_by, timezone)
  values (new.id, lower(new.email), v_name, 'editor', null, (select timezone from public.workspace_settings where id = 1));

  insert into public.project_activity (project_id, actor_id, action, details)
  values (null, new.id, 'member.joined', jsonb_build_object('role', 'editor', 'email', lower(new.email), 'via', 'google'));

  insert into public.notifications (recipient_id, project_id, type, title, body)
  select p.id, null, 'member_joined',
         'New member: ' || coalesce(nullif(v_name, ''), lower(new.email)),
         lower(new.email) || ' signed in with Google and joined as Editor. Change their role or disable the account in Team if needed.'
    from public.profiles p
   where p.role = 'owner' and p.is_active
     and coalesce((p.notification_prefs ->> 'member_joined')::boolean, true);

  return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

create or replace function public.notification_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'project_available', 'project_assigned', 'project_unassigned', 'project_claimed',
    'confirmation_submitted', 'confirmation_approved', 'confirmation_clarification',
    'storyboard_submitted', 'storyboard_approved', 'storyboard_changes_requested', 'storyboard_comment',
    'work_submitted', 'revision_requested', 'project_approved', 'deadline_approaching',
    'brief_updated', 'project_updated', 'materials_added', 'project_status_changed',
    'session_auto_paused', 'role_changed', 'member_joined'
  ]
$$;

create or replace function public.update_workspace_settings(p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role(array['owner']::public.app_role[]);
  if p_data ? 'timezone' and not exists (select 1 from pg_catalog.pg_timezone_names where name = p_data ->> 'timezone') then
    raise exception 'Unknown time zone.' using errcode = '22023';
  end if;
  update public.workspace_settings set
    workspace_name = case when p_data ? 'workspace_name' then private.clean_text(p_data, 'workspace_name') else workspace_name end,
    timezone = case when p_data ? 'timezone' then p_data ->> 'timezone' else timezone end,
    default_priority = case when p_data ? 'default_priority' then (p_data ->> 'default_priority')::public.project_priority else default_priority end,
    default_client_platform = case when p_data ? 'default_client_platform' then private.clean_text(p_data, 'default_client_platform') else default_client_platform end,
    default_resolution = case when p_data ? 'default_resolution' then private.clean_text(p_data, 'default_resolution') else default_resolution end,
    default_aspect_ratio = case when p_data ? 'default_aspect_ratio' then private.clean_text(p_data, 'default_aspect_ratio') else default_aspect_ratio end,
    default_frame_rate = case when p_data ? 'default_frame_rate' then private.clean_text(p_data, 'default_frame_rate') else default_frame_rate end,
    default_delivery_format = case when p_data ? 'default_delivery_format' then private.clean_text(p_data, 'default_delivery_format') else default_delivery_format end,
    default_storyboard_required = case when p_data ? 'default_storyboard_required' then (p_data ->> 'default_storyboard_required')::boolean else default_storyboard_required end,
    deadline_warning_hours = case when p_data ? 'deadline_warning_hours' then (p_data ->> 'deadline_warning_hours')::integer else deadline_warning_hours end,
    stale_session_minutes = case when p_data ? 'stale_session_minutes' then (p_data ->> 'stale_session_minutes')::integer else stale_session_minutes end,
    max_active_projects_per_editor = case when p_data ? 'max_active_projects_per_editor' then (p_data ->> 'max_active_projects_per_editor')::integer else max_active_projects_per_editor end,
    open_registration = case when p_data ? 'open_registration' then (p_data ->> 'open_registration')::boolean else open_registration end,
    updated_by = auth.uid()
  where id = 1;
  perform private.log(null, 'workspace.settings_updated', jsonb_build_object('keys', (select jsonb_agg(k) from jsonb_object_keys(p_data) k)));
exception
  when check_violation then
    raise exception 'One of the settings is out of range.' using errcode = '22023';
end;
$$;

revoke all on function public.update_workspace_settings(jsonb) from public, anon;
grant execute on function public.update_workspace_settings(jsonb) to authenticated;
revoke all on function public.notification_types() from public, anon;
grant execute on function public.notification_types() to authenticated;
