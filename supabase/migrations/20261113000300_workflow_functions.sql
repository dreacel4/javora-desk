-- =============================================================================
-- JAVORA DESK — 0300 Workflow functions
--
-- Every mutation performed by an application user is a SECURITY DEFINER
-- function that:
--   1. resolves the caller's role from public.profiles (never from the client),
--   2. locks the affected rows,
--   3. validates the state-machine transition,
--   4. writes data, the activity log and notifications in ONE transaction.
--
-- Error codes surfaced to the UI:
--   42501 insufficient privilege     P0002 not found
--   22023 invalid input              55000 invalid state for this action
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Private helpers (not callable through the API)
-- -----------------------------------------------------------------------------
create or replace function private.require_role(p_roles public.app_role[])
returns public.app_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid() and p.is_active;
  if v_role is null or not (v_role = any (p_roles)) then
    raise exception 'You do not have permission to perform this action.' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

create or replace function private.log(p_project uuid, p_action text, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.project_activity (project_id, actor_id, action, details)
  values (p_project, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
$$;

-- Respects the recipient's notification preferences; never notifies the actor
-- about their own action; never notifies disabled accounts.
create or replace function private.notify(
  p_recipient uuid, p_project uuid, p_type text, p_title text, p_body text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_recipient is null or p_recipient = auth.uid() then
    return;
  end if;
  insert into public.notifications (recipient_id, project_id, type, title, body)
  select p.id, p_project, p_type, left(p_title, 200), left(coalesce(p_body, ''), 1000)
  from public.profiles p
  where p.id = p_recipient
    and p.is_active
    and coalesce((p.notification_prefs ->> p_type)::boolean, true);
end;
$$;

create or replace function private.notify_role(
  p_roles public.app_role[], p_project uuid, p_type text, p_title text, p_body text default ''
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, project_id, type, title, body)
  select p.id, p_project, p_type, left(p_title, 200), left(coalesce(p_body, ''), 1000)
  from public.profiles p
  where p.is_active
    and p.role = any (p_roles)
    and p.id is distinct from auth.uid()
    and coalesce((p.notification_prefs ->> p_type)::boolean, true);
$$;

create or replace function private.set_status(p_project uuid, p_status public.project_status)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.projects
     set status = p_status, status_changed_at = now()
   where id = p_project;
$$;

-- Locks a project row and returns it; raises if missing.
create or replace function private.lock_project(p_project uuid)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
begin
  select * into v from public.projects where id = p_project for update;
  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

create or replace function private.require_status(p public.projects, p_allowed public.project_status[], p_action text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not (p.status = any (p_allowed)) then
    raise exception 'Cannot % while the project is %.', p_action, replace(p.status::text, '_', ' ')
      using errcode = '55000';
  end if;
end;
$$;

-- Stops every open session on a project (optionally for one editor).
create or replace function private.stop_project_sessions(p_project uuid, p_editor uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.work_session_intervals i
     set ended_at = now(), end_reason = p_reason
    from public.work_sessions s
   where i.session_id = s.id
     and i.ended_at is null
     and s.project_id = p_project
     and (p_editor is null or s.editor_id = p_editor);

  update public.work_sessions
     set status = 'stopped', ended_at = now(), end_reason = p_reason
   where project_id = p_project
     and status <> 'stopped'
     and (p_editor is null or editor_id = p_editor);
end;
$$;

-- Auto-pauses sessions whose browser stopped sending heartbeats. The interval
-- is closed at the last heartbeat, so offline time is never counted as work.
create or replace function private.close_stale_sessions(p_editor uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minutes integer;
  v_count integer := 0;
  r record;
begin
  select stale_session_minutes into v_minutes from public.workspace_settings where id = 1;

  for r in
    select s.id, s.project_id, s.editor_id, s.last_heartbeat_at, i.id as interval_id, i.started_at
      from public.work_sessions s
      join public.work_session_intervals i on i.session_id = s.id and i.ended_at is null
     where s.status = 'active'
       and s.last_heartbeat_at < now() - make_interval(mins => v_minutes)
       and (p_editor is null or s.editor_id = p_editor)
     for update of s, i
  loop
    update public.work_session_intervals
       set ended_at = greatest(r.started_at, r.last_heartbeat_at), end_reason = 'inactive'
     where id = r.interval_id;
    update public.work_sessions set status = 'paused' where id = r.id;

    insert into public.project_activity (project_id, actor_id, action, details)
    values (r.project_id, null, 'work_session.auto_paused',
            jsonb_build_object('session_id', r.id, 'editor_id', r.editor_id, 'last_heartbeat_at', r.last_heartbeat_at));

    insert into public.notifications (recipient_id, project_id, type, title, body)
    select p.id, r.project_id, 'session_auto_paused', 'Your timer was paused automatically',
           'No activity was received from your browser, so the timer stopped at the last confirmed moment.'
      from public.profiles p
     where p.id = r.editor_id and coalesce((p.notification_prefs ->> 'session_auto_paused')::boolean, true);

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Verifies that a storage object exists, was uploaded by the caller, and sits
-- under the expected project folder. Returns the trusted mime type and size.
create or replace function private.verify_upload(p_path text, p_prefix text)
returns table (mime_type text, size_bytes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_path is null or left(p_path, char_length(p_prefix)) <> p_prefix or p_path like '%..%' then
    raise exception 'Invalid file path.' using errcode = '22023';
  end if;
  return query
    select coalesce(o.metadata ->> 'mimetype', 'application/octet-stream'),
           coalesce((o.metadata ->> 'size')::bigint, 0)
      from storage.objects o
     where o.bucket_id = 'project-files'
       and o.name = p_path
       and coalesce(o.owner_id, o.owner::text) = auth.uid()::text;
  if not found then
    raise exception 'Uploaded file was not found. Please upload it again.' using errcode = '22023';
  end if;
end;
$$;

create or replace function private.clean_text(p jsonb, p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(coalesce(p ->> p_key, ''))
$$;

-- -----------------------------------------------------------------------------
-- New auth users: invitation-only. A user without a valid pending invitation
-- cannot be created at all (the insert into auth.users is rejected).
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
begin
  select * into v_inv
    from public.invitations
   where email = lower(new.email)
     and status = 'pending'
     and expires_at > now()
   order by created_at desc
   limit 1;

  if not found then
    raise exception 'Registration is by invitation only.' using errcode = '42501';
  end if;

  -- An owner invitation without an inviter is only valid to bootstrap the very
  -- first owner of the workspace.
  if v_inv.role = 'owner' and v_inv.invited_by is null
     and exists (select 1 from public.profiles where role = 'owner') then
    raise exception 'Owner bootstrap is only allowed for the first owner.' using errcode = '42501';
  end if;

  insert into public.profiles (id, email, full_name, role, invited_by, timezone)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(v_inv.full_name, ''), nullif(new.raw_user_meta_data ->> 'full_name', ''), ''),
    v_inv.role,
    v_inv.invited_by,
    (select timezone from public.workspace_settings where id = 1)
  );

  update public.invitations
     set status = 'accepted', accepted_user_id = new.id, accepted_at = now()
   where id = v_inv.id;

  insert into public.project_activity (project_id, actor_id, action, details)
  values (null, new.id, 'member.joined', jsonb_build_object('role', v_inv.role, 'email', lower(new.email)));

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

create or replace function private.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.profiles set email = lower(new.email) where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function private.handle_auth_user_email_change();

-- =============================================================================
-- PUBLIC API — Projects
-- =============================================================================

create or replace function private.publish(p public.projects)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p.deadline is null then
    raise exception 'Set a deadline before publishing.' using errcode = '22023';
  end if;
  if p.deadline <= now() then
    raise exception 'The deadline must be in the future to publish.' using errcode = '22023';
  end if;

  if p.planned_editor_id is not null then
    if not exists (select 1 from public.profiles where id = p.planned_editor_id and role = 'editor' and is_active) then
      raise exception 'The selected editor is not an active editor.' using errcode = '22023';
    end if;
    update public.projects
       set status = 'claimed', assigned_editor_id = p.planned_editor_id, planned_editor_id = null,
           published_at = now(), status_changed_at = now()
     where id = p.id;
    insert into public.project_assignments (project_id, editor_id, method, assigned_by)
    values (p.id, p.planned_editor_id, 'assigned', auth.uid());
    perform private.log(p.id, 'project.published', jsonb_build_object('assigned_editor_id', p.planned_editor_id));
    perform private.notify(p.planned_editor_id, p.id, 'project_assigned',
      'New project assigned: ' || p.title, 'Review the brief and submit your understanding before starting.');
  else
    update public.projects
       set status = 'available', published_at = now(), status_changed_at = now()
     where id = p.id;
    perform private.log(p.id, 'project.published', '{}'::jsonb);
    perform private.notify_role(array['editor']::public.app_role[], p.id, 'project_available',
      'New project available: ' || p.title,
      'Priority: ' || p.priority::text || coalesce(' · Deadline: ' || to_char(p.deadline at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'), ''));
  end if;
end;
$$;

create or replace function public.create_project(p_data jsonb, p_publish boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_project public.projects;
  v_asset jsonb;
  v_planned uuid;
  v_settings public.workspace_settings;
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  select * into v_settings from public.workspace_settings where id = 1;

  if private.clean_text(p_data, 'original_client_brief') = '' then
    raise exception 'The original client brief is required.' using errcode = '22023';
  end if;

  v_planned := nullif(p_data ->> 'planned_editor_id', '')::uuid;
  if v_planned is not null and not exists (
    select 1 from public.profiles where id = v_planned and role = 'editor' and is_active
  ) then
    raise exception 'The selected editor is not an active editor.' using errcode = '22023';
  end if;

  insert into public.projects (
    internal_ref, title, client_name, client_platform, description,
    output_resolution, aspect_ratio, frame_rate, required_duration, delivery_format,
    priority, deadline, storyboard_required, planned_editor_id, created_by
  ) values (
    private.clean_text(p_data, 'internal_ref'),
    private.clean_text(p_data, 'title'),
    private.clean_text(p_data, 'client_name'),
    coalesce(nullif(private.clean_text(p_data, 'client_platform'), ''), v_settings.default_client_platform),
    private.clean_text(p_data, 'description'),
    private.clean_text(p_data, 'output_resolution'),
    private.clean_text(p_data, 'aspect_ratio'),
    private.clean_text(p_data, 'frame_rate'),
    private.clean_text(p_data, 'required_duration'),
    private.clean_text(p_data, 'delivery_format'),
    coalesce(nullif(p_data ->> 'priority', '')::public.project_priority, v_settings.default_priority),
    nullif(p_data ->> 'deadline', '')::timestamptz,
    coalesce((p_data ->> 'storyboard_required')::boolean, v_settings.default_storyboard_required),
    v_planned,
    auth.uid()
  ) returning id into v_id;

  insert into public.project_briefs (project_id, version, original_client_brief, editing_requirements, additional_instructions, created_by)
  values (
    v_id, 1,
    private.clean_text(p_data, 'original_client_brief'),
    private.clean_text(p_data, 'editing_requirements'),
    private.clean_text(p_data, 'additional_instructions'),
    auth.uid()
  );

  for v_asset in select * from jsonb_array_elements(coalesce(p_data -> 'assets', '[]'::jsonb)) loop
    insert into public.project_assets (project_id, kind, label, url, notes, created_by)
    values (
      v_id,
      (v_asset ->> 'kind')::public.asset_kind,
      private.clean_text(v_asset, 'label'),
      private.clean_text(v_asset, 'url'),
      private.clean_text(v_asset, 'notes'),
      auth.uid()
    );
  end loop;

  perform private.log(v_id, 'project.created', jsonb_build_object('title', private.clean_text(p_data, 'title')));

  if p_publish then
    select * into v_project from public.projects where id = v_id;
    perform private.publish(v_project);
  end if;

  return v_id;
exception
  when unique_violation then
    raise exception 'A project with this internal ID already exists.' using errcode = '23505';
end;
$$;

create or replace function public.publish_project(p_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  v := private.lock_project(p_project);
  perform private.require_status(v, array['draft']::public.project_status[], 'publish');
  perform private.publish(v);
end;
$$;

create or replace function public.update_project(p_project uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.projects;
  v_new public.projects;
  v_changes jsonb;
  v_planned uuid;
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  v_old := private.lock_project(p_project);
  if v_old.status in ('completed', 'cancelled') then
    raise exception 'Completed or cancelled projects cannot be edited.' using errcode = '55000';
  end if;

  if p_data ? 'storyboard_required'
     and (p_data ->> 'storyboard_required')::boolean is distinct from v_old.storyboard_required
     and v_old.status not in ('draft', 'available', 'claimed', 'awaiting_confirmation') then
    raise exception 'The storyboard requirement can only change before the editor''s understanding is approved.'
      using errcode = '55000';
  end if;

  if p_data ? 'planned_editor_id' then
    if v_old.status <> 'draft' then
      raise exception 'Use assignment actions to change the editor of a published project.' using errcode = '55000';
    end if;
    v_planned := nullif(p_data ->> 'planned_editor_id', '')::uuid;
    if v_planned is not null and not exists (
      select 1 from public.profiles where id = v_planned and role = 'editor' and is_active
    ) then
      raise exception 'The selected editor is not an active editor.' using errcode = '22023';
    end if;
  end if;

  if p_data ? 'deadline' and v_old.status <> 'draft' and nullif(p_data ->> 'deadline', '') is null then
    raise exception 'Published projects must keep a deadline.' using errcode = '22023';
  end if;

  update public.projects set
    internal_ref        = case when p_data ? 'internal_ref' then private.clean_text(p_data, 'internal_ref') else internal_ref end,
    title               = case when p_data ? 'title' then private.clean_text(p_data, 'title') else title end,
    client_name         = case when p_data ? 'client_name' then private.clean_text(p_data, 'client_name') else client_name end,
    client_platform     = case when p_data ? 'client_platform' then private.clean_text(p_data, 'client_platform') else client_platform end,
    description         = case when p_data ? 'description' then private.clean_text(p_data, 'description') else description end,
    output_resolution   = case when p_data ? 'output_resolution' then private.clean_text(p_data, 'output_resolution') else output_resolution end,
    aspect_ratio        = case when p_data ? 'aspect_ratio' then private.clean_text(p_data, 'aspect_ratio') else aspect_ratio end,
    frame_rate          = case when p_data ? 'frame_rate' then private.clean_text(p_data, 'frame_rate') else frame_rate end,
    required_duration   = case when p_data ? 'required_duration' then private.clean_text(p_data, 'required_duration') else required_duration end,
    delivery_format     = case when p_data ? 'delivery_format' then private.clean_text(p_data, 'delivery_format') else delivery_format end,
    priority            = case when p_data ? 'priority' then (p_data ->> 'priority')::public.project_priority else priority end,
    deadline            = case when p_data ? 'deadline' then nullif(p_data ->> 'deadline', '')::timestamptz else deadline end,
    storyboard_required = case when p_data ? 'storyboard_required' then (p_data ->> 'storyboard_required')::boolean else storyboard_required end,
    planned_editor_id   = case when p_data ? 'planned_editor_id' then v_planned else planned_editor_id end
  where id = p_project
  returning * into v_new;

  if v_new.deadline is distinct from v_old.deadline then
    update public.projects set deadline_notified_at = null where id = p_project;
  end if;

  select coalesce(jsonb_object_agg(n.key, jsonb_build_object('from', to_jsonb(v_old) -> n.key, 'to', n.value)), '{}'::jsonb)
    into v_changes
    from jsonb_each(to_jsonb(v_new)) n
   where n.key not in ('updated_at', 'status_changed_at', 'deadline_notified_at')
     and (to_jsonb(v_old) -> n.key) is distinct from n.value;

  if v_changes <> '{}'::jsonb then
    perform private.log(p_project, 'project.updated', jsonb_build_object('changes', v_changes));
    perform private.notify(v_new.assigned_editor_id, p_project, 'project_updated',
      'Project details updated: ' || v_new.title, 'Check the project overview for the latest specifications.');
  end if;
exception
  when unique_violation then
    raise exception 'A project with this internal ID already exists.' using errcode = '23505';
end;
$$;

-- Briefs are versioned. While a project is still a draft the working version is
-- edited in place (nobody has seen it yet); once published every change creates
-- a new version and earlier versions are kept untouched.
create or replace function public.update_project_brief(
  p_project uuid,
  p_original_client_brief text,
  p_editing_requirements text,
  p_additional_instructions text,
  p_change_note text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
  v_cur public.project_briefs;
  v_version integer;
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  v := private.lock_project(p_project);
  if v.status in ('completed', 'cancelled') then
    raise exception 'The brief of a completed or cancelled project cannot change.' using errcode = '55000';
  end if;

  select * into v_cur from public.project_briefs where project_id = p_project and version = v.current_brief_version;

  if btrim(coalesce(p_original_client_brief, '')) = '' then
    raise exception 'The client brief cannot be empty.' using errcode = '22023';
  end if;

  if v_cur.original_client_brief = btrim(p_original_client_brief)
     and v_cur.editing_requirements = btrim(coalesce(p_editing_requirements, ''))
     and v_cur.additional_instructions = btrim(coalesce(p_additional_instructions, '')) then
    raise exception 'No changes to save.' using errcode = '22023';
  end if;

  if v.status = 'draft' then
    update public.project_briefs
       set original_client_brief = btrim(p_original_client_brief),
           editing_requirements = btrim(coalesce(p_editing_requirements, '')),
           additional_instructions = btrim(coalesce(p_additional_instructions, '')),
           change_note = btrim(coalesce(p_change_note, ''))
     where id = v_cur.id;
    perform private.log(p_project, 'brief.edited_draft', jsonb_build_object('version', v_cur.version));
    return v_cur.version;
  end if;

  if char_length(btrim(coalesce(p_change_note, ''))) < 5 then
    raise exception 'Describe what changed in the brief (at least 5 characters).' using errcode = '22023';
  end if;

  v_version := v.current_brief_version + 1;
  insert into public.project_briefs (project_id, version, original_client_brief, editing_requirements, additional_instructions, change_note, created_by)
  values (p_project, v_version, btrim(p_original_client_brief), btrim(coalesce(p_editing_requirements, '')),
          btrim(coalesce(p_additional_instructions, '')), btrim(p_change_note), auth.uid());
  update public.projects set current_brief_version = v_version where id = p_project;

  perform private.log(p_project, 'brief.versioned', jsonb_build_object('version', v_version, 'change_note', btrim(p_change_note)));
  perform private.notify(v.assigned_editor_id, p_project, 'brief_updated',
    'Brief updated (v' || v_version || '): ' || v.title, btrim(p_change_note));
  return v_version;
end;
$$;

create or replace function public.add_project_asset(
  p_project uuid, p_kind public.asset_kind, p_label text, p_url text, p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
  v_id uuid;
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  v := private.lock_project(p_project);
  if v.status in ('completed', 'cancelled') then
    raise exception 'Materials cannot be added to a closed project.' using errcode = '55000';
  end if;
  insert into public.project_assets (project_id, kind, label, url, notes, created_by)
  values (p_project, p_kind, btrim(p_label), btrim(p_url), btrim(coalesce(p_notes, '')), auth.uid())
  returning id into v_id;
  perform private.log(p_project, 'asset.added', jsonb_build_object('asset_id', v_id, 'kind', p_kind, 'label', btrim(p_label)));
  if v.status <> 'draft' then
    perform private.notify(v.assigned_editor_id, p_project, 'materials_added',
      'New ' || replace(p_kind::text, '_', ' ') || ' added: ' || v.title, btrim(p_label));
  end if;
  return v_id;
end;
$$;

-- Registers a file the caller already uploaded to storage as a project asset.
create or replace function public.add_project_file_asset(
  p_project uuid, p_kind public.asset_kind, p_label text, p_notes text, p_path text, p_file_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
  v_mime text;
  v_size bigint;
  v_id uuid;
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  v := private.lock_project(p_project);
  if v.status in ('completed', 'cancelled') then
    raise exception 'Materials cannot be added to a closed project.' using errcode = '55000';
  end if;
  select f.mime_type, f.size_bytes into v_mime, v_size
    from private.verify_upload(p_path, p_project::text || '/materials/') f;

  insert into public.project_files (project_id, purpose, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (p_project, 'material', p_path, btrim(p_file_name), v_mime, v_size, auth.uid());
  insert into public.project_assets (project_id, kind, label, storage_path, notes, created_by)
  values (p_project, p_kind, btrim(p_label), p_path, btrim(coalesce(p_notes, '')), auth.uid())
  returning id into v_id;

  perform private.log(p_project, 'asset.added', jsonb_build_object('asset_id', v_id, 'kind', p_kind, 'label', btrim(p_label), 'file', btrim(p_file_name)));
  if v.status <> 'draft' then
    perform private.notify(v.assigned_editor_id, p_project, 'materials_added',
      'New ' || replace(p_kind::text, '_', ' ') || ' added: ' || v.title, btrim(p_label));
  end if;
  return v_id;
end;
$$;

create or replace function public.remove_project_asset(p_asset uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.project_assets;
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  update public.project_assets
     set removed_at = now(), removed_by = auth.uid()
   where id = p_asset and removed_at is null
  returning * into v_asset;
  if not found then
    raise exception 'Material not found or already removed.' using errcode = 'P0002';
  end if;
  perform private.log(v_asset.project_id, 'asset.removed', jsonb_build_object('asset_id', p_asset, 'label', v_asset.label));
end;
$$;

-- =============================================================================
-- Claiming and assignment
-- =============================================================================

create or replace function public.claim_project(p_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_max integer;
  v_active integer;
begin
  perform private.require_role(array['editor']::public.app_role[]);
  -- Serialize claims per editor so the active-project limit cannot be raced.
  perform 1 from public.profiles where id = auth.uid() for update;

  select max_active_projects_per_editor into v_max from public.workspace_settings where id = 1;
  if v_max > 0 then
    select count(*) into v_active
      from public.projects
     where assigned_editor_id = auth.uid()
       and status not in ('completed', 'cancelled', 'on_hold');
    if v_active >= v_max then
      raise exception 'You already have % active projects (limit %). Finish one before claiming another.', v_active, v_max
        using errcode = '55000';
    end if;
  end if;

  -- Atomic compare-and-set: only one concurrent claim can match status = 'available'.
  update public.projects
     set status = 'claimed', assigned_editor_id = auth.uid(), status_changed_at = now()
   where id = p_project
     and status = 'available'
     and archived_at is null
  returning title into v_title;

  if not found then
    raise exception 'This project is no longer available to claim.' using errcode = '55000';
  end if;

  insert into public.project_assignments (project_id, editor_id, method, assigned_by)
  values (p_project, auth.uid(), 'claimed', auth.uid());

  perform private.log(p_project, 'project.claimed', '{}'::jsonb);
  perform private.notify_role(array['owner', 'dispatcher']::public.app_role[], p_project, 'project_claimed',
    'Project claimed: ' || v_title,
    coalesce((select nullif(full_name, '') from public.profiles where id = auth.uid()), 'An editor') || ' claimed this project.');
end;
$$;

create or replace function private.end_assignment(p_project uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_editor uuid;
begin
  update public.project_assignments
     set ended_at = now(), ended_by = auth.uid(), end_reason = p_reason
   where project_id = p_project and ended_at is null
  returning editor_id into v_editor;

  if v_editor is not null then
    perform private.stop_project_sessions(p_project, v_editor, 'unassigned');
    update public.editor_responses set status = 'superseded'
     where project_id = p_project and editor_id = v_editor and status = 'pending';
    update public.storyboards set status = 'superseded'
     where project_id = p_project and editor_id = v_editor and status = 'pending';
  end if;
  return v_editor;
end;
$$;

create or replace function public.assign_editor(p_project uuid, p_editor uuid, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
  v_prev uuid;
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  v := private.lock_project(p_project);

  if not exists (select 1 from public.profiles where id = p_editor and role = 'editor' and is_active) then
    raise exception 'The selected person is not an active editor.' using errcode = '22023';
  end if;

  if v.status = 'draft' then
    update public.projects set planned_editor_id = p_editor where id = p_project;
    perform private.log(p_project, 'project.editor_planned', jsonb_build_object('editor_id', p_editor));
    return;
  end if;

  perform private.require_status(v, array[
    'available', 'claimed', 'awaiting_confirmation', 'awaiting_storyboard_approval',
    'ready_to_start', 'in_progress', 'revision_requested'
  ]::public.project_status[], 'assign an editor');

  if v.assigned_editor_id = p_editor then
    raise exception 'This editor is already assigned.' using errcode = '22023';
  end if;

  if v.assigned_editor_id is not null and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason for reassigning this project.' using errcode = '22023';
  end if;

  v_prev := private.end_assignment(p_project, nullif(btrim(coalesce(p_reason, '')), ''));

  -- A new editor always starts by confirming their understanding of the brief.
  update public.projects
     set assigned_editor_id = p_editor, status = 'claimed', status_changed_at = now()
   where id = p_project;
  insert into public.project_assignments (project_id, editor_id, method, assigned_by)
  values (p_project, p_editor, 'assigned', auth.uid());

  perform private.log(p_project, case when v_prev is null then 'project.assigned' else 'project.reassigned' end,
    jsonb_build_object('editor_id', p_editor, 'previous_editor_id', v_prev, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  perform private.notify(p_editor, p_project, 'project_assigned',
    'Project assigned to you: ' || v.title, 'Review the brief and submit your understanding before starting.');
  if v_prev is not null then
    perform private.notify(v_prev, p_project, 'project_unassigned',
      'You were unassigned from: ' || v.title, coalesce(btrim(p_reason), ''));
  end if;
end;
$$;

create or replace function public.unassign_editor(p_project uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
  v_prev uuid;
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  v := private.lock_project(p_project);
  if v.status = 'draft' then
    update public.projects set planned_editor_id = null where id = p_project;
    return;
  end if;
  perform private.require_status(v, array[
    'claimed', 'awaiting_confirmation', 'awaiting_storyboard_approval',
    'ready_to_start', 'in_progress', 'revision_requested'
  ]::public.project_status[], 'unassign the editor');
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason for unassigning the editor.' using errcode = '22023';
  end if;

  v_prev := private.end_assignment(p_project, btrim(p_reason));
  update public.projects
     set assigned_editor_id = null, status = 'available', status_changed_at = now()
   where id = p_project;

  perform private.log(p_project, 'project.unassigned', jsonb_build_object('previous_editor_id', v_prev, 'reason', btrim(p_reason)));
  perform private.notify(v_prev, p_project, 'project_unassigned', 'You were unassigned from: ' || v.title, btrim(p_reason));
  perform private.notify_role(array['editor']::public.app_role[], p_project, 'project_available',
    'Project available again: ' || v.title, '');
end;
$$;

-- =============================================================================
-- Editor understanding (confirmation)
-- =============================================================================

create or replace function public.submit_editor_response(p_project uuid, p_data jsonb, p_files jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
  v_id uuid;
  v_version integer;
  f jsonb;
  v_mime text;
  v_size bigint;
begin
  perform private.require_role(array['editor']::public.app_role[]);
  v := private.lock_project(p_project);
  if v.assigned_editor_id is distinct from auth.uid() then
    raise exception 'Only the assigned editor can submit an understanding.' using errcode = '42501';
  end if;
  perform private.require_status(v, array['claimed']::public.project_status[], 'submit an understanding');

  select coalesce(max(version), 0) + 1 into v_version from public.editor_responses where project_id = p_project;

  insert into public.editor_responses (
    project_id, editor_id, version, brief_version,
    materials_description, requirements_understanding, editing_approach, visual_sequence,
    expected_deliverables, missing_assets, questions
  ) values (
    p_project, auth.uid(), v_version, v.current_brief_version,
    private.clean_text(p_data, 'materials_description'),
    private.clean_text(p_data, 'requirements_understanding'),
    private.clean_text(p_data, 'editing_approach'),
    private.clean_text(p_data, 'visual_sequence'),
    private.clean_text(p_data, 'expected_deliverables'),
    private.clean_text(p_data, 'missing_assets'),
    private.clean_text(p_data, 'questions')
  ) returning id into v_id;

  if jsonb_array_length(coalesce(p_files, '[]'::jsonb)) > 10 then
    raise exception 'Attach at most 10 files.' using errcode = '22023';
  end if;
  for f in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    select u.mime_type, u.size_bytes into v_mime, v_size
      from private.verify_upload(f ->> 'path', p_project::text || '/understanding/') u;
    insert into public.project_files (project_id, purpose, storage_path, file_name, mime_type, size_bytes, editor_response_id, uploaded_by)
    values (p_project, 'understanding_attachment', f ->> 'path', btrim(f ->> 'name'), v_mime, v_size, v_id, auth.uid());
  end loop;

  perform private.set_status(p_project, 'awaiting_confirmation');
  perform private.log(p_project, 'understanding.submitted', jsonb_build_object('response_id', v_id, 'version', v_version));
  perform private.notify_role(array['owner', 'dispatcher']::public.app_role[], p_project, 'confirmation_submitted',
    'Understanding submitted: ' || v.title,
    case when private.clean_text(p_data, 'questions') <> '' then 'The editor has questions for you.' else 'Ready for your review.' end);
  return v_id;
end;
$$;

create or replace function public.review_editor_response(p_response uuid, p_decision text, p_note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.editor_responses;
  v public.projects;
  v_next public.project_status;
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  select * into r from public.editor_responses where id = p_response;
  if not found then
    raise exception 'Response not found.' using errcode = 'P0002';
  end if;
  v := private.lock_project(r.project_id);
  select * into r from public.editor_responses where id = p_response for update;

  if r.status <> 'pending' then
    raise exception 'This understanding has already been reviewed.' using errcode = '55000';
  end if;
  perform private.require_status(v, array['awaiting_confirmation']::public.project_status[], 'review the understanding');
  if r.editor_id is distinct from v.assigned_editor_id then
    raise exception 'This understanding belongs to a previous editor.' using errcode = '55000';
  end if;

  if p_decision = 'approved' then
    update public.editor_responses
       set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_response;
    if v.storyboard_required and not exists (
      select 1 from public.storyboards where project_id = v.id and status = 'approved'
    ) then
      v_next := 'awaiting_storyboard_approval';
    else
      v_next := 'ready_to_start';
    end if;
    perform private.set_status(v.id, v_next);
    perform private.log(v.id, 'understanding.approved', jsonb_build_object('response_id', p_response, 'next_status', v_next));
    perform private.notify(r.editor_id, v.id, 'confirmation_approved', 'Understanding approved: ' || v.title,
      case when v_next = 'awaiting_storyboard_approval' then 'Next step: upload your storyboard for approval.'
           else 'You can start production now.' end);
  elsif p_decision = 'clarification_requested' then
    if char_length(btrim(coalesce(p_note, ''))) < 5 then
      raise exception 'Explain what needs clarification (at least 5 characters).' using errcode = '22023';
    end if;
    update public.editor_responses
       set status = 'clarification_requested', reviewed_by = auth.uid(), reviewed_at = now(), review_note = btrim(p_note)
     where id = p_response;
    perform private.set_status(v.id, 'claimed');
    perform private.log(v.id, 'understanding.clarification_requested', jsonb_build_object('response_id', p_response, 'note', btrim(p_note)));
    perform private.notify(r.editor_id, v.id, 'confirmation_clarification', 'Clarification requested: ' || v.title, btrim(p_note));
  else
    raise exception 'Unknown decision.' using errcode = '22023';
  end if;
end;
$$;

-- =============================================================================
-- Storyboards
-- =============================================================================

create or replace function public.submit_storyboard(p_project uuid, p_description text, p_sequence_notes text, p_files jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
  v_id uuid;
  v_version integer;
  f jsonb;
  v_mime text;
  v_size bigint;
begin
  perform private.require_role(array['editor']::public.app_role[]);
  v := private.lock_project(p_project);
  if v.assigned_editor_id is distinct from auth.uid() then
    raise exception 'Only the assigned editor can submit a storyboard.' using errcode = '42501';
  end if;
  perform private.require_status(v, array['awaiting_storyboard_approval']::public.project_status[], 'submit a storyboard');
  if exists (select 1 from public.storyboards where project_id = p_project and status = 'pending') then
    raise exception 'A storyboard is already waiting for review.' using errcode = '55000';
  end if;
  if jsonb_array_length(coalesce(p_files, '[]'::jsonb)) = 0 then
    raise exception 'Attach at least one storyboard file (PDF, PNG or JPG).' using errcode = '22023';
  end if;
  if jsonb_array_length(p_files) > 10 then
    raise exception 'Attach at most 10 storyboard files.' using errcode = '22023';
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.storyboards where project_id = p_project;
  insert into public.storyboards (project_id, editor_id, version, description, sequence_notes)
  values (p_project, auth.uid(), v_version, btrim(coalesce(p_description, '')), btrim(coalesce(p_sequence_notes, '')))
  returning id into v_id;

  for f in select * from jsonb_array_elements(p_files) loop
    select u.mime_type, u.size_bytes into v_mime, v_size
      from private.verify_upload(f ->> 'path', p_project::text || '/storyboards/') u;
    if v_mime not in ('application/pdf', 'image/png', 'image/jpeg') then
      raise exception 'Storyboards must be PDF, PNG or JPG files.' using errcode = '22023';
    end if;
    insert into public.project_files (project_id, purpose, storage_path, file_name, mime_type, size_bytes, storyboard_id, uploaded_by)
    values (p_project, 'storyboard', f ->> 'path', btrim(f ->> 'name'), v_mime, v_size, v_id, auth.uid());
  end loop;

  perform private.log(p_project, 'storyboard.submitted', jsonb_build_object('storyboard_id', v_id, 'version', v_version));
  perform private.notify_role(array['owner', 'dispatcher']::public.app_role[], p_project, 'storyboard_submitted',
    'Storyboard v' || v_version || ' submitted: ' || v.title, 'Ready for your review.');
  return v_id;
end;
$$;

create or replace function public.review_storyboard(p_storyboard uuid, p_decision public.storyboard_decision, p_comment text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.storyboards;
  v public.projects;
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  select * into s from public.storyboards where id = p_storyboard;
  if not found then
    raise exception 'Storyboard not found.' using errcode = 'P0002';
  end if;
  v := private.lock_project(s.project_id);
  select * into s from public.storyboards where id = p_storyboard for update;

  if p_decision = 'comment' then
    if char_length(btrim(coalesce(p_comment, ''))) = 0 then
      raise exception 'Write a comment first.' using errcode = '22023';
    end if;
    insert into public.storyboard_reviews (storyboard_id, project_id, reviewer_id, decision, comment)
    values (p_storyboard, s.project_id, auth.uid(), 'comment', btrim(p_comment));
    perform private.log(s.project_id, 'storyboard.commented', jsonb_build_object('storyboard_id', p_storyboard));
    perform private.notify(s.editor_id, s.project_id, 'storyboard_comment', 'New storyboard comment: ' || v.title, left(btrim(p_comment), 300));
    return;
  end if;

  if s.status <> 'pending' then
    raise exception 'This storyboard has already been decided.' using errcode = '55000';
  end if;
  perform private.require_status(v, array['awaiting_storyboard_approval']::public.project_status[], 'review the storyboard');

  if p_decision = 'approved' then
    update public.storyboards set status = 'approved', decided_at = now(), decided_by = auth.uid() where id = p_storyboard;
    insert into public.storyboard_reviews (storyboard_id, project_id, reviewer_id, decision, comment)
    values (p_storyboard, s.project_id, auth.uid(), 'approved', btrim(coalesce(p_comment, '')));
    perform private.set_status(s.project_id, 'ready_to_start');
    perform private.log(s.project_id, 'storyboard.approved', jsonb_build_object('storyboard_id', p_storyboard, 'version', s.version));
    perform private.notify(s.editor_id, s.project_id, 'storyboard_approved', 'Storyboard approved: ' || v.title, 'You can start production now.');
  else
    if char_length(btrim(coalesce(p_comment, ''))) < 5 then
      raise exception 'Explain the requested changes (at least 5 characters).' using errcode = '22023';
    end if;
    update public.storyboards set status = 'changes_requested', decided_at = now(), decided_by = auth.uid() where id = p_storyboard;
    insert into public.storyboard_reviews (storyboard_id, project_id, reviewer_id, decision, comment)
    values (p_storyboard, s.project_id, auth.uid(), 'changes_requested', btrim(p_comment));
    perform private.log(s.project_id, 'storyboard.changes_requested', jsonb_build_object('storyboard_id', p_storyboard, 'version', s.version));
    perform private.notify(s.editor_id, s.project_id, 'storyboard_changes_requested',
      'Storyboard changes requested: ' || v.title, left(btrim(p_comment), 300));
  end if;
end;
$$;

-- =============================================================================
-- Work timer
-- =============================================================================

create or replace function public.start_work_session(p_project uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
  v_active public.work_sessions;
  v_open public.work_sessions;
  v_id uuid;
begin
  perform private.require_role(array['editor']::public.app_role[]);
  -- Serialize all timer operations of this editor (multiple tabs/devices).
  perform 1 from public.profiles where id = auth.uid() for update;
  perform private.close_stale_sessions(auth.uid());

  v := private.lock_project(p_project);
  if v.assigned_editor_id is distinct from auth.uid() then
    raise exception 'Only the assigned editor can track time on this project.' using errcode = '42501';
  end if;
  perform private.require_status(v, array['ready_to_start', 'in_progress', 'revision_requested']::public.project_status[], 'start the timer');

  select * into v_active from public.work_sessions where editor_id = auth.uid() and status = 'active';
  if found then
    if v_active.project_id = p_project then
      return v_active.id;  -- idempotent: already running here
    end if;
    raise exception 'You already have a running timer on "%". Pause it before starting another.',
      (select title from public.projects where id = v_active.project_id) using errcode = '55000';
  end if;

  if v.status <> 'in_progress' then
    perform private.set_status(p_project, 'in_progress');
    perform private.log(p_project, 'project.production_started',
      jsonb_build_object('from_status', v.status));
  end if;

  select * into v_open from public.work_sessions
   where project_id = p_project and editor_id = auth.uid() and status = 'paused';
  if found then
    update public.work_sessions set status = 'active', last_heartbeat_at = now() where id = v_open.id;
    insert into public.work_session_intervals (session_id, editor_id) values (v_open.id, auth.uid());
    perform private.log(p_project, 'work_session.resumed', jsonb_build_object('session_id', v_open.id));
    return v_open.id;
  end if;

  insert into public.work_sessions (project_id, editor_id) values (p_project, auth.uid()) returning id into v_id;
  insert into public.work_session_intervals (session_id, editor_id) values (v_id, auth.uid());
  perform private.log(p_project, 'work_session.started', jsonb_build_object('session_id', v_id));
  return v_id;
end;
$$;

create or replace function public.pause_work_session(p_session uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.work_sessions;
begin
  perform private.require_role(array['editor']::public.app_role[]);
  perform 1 from public.profiles where id = auth.uid() for update;
  perform private.close_stale_sessions(auth.uid());
  select * into s from public.work_sessions where id = p_session and editor_id = auth.uid() for update;
  if not found then
    raise exception 'Work session not found.' using errcode = 'P0002';
  end if;
  if s.status = 'paused' then
    return;
  end if;
  if s.status = 'stopped' then
    raise exception 'This session has already ended.' using errcode = '55000';
  end if;
  update public.work_session_intervals set ended_at = now(), end_reason = 'paused'
   where session_id = p_session and ended_at is null;
  update public.work_sessions set status = 'paused' where id = p_session;
  perform private.log(s.project_id, 'work_session.paused', jsonb_build_object('session_id', p_session));
end;
$$;

create or replace function public.resume_work_session(p_session uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
  v_status public.session_status;
begin
  perform private.require_role(array['editor']::public.app_role[]);
  select project_id, status into v_project, v_status
    from public.work_sessions where id = p_session and editor_id = auth.uid();
  if v_project is null then
    raise exception 'Work session not found.' using errcode = 'P0002';
  end if;
  if v_status = 'stopped' then
    raise exception 'This session has already ended. Start a new one.' using errcode = '55000';
  end if;
  -- start_work_session resumes the paused session of this project (idempotent if running).
  perform public.start_work_session(v_project);
end;
$$;

create or replace function public.stop_work_session(p_session uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.work_sessions;
begin
  perform private.require_role(array['editor']::public.app_role[]);
  perform 1 from public.profiles where id = auth.uid() for update;
  perform private.close_stale_sessions(auth.uid());
  select * into s from public.work_sessions where id = p_session and editor_id = auth.uid() for update;
  if not found then
    raise exception 'Work session not found.' using errcode = 'P0002';
  end if;
  if s.status = 'stopped' then
    return;
  end if;
  update public.work_session_intervals set ended_at = now(), end_reason = 'stopped'
   where session_id = p_session and ended_at is null;
  update public.work_sessions set status = 'stopped', ended_at = now(), end_reason = 'stopped' where id = p_session;
  perform private.log(s.project_id, 'work_session.stopped', jsonb_build_object('session_id', p_session));
end;
$$;

-- Called by the open timer every ~60s. Returns the session status after the
-- check, so the UI learns immediately if it was auto-paused.
create or replace function public.heartbeat_work_session(p_session uuid)
returns public.session_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.session_status;
begin
  perform private.require_role(array['editor']::public.app_role[]);
  perform private.close_stale_sessions(auth.uid());
  update public.work_sessions set last_heartbeat_at = now()
   where id = p_session and editor_id = auth.uid() and status = 'active'
  returning status into v_status;
  if v_status is null then
    select status into v_status from public.work_sessions where id = p_session and editor_id = auth.uid();
  end if;
  return v_status;
end;
$$;

-- =============================================================================
-- Submissions and review
-- =============================================================================

create or replace function public.submit_work(p_project uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
  v_id uuid;
  v_seq integer;
  v_url text := private.clean_text(p_data, 'drive_url');
begin
  perform private.require_role(array['editor']::public.app_role[]);
  perform 1 from public.profiles where id = auth.uid() for update;
  v := private.lock_project(p_project);
  if v.assigned_editor_id is distinct from auth.uid() then
    raise exception 'Only the assigned editor can submit work.' using errcode = '42501';
  end if;
  perform private.require_status(v, array['in_progress', 'revision_requested']::public.project_status[], 'submit work');

  if v_url !~* '^https://(drive|docs)\.google\.com/.*(/d/|/folders/|[?&]id=)[A-Za-z0-9_-]{10,}' then
    raise exception 'Enter a valid Google Drive file or folder link.' using errcode = '22023';
  end if;
  if coalesce((p_data ->> 'access_confirmed')::boolean, false) is not true then
    raise exception 'Confirm that the Dispatcher can open the Drive link.' using errcode = '22023';
  end if;

  select coalesce(max(sequence), 0) + 1 into v_seq from public.submissions where project_id = p_project;

  insert into public.submissions (
    project_id, editor_id, sequence, version_label, drive_url, file_name, export_resolution, aspect_ratio,
    frame_rate, export_format, work_summary, completed_requirements, deviations, notes, access_confirmed, brief_version
  ) values (
    p_project, auth.uid(), v_seq,
    coalesce(nullif(private.clean_text(p_data, 'version_label'), ''), 'v' || v_seq),
    v_url,
    private.clean_text(p_data, 'file_name'),
    private.clean_text(p_data, 'export_resolution'),
    private.clean_text(p_data, 'aspect_ratio'),
    private.clean_text(p_data, 'frame_rate'),
    private.clean_text(p_data, 'export_format'),
    private.clean_text(p_data, 'work_summary'),
    private.clean_text(p_data, 'completed_requirements'),
    private.clean_text(p_data, 'deviations'),
    private.clean_text(p_data, 'notes'),
    true,
    v.current_brief_version
  ) returning id into v_id;

  -- Submission ends the active work session.
  perform private.stop_project_sessions(p_project, auth.uid(), 'submitted');

  update public.revision_requests
     set resolved_by_submission_id = v_id, resolved_at = now()
   where project_id = p_project and resolved_at is null;

  perform private.set_status(p_project, 'submitted');
  perform private.log(p_project, 'submission.created', jsonb_build_object('submission_id', v_id, 'sequence', v_seq));
  perform private.notify_role(array['owner', 'dispatcher']::public.app_role[], p_project, 'work_submitted',
    'Work submitted (' || coalesce(nullif(private.clean_text(p_data, 'version_label'), ''), 'v' || v_seq) || '): ' || v.title,
    'Open the Drive link and review against the brief.');
  return v_id;
end;
$$;

create or replace function public.begin_submission_review(p_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  v := private.lock_project(p_project);
  if v.status = 'dispatcher_review' then
    return;
  end if;
  perform private.require_status(v, array['submitted']::public.project_status[], 'start the review');
  update public.submissions
     set status = 'under_review', review_started_at = now(), review_started_by = auth.uid()
   where project_id = p_project and status = 'submitted';
  perform private.set_status(p_project, 'dispatcher_review');
  perform private.log(p_project, 'review.started', '{}'::jsonb);
end;
$$;

create or replace function public.review_submission(
  p_submission uuid, p_decision public.submission_decision, p_notes text default '', p_reason text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.submissions;
  v public.projects;
  v_review uuid;
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  select * into s from public.submissions where id = p_submission;
  if not found then
    raise exception 'Submission not found.' using errcode = 'P0002';
  end if;
  v := private.lock_project(s.project_id);
  select * into s from public.submissions where id = p_submission for update;

  perform private.require_status(v, array['submitted', 'dispatcher_review']::public.project_status[], 'review this submission');
  if s.status not in ('submitted', 'under_review') then
    raise exception 'This submission has already been reviewed.' using errcode = '55000';
  end if;
  if s.sequence <> (select max(sequence) from public.submissions where project_id = s.project_id) then
    raise exception 'Only the latest submission can be reviewed.' using errcode = '55000';
  end if;

  if p_decision = 'approved' then
    insert into public.submission_reviews (submission_id, project_id, reviewer_id, decision, notes)
    values (p_submission, s.project_id, auth.uid(), 'approved', btrim(coalesce(p_notes, '')));
    update public.submissions set status = 'approved' where id = p_submission;
    update public.projects set completed_at = now() where id = s.project_id;
    perform private.set_status(s.project_id, 'completed');
    update public.project_assignments set ended_at = now(), ended_by = auth.uid(), end_reason = 'completed'
     where project_id = s.project_id and ended_at is null;
    perform private.log(s.project_id, 'submission.approved', jsonb_build_object('submission_id', p_submission, 'sequence', s.sequence));
    perform private.notify(s.editor_id, s.project_id, 'project_approved', 'Approved: ' || v.title,
      coalesce(nullif(btrim(p_notes), ''), 'Your submission was approved. Great work.'));
  else
    if char_length(btrim(coalesce(p_reason, ''))) < 5 then
      raise exception 'A reason is required when requesting a revision (at least 5 characters).' using errcode = '22023';
    end if;
    insert into public.submission_reviews (submission_id, project_id, reviewer_id, decision, notes)
    values (p_submission, s.project_id, auth.uid(), 'revision_requested', btrim(coalesce(p_notes, '')))
    returning id into v_review;
    insert into public.revision_requests (project_id, submission_id, review_id, requested_by, reason, notes)
    values (s.project_id, p_submission, v_review, auth.uid(), btrim(p_reason), btrim(coalesce(p_notes, '')));
    update public.submissions set status = 'revision_requested' where id = p_submission;
    perform private.set_status(s.project_id, 'revision_requested');
    perform private.log(s.project_id, 'submission.revision_requested',
      jsonb_build_object('submission_id', p_submission, 'sequence', s.sequence, 'reason', btrim(p_reason)));
    perform private.notify(s.editor_id, s.project_id, 'revision_requested', 'Revision requested: ' || v.title, left(btrim(p_reason), 300));
  end if;
end;
$$;

-- =============================================================================
-- Hold / cancel / archive / delete
-- =============================================================================

create or replace function public.put_project_on_hold(p_project uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  v := private.lock_project(p_project);
  if v.status in ('draft', 'completed', 'cancelled', 'on_hold') then
    raise exception 'Cannot put a % project on hold.', replace(v.status::text, '_', ' ') using errcode = '55000';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason for putting the project on hold.' using errcode = '22023';
  end if;
  perform private.stop_project_sessions(p_project, null, 'project_on_hold');
  update public.projects set hold_previous_status = status, status = 'on_hold', status_changed_at = now() where id = p_project;
  perform private.log(p_project, 'project.on_hold', jsonb_build_object('reason', btrim(p_reason), 'previous_status', v.status));
  perform private.notify(v.assigned_editor_id, p_project, 'project_status_changed', 'Project on hold: ' || v.title, btrim(p_reason));
end;
$$;

create or replace function public.resume_project(p_project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  v := private.lock_project(p_project);
  perform private.require_status(v, array['on_hold']::public.project_status[], 'resume');
  update public.projects set status = hold_previous_status, hold_previous_status = null, status_changed_at = now() where id = p_project;
  perform private.log(p_project, 'project.resumed', jsonb_build_object('status', v.hold_previous_status));
  perform private.notify(v.assigned_editor_id, p_project, 'project_status_changed', 'Project resumed: ' || v.title, '');
end;
$$;

create or replace function public.cancel_project(p_project uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  v := private.lock_project(p_project);
  if v.status in ('completed', 'cancelled') then
    raise exception 'This project is already closed.' using errcode = '55000';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason for cancelling the project.' using errcode = '22023';
  end if;
  perform private.stop_project_sessions(p_project, null, 'project_cancelled');
  update public.project_assignments set ended_at = now(), ended_by = auth.uid(), end_reason = 'cancelled'
   where project_id = p_project and ended_at is null;
  update public.projects
     set status = 'cancelled', hold_previous_status = null, cancelled_at = now(), status_changed_at = now()
   where id = p_project;
  perform private.log(p_project, 'project.cancelled', jsonb_build_object('reason', btrim(p_reason), 'previous_status', v.status));
  perform private.notify(v.assigned_editor_id, p_project, 'project_status_changed', 'Project cancelled: ' || v.title, btrim(p_reason));
end;
$$;

create or replace function public.set_project_archived(p_project uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
begin
  perform private.require_role(array['owner', 'dispatcher']::public.app_role[]);
  v := private.lock_project(p_project);
  if p_archived then
    perform private.require_status(v, array['completed', 'cancelled']::public.project_status[], 'archive');
    update public.projects set archived_at = now() where id = p_project;
    perform private.log(p_project, 'project.archived', '{}'::jsonb);
  else
    update public.projects set archived_at = null where id = p_project;
    perform private.log(p_project, 'project.unarchived', '{}'::jsonb);
  end if;
end;
$$;

-- Owners may permanently delete DRAFT projects only (they have no production
-- history). Published projects are cancelled and archived instead, so their
-- history is retained. Returns the storage paths to remove.
create or replace function public.delete_draft_project(p_project uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.projects;
  v_paths text[];
begin
  perform private.require_role(array['owner']::public.app_role[]);
  v := private.lock_project(p_project);
  if v.status <> 'draft' then
    raise exception 'Only draft projects can be deleted. Cancel and archive published projects instead.' using errcode = '55000';
  end if;
  select coalesce(array_agg(storage_path), '{}') into v_paths from public.project_files where project_id = p_project;
  delete from public.project_assets where project_id = p_project;
  delete from public.project_files where project_id = p_project;
  delete from public.projects where id = p_project;
  perform private.log(null, 'project.deleted', jsonb_build_object('title', v.title, 'internal_ref', v.internal_ref));
  return v_paths;
end;
$$;

-- =============================================================================
-- Notifications, profile, team, settings
-- =============================================================================

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
     set read_at = now()
   where recipient_id = auth.uid()
     and read_at is null
     and (p_ids is null or id = any (p_ids));
$$;

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
    'session_auto_paused', 'role_changed'
  ]
$$;

create or replace function public.update_my_profile(p_full_name text, p_timezone text, p_prefs jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
begin
  perform private.require_role(array['owner', 'dispatcher', 'editor']::public.app_role[]);
  if char_length(btrim(coalesce(p_full_name, ''))) not between 2 and 120 then
    raise exception 'Name must be between 2 and 120 characters.' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown time zone.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_prefs, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid notification preferences.' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(coalesce(p_prefs, '{}'::jsonb)) loop
    if not (k = any (public.notification_types())) or jsonb_typeof(p_prefs -> k) <> 'boolean' then
      raise exception 'Invalid notification preference: %', k using errcode = '22023';
    end if;
  end loop;
  update public.profiles
     set full_name = btrim(p_full_name), timezone = p_timezone, notification_prefs = coalesce(p_prefs, '{}'::jsonb)
   where id = auth.uid();
end;
$$;

create or replace function public.create_invitation(p_email text, p_role public.app_role, p_full_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  perform private.require_role(array['owner']::public.app_role[]);
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where email = v_email) then
    raise exception 'This person is already a member of the workspace.' using errcode = '22023';
  end if;
  update public.invitations set status = 'revoked', revoked_at = now() where email = v_email and status = 'pending';
  insert into public.invitations (email, role, full_name, invited_by)
  values (v_email, p_role, nullif(btrim(coalesce(p_full_name, '')), ''), auth.uid())
  returning id into v_id;
  perform private.log(null, 'member.invited', jsonb_build_object('email', v_email, 'role', p_role));
  return v_id;
end;
$$;

create or replace function public.revoke_invitation(p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  perform private.require_role(array['owner']::public.app_role[]);
  update public.invitations set status = 'revoked', revoked_at = now()
   where id = p_invitation and status = 'pending'
  returning email into v_email;
  if v_email is null then
    raise exception 'Invitation not found or no longer pending.' using errcode = 'P0002';
  end if;
  perform private.log(null, 'member.invitation_revoked', jsonb_build_object('email', v_email));
end;
$$;

create or replace function public.set_member_role(p_user uuid, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles;
begin
  perform private.require_role(array['owner']::public.app_role[]);
  if p_user = auth.uid() then
    raise exception 'You cannot change your own role.' using errcode = '42501';
  end if;
  -- Lock all owners to make the last-owner check race-free.
  perform 1 from public.profiles where role = 'owner' for update;
  select * into v from public.profiles where id = p_user for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;
  if v.role = p_role then
    return;
  end if;
  if v.role = 'owner' and (select count(*) from public.profiles where role = 'owner' and is_active and id <> p_user) = 0 then
    raise exception 'The workspace must keep at least one active owner.' using errcode = '55000';
  end if;
  if v.role = 'editor' and exists (
    select 1 from public.projects where assigned_editor_id = p_user and status not in ('completed', 'cancelled')
  ) then
    raise exception 'Reassign this editor''s active projects before changing their role.' using errcode = '55000';
  end if;
  if v.role = 'editor' then
    update public.work_session_intervals set ended_at = now(), end_reason = 'role_changed'
     where editor_id = p_user and ended_at is null;
    update public.work_sessions set status = 'stopped', ended_at = now(), end_reason = 'role_changed'
     where editor_id = p_user and status <> 'stopped';
  end if;
  update public.profiles set role = p_role where id = p_user;
  perform private.log(null, 'member.role_changed', jsonb_build_object('user_id', p_user, 'from', v.role, 'to', p_role));
  perform private.notify(p_user, null, 'role_changed', 'Your role is now ' || p_role::text, '');
end;
$$;

create or replace function public.set_member_active(p_user uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles;
begin
  perform private.require_role(array['owner']::public.app_role[]);
  if p_user = auth.uid() then
    raise exception 'You cannot disable your own account.' using errcode = '42501';
  end if;
  perform 1 from public.profiles where role = 'owner' for update;
  select * into v from public.profiles where id = p_user for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;
  if v.is_active = p_active then
    return;
  end if;
  if not p_active and v.role = 'owner'
     and (select count(*) from public.profiles where role = 'owner' and is_active and id <> p_user) = 0 then
    raise exception 'The workspace must keep at least one active owner.' using errcode = '55000';
  end if;
  if not p_active then
    update public.work_session_intervals set ended_at = now(), end_reason = 'account_disabled'
     where editor_id = p_user and ended_at is null;
    update public.work_sessions set status = 'stopped', ended_at = now(), end_reason = 'account_disabled'
     where editor_id = p_user and status <> 'stopped';
  end if;
  update public.profiles
     set is_active = p_active, deactivated_at = case when p_active then null else now() end
   where id = p_user;
  perform private.log(null, case when p_active then 'member.enabled' else 'member.disabled' end,
    jsonb_build_object('user_id', p_user, 'email', v.email));
end;
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
    updated_by = auth.uid()
  where id = 1;
  perform private.log(null, 'workspace.settings_updated', jsonb_build_object('keys', (select jsonb_agg(k) from jsonb_object_keys(p_data) k)));
exception
  when check_violation then
    raise exception 'One of the settings is out of range.' using errcode = '22023';
end;
$$;

-- =============================================================================
-- Maintenance: deadline reminders + stale timer cleanup.
-- Idempotent. Run every 5 minutes with pg_cron (see docs) and also invoked
-- opportunistically by the dashboard.
-- =============================================================================
create or replace function public.run_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours integer;
  v_stale integer;
  v_deadlines integer := 0;
  r record;
begin
  if auth.uid() is not null then
    perform private.require_role(array['owner', 'dispatcher', 'editor']::public.app_role[]);
  end if;

  v_stale := private.close_stale_sessions(null);

  select deadline_warning_hours into v_hours from public.workspace_settings where id = 1;
  for r in
    select id, title, deadline, assigned_editor_id
      from public.projects
     where deadline is not null
       and deadline_notified_at is null
       and status not in ('draft', 'completed', 'cancelled', 'on_hold')
       and deadline <= now() + make_interval(hours => v_hours)
     for update skip locked
  loop
    update public.projects set deadline_notified_at = now() where id = r.id;
    insert into public.notifications (recipient_id, project_id, type, title, body)
    select p.id, r.id, 'deadline_approaching',
           case when r.deadline < now() then 'Deadline passed: ' else 'Deadline approaching: ' end || r.title,
           'Deadline: ' || to_char(r.deadline at time zone p.timezone, 'Dy DD Mon HH24:MI') || ' (' || p.timezone || ')'
      from public.profiles p
     where p.is_active
       and (p.id = r.assigned_editor_id or p.role in ('owner', 'dispatcher'))
       and coalesce((p.notification_prefs ->> 'deadline_approaching')::boolean, true);
    v_deadlines := v_deadlines + 1;
  end loop;

  return jsonb_build_object('stale_sessions_closed', v_stale, 'deadline_reminders', v_deadlines);
end;
$$;

-- =============================================================================
-- Grants: only the public API functions are callable by signed-in users.
-- =============================================================================
do $$
declare
  f text;
begin
  foreach f in array array[
    'create_project(jsonb, boolean)',
    'publish_project(uuid)',
    'update_project(uuid, jsonb)',
    'update_project_brief(uuid, text, text, text, text)',
    'add_project_asset(uuid, public.asset_kind, text, text, text)',
    'add_project_file_asset(uuid, public.asset_kind, text, text, text, text)',
    'remove_project_asset(uuid)',
    'claim_project(uuid)',
    'assign_editor(uuid, uuid, text)',
    'unassign_editor(uuid, text)',
    'submit_editor_response(uuid, jsonb, jsonb)',
    'review_editor_response(uuid, text, text)',
    'submit_storyboard(uuid, text, text, jsonb)',
    'review_storyboard(uuid, public.storyboard_decision, text)',
    'start_work_session(uuid)',
    'pause_work_session(uuid)',
    'resume_work_session(uuid)',
    'stop_work_session(uuid)',
    'heartbeat_work_session(uuid)',
    'submit_work(uuid, jsonb)',
    'begin_submission_review(uuid)',
    'review_submission(uuid, public.submission_decision, text, text)',
    'put_project_on_hold(uuid, text)',
    'resume_project(uuid)',
    'cancel_project(uuid, text)',
    'set_project_archived(uuid, boolean)',
    'delete_draft_project(uuid)',
    'mark_notifications_read(uuid[])',
    'notification_types()',
    'update_my_profile(text, text, jsonb)',
    'create_invitation(text, public.app_role, text)',
    'revoke_invitation(uuid)',
    'set_member_role(uuid, public.app_role)',
    'set_member_active(uuid, boolean)',
    'update_workspace_settings(jsonb)',
    'run_maintenance()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$$;

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
