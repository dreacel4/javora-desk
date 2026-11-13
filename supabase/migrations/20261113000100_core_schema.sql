-- =============================================================================
-- JAVORA DESK — 0100 Core schema
-- Tables, enums, constraints, indexes and timestamp triggers.
-- All writes from application users go through SECURITY DEFINER functions
-- (see 0300_workflow_functions.sql). Tables are protected by RLS (0200).
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('owner', 'dispatcher', 'editor');

create type public.project_status as enum (
  'draft',
  'available',
  'claimed',
  'awaiting_confirmation',
  'awaiting_storyboard_approval',
  'ready_to_start',
  'in_progress',
  'submitted',
  'dispatcher_review',
  'revision_requested',
  'completed',
  'on_hold',
  'cancelled'
);

create type public.project_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.asset_kind as enum ('raw_material', 'reference');
create type public.assignment_method as enum ('claimed', 'assigned');
create type public.response_status as enum ('pending', 'approved', 'clarification_requested', 'superseded');
create type public.storyboard_status as enum ('pending', 'approved', 'changes_requested', 'superseded');
create type public.storyboard_decision as enum ('approved', 'changes_requested', 'comment');
create type public.session_status as enum ('active', 'paused', 'stopped');
create type public.submission_status as enum ('submitted', 'under_review', 'approved', 'revision_requested');
create type public.submission_decision as enum ('approved', 'revision_requested');
create type public.file_purpose as enum ('understanding_attachment', 'storyboard', 'material');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked');

-- Future AI QC (not used by the application in this release)
create type public.ai_report_status as enum ('queued', 'running', 'completed', 'failed');
create type public.ai_finding_severity as enum ('info', 'minor', 'major', 'critical');
create type public.ai_finding_nature as enum ('objective', 'subjective');
create type public.ai_verification_status as enum ('unverified', 'confirmed', 'dismissed');

-- -----------------------------------------------------------------------------
-- Shared trigger: updated_at
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Workspace settings (singleton row, id = 1)
-- -----------------------------------------------------------------------------
create table public.workspace_settings (
  id smallint primary key default 1 check (id = 1),
  workspace_name text not null default 'Javora' check (char_length(workspace_name) between 1 and 80),
  timezone text not null default 'Asia/Jakarta',
  default_priority public.project_priority not null default 'normal',
  default_client_platform text not null default 'Fiverr',
  default_resolution text not null default '1920x1080',
  default_aspect_ratio text not null default '16:9',
  default_frame_rate text not null default '30',
  default_delivery_format text not null default 'MP4 (H.264)',
  default_storyboard_required boolean not null default true,
  deadline_warning_hours integer not null default 24 check (deadline_warning_hours between 1 and 168),
  stale_session_minutes integer not null default 10 check (stale_session_minutes between 3 and 120),
  max_active_projects_per_editor integer not null default 3 check (max_active_projects_per_editor between 0 and 50),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.workspace_settings (id) values (1);

create trigger workspace_settings_updated_at before update on public.workspace_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Invitations (owner-controlled, consumed when the auth user is created)
-- -----------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.app_role not null,
  full_name text check (full_name is null or char_length(full_name) <= 120),
  status public.invitation_status not null default 'pending',
  invited_by uuid,            -- null only for the documented first-owner bootstrap
  accepted_user_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  revoked_at timestamptz
);
create unique index invitations_one_pending_per_email on public.invitations (email) where status = 'pending';

-- -----------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  email text not null unique,
  full_name text not null default '' check (char_length(full_name) <= 120),
  role public.app_role not null default 'editor',
  is_active boolean not null default true,
  timezone text not null default 'Asia/Jakarta',
  notification_prefs jsonb not null default '{}'::jsonb check (jsonb_typeof(notification_prefs) = 'object'),
  invited_by uuid references public.profiles (id) on delete set null,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_role_active_idx on public.profiles (role) where is_active;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.invitations
  add constraint invitations_invited_by_fkey foreign key (invited_by) references public.profiles (id) on delete set null,
  add constraint invitations_accepted_user_fkey foreign key (accepted_user_id) references public.profiles (id) on delete set null;
alter table public.workspace_settings
  add constraint workspace_settings_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete set null;

-- -----------------------------------------------------------------------------
-- Projects
-- -----------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  internal_ref text not null unique check (internal_ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$'),
  title text not null check (char_length(title) between 3 and 160),
  client_name text not null check (char_length(client_name) between 1 and 120),
  client_platform text not null default 'Fiverr' check (char_length(client_platform) between 1 and 60),
  description text not null default '' check (char_length(description) <= 4000),
  output_resolution text not null default '' check (char_length(output_resolution) <= 40),
  aspect_ratio text not null default '' check (char_length(aspect_ratio) <= 20),
  frame_rate text not null default '' check (char_length(frame_rate) <= 20),
  required_duration text not null default '' check (char_length(required_duration) <= 60),
  delivery_format text not null default '' check (char_length(delivery_format) <= 80),
  priority public.project_priority not null default 'normal',
  deadline timestamptz,
  storyboard_required boolean not null default true,
  status public.project_status not null default 'draft',
  hold_previous_status public.project_status,
  assigned_editor_id uuid references public.profiles (id) on delete restrict,
  planned_editor_id uuid references public.profiles (id) on delete set null, -- pre-assignment chosen while drafting
  current_brief_version integer not null default 1,
  created_by uuid not null references public.profiles (id) on delete restrict,
  published_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  archived_at timestamptz,
  deadline_notified_at timestamptz,
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_hold_state check ((status = 'on_hold') = (hold_previous_status is not null)),
  constraint projects_archive_terminal check (archived_at is null or status in ('completed', 'cancelled')),
  constraint projects_editor_required check (
    status in ('draft', 'available', 'cancelled', 'on_hold', 'completed') or assigned_editor_id is not null
  ),
  constraint projects_available_unassigned check (status <> 'available' or assigned_editor_id is null)
);
create index projects_status_idx on public.projects (status) where archived_at is null;
create index projects_assigned_editor_idx on public.projects (assigned_editor_id) where assigned_editor_id is not null;
create index projects_deadline_idx on public.projects (deadline) where status not in ('completed', 'cancelled', 'draft');
create index projects_created_at_idx on public.projects (created_at desc);
create index projects_created_by_idx on public.projects (created_by);

create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- Brief versions: append-only once published. Version 1 is the original client brief.
create table public.project_briefs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  version integer not null check (version >= 1),
  original_client_brief text not null check (char_length(original_client_brief) between 1 and 20000),
  editing_requirements text not null default '' check (char_length(editing_requirements) <= 20000),
  additional_instructions text not null default '' check (char_length(additional_instructions) <= 20000),
  change_note text not null default '' check (char_length(change_note) <= 2000),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, version)
);
create trigger project_briefs_updated_at before update on public.project_briefs
  for each row execute function public.set_updated_at();

-- Materials & references (links or uploaded files). Soft-removed, never hard-deleted.
create table public.project_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind public.asset_kind not null,
  label text not null check (char_length(label) between 1 and 160),
  url text check (url is null or (url ~* '^https?://' and char_length(url) <= 2048)),
  storage_path text check (storage_path is null or char_length(storage_path) <= 512),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id) on delete set null,
  constraint project_assets_has_target check ((url is not null) <> (storage_path is not null))
);
create index project_assets_project_idx on public.project_assets (project_id, kind) where removed_at is null;

-- Assignment history. Exactly one open assignment per project at most.
create table public.project_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  editor_id uuid not null references public.profiles (id) on delete restrict,
  method public.assignment_method not null,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  end_reason text check (end_reason is null or char_length(end_reason) <= 1000)
);
create unique index project_assignments_one_open on public.project_assignments (project_id) where ended_at is null;
create index project_assignments_editor_idx on public.project_assignments (editor_id, project_id);

-- -----------------------------------------------------------------------------
-- Editor understanding (confirmation before production)
-- -----------------------------------------------------------------------------
create table public.editor_responses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  editor_id uuid not null references public.profiles (id) on delete restrict,
  version integer not null check (version >= 1),
  brief_version integer not null,
  materials_description text not null check (char_length(materials_description) between 10 and 8000),
  requirements_understanding text not null check (char_length(requirements_understanding) between 10 and 8000),
  editing_approach text not null check (char_length(editing_approach) between 10 and 8000),
  visual_sequence text not null check (char_length(visual_sequence) between 10 and 8000),
  expected_deliverables text not null check (char_length(expected_deliverables) between 3 and 4000),
  missing_assets text not null default '' check (char_length(missing_assets) <= 4000),
  questions text not null default '' check (char_length(questions) <= 4000),
  status public.response_status not null default 'pending',
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 4000),
  unique (project_id, version)
);
create index editor_responses_project_idx on public.editor_responses (project_id, submitted_at desc);
create unique index editor_responses_one_pending on public.editor_responses (project_id) where status = 'pending';

-- -----------------------------------------------------------------------------
-- Storyboards and their reviews
-- -----------------------------------------------------------------------------
create table public.storyboards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  editor_id uuid not null references public.profiles (id) on delete restrict,
  version integer not null check (version >= 1),
  description text not null check (char_length(description) between 3 and 8000),
  sequence_notes text not null default '' check (char_length(sequence_notes) <= 8000),
  status public.storyboard_status not null default 'pending',
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  unique (project_id, version)
);
create unique index storyboards_one_pending on public.storyboards (project_id) where status = 'pending';

create table public.storyboard_reviews (
  id uuid primary key default gen_random_uuid(),
  storyboard_id uuid not null references public.storyboards (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete restrict,
  decision public.storyboard_decision not null,
  comment text not null default '' check (char_length(comment) <= 4000),
  created_at timestamptz not null default now(),
  constraint storyboard_reviews_comment_required check (decision = 'approved' or char_length(btrim(comment)) > 0)
);
create index storyboard_reviews_storyboard_idx on public.storyboard_reviews (storyboard_id, created_at);

-- Uploaded files (storage objects) linked to responses or storyboards
create table public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  purpose public.file_purpose not null,
  storage_path text not null unique check (char_length(storage_path) <= 512),
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (char_length(mime_type) <= 120),
  size_bytes bigint not null check (size_bytes >= 0),
  editor_response_id uuid references public.editor_responses (id) on delete cascade,
  storyboard_id uuid references public.storyboards (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint project_files_link check (
    (purpose = 'understanding_attachment' and editor_response_id is not null and storyboard_id is null)
    or (purpose = 'storyboard' and storyboard_id is not null and editor_response_id is null)
    or (purpose = 'material' and storyboard_id is null and editor_response_id is null)
  )
);
create index project_files_project_idx on public.project_files (project_id);

alter table public.project_assets
  add constraint project_assets_storage_path_fkey foreign key (storage_path)
  references public.project_files (storage_path) on delete restrict;

-- -----------------------------------------------------------------------------
-- Work sessions: a session contains one or more active intervals.
-- Source of truth for time is the interval timestamps, never the browser.
-- -----------------------------------------------------------------------------
create table public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  editor_id uuid not null references public.profiles (id) on delete restrict,
  status public.session_status not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_heartbeat_at timestamptz not null default now(),
  end_reason text check (end_reason is null or char_length(end_reason) <= 200),
  created_at timestamptz not null default now(),
  constraint work_sessions_end_state check ((status = 'stopped') = (ended_at is not null)),
  constraint work_sessions_order check (ended_at is null or ended_at >= started_at)
);
-- At most one running session per editor (multi-tab / multi-device safe)
create unique index work_sessions_one_active_per_editor on public.work_sessions (editor_id) where status = 'active';
-- At most one open (active or paused) session per editor per project
create unique index work_sessions_one_open_per_project on public.work_sessions (project_id, editor_id) where status <> 'stopped';
create index work_sessions_project_idx on public.work_sessions (project_id, started_at desc);
create index work_sessions_editor_idx on public.work_sessions (editor_id, started_at desc);

create table public.work_session_intervals (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.work_sessions (id) on delete restrict,
  editor_id uuid not null references public.profiles (id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason is null or char_length(end_reason) <= 200),
  constraint work_session_intervals_order check (ended_at is null or ended_at >= started_at)
);
create unique index work_session_intervals_one_open_per_editor on public.work_session_intervals (editor_id) where ended_at is null;
create index work_session_intervals_session_idx on public.work_session_intervals (session_id, started_at);

-- -----------------------------------------------------------------------------
-- Submissions, reviews and revision requests
-- -----------------------------------------------------------------------------
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  editor_id uuid not null references public.profiles (id) on delete restrict,
  sequence integer not null check (sequence >= 1),
  version_label text not null check (char_length(version_label) between 1 and 40),
  drive_url text not null check (
    drive_url ~* '^https://(drive|docs)\.google\.com/' and char_length(drive_url) <= 2048
  ),
  file_name text not null check (char_length(file_name) between 1 and 255),
  export_resolution text not null check (char_length(export_resolution) between 1 and 40),
  aspect_ratio text not null check (char_length(aspect_ratio) between 1 and 20),
  frame_rate text not null check (char_length(frame_rate) between 1 and 20),
  export_format text not null check (char_length(export_format) between 1 and 80),
  work_summary text not null check (char_length(work_summary) between 10 and 8000),
  completed_requirements text not null check (char_length(completed_requirements) between 3 and 8000),
  deviations text not null default '' check (char_length(deviations) <= 8000),
  notes text not null default '' check (char_length(notes) <= 8000),
  access_confirmed boolean not null check (access_confirmed),
  brief_version integer not null,
  status public.submission_status not null default 'submitted',
  submitted_at timestamptz not null default now(),
  review_started_at timestamptz,
  review_started_by uuid references public.profiles (id) on delete set null,
  unique (project_id, sequence)
);
create index submissions_project_idx on public.submissions (project_id, sequence desc);
create index submissions_editor_idx on public.submissions (editor_id, submitted_at desc);

create table public.submission_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete restrict,
  project_id uuid not null references public.projects (id) on delete restrict,
  reviewer_id uuid not null references public.profiles (id) on delete restrict,
  decision public.submission_decision not null,
  notes text not null default '' check (char_length(notes) <= 8000),
  created_at timestamptz not null default now()
);
create unique index submission_reviews_one_per_submission on public.submission_reviews (submission_id);

create table public.revision_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  submission_id uuid not null references public.submissions (id) on delete restrict,
  review_id uuid not null references public.submission_reviews (id) on delete restrict,
  requested_by uuid not null references public.profiles (id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 5 and 4000),
  notes text not null default '' check (char_length(notes) <= 8000),
  created_at timestamptz not null default now(),
  resolved_by_submission_id uuid references public.submissions (id) on delete set null,
  resolved_at timestamptz
);
create index revision_requests_project_idx on public.revision_requests (project_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Activity log (append-only) and notifications
-- -----------------------------------------------------------------------------
create table public.project_activity (
  id bigint generated always as identity primary key,
  project_id uuid references public.projects (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action ~ '^[a-z_.]{3,64}$'),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index project_activity_project_idx on public.project_activity (project_id, created_at desc);
create index project_activity_created_idx on public.project_activity (created_at desc);
create index project_activity_actor_idx on public.project_activity (actor_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  type text not null check (type ~ '^[a-z_]{3,64}$'),
  title text not null check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 1000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id) where read_at is null;

-- -----------------------------------------------------------------------------
-- Future AI Quality Control (schema only — no application logic in this release)
-- Compares: brief version, editor response, approved storyboard, submission.
-- -----------------------------------------------------------------------------
create table public.ai_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  submission_id uuid not null references public.submissions (id) on delete restrict,
  brief_id uuid references public.project_briefs (id) on delete set null,
  editor_response_id uuid references public.editor_responses (id) on delete set null,
  storyboard_id uuid references public.storyboards (id) on delete set null,
  status public.ai_report_status not null default 'queued',
  model text,
  summary text,
  overall_score numeric(5, 2) check (overall_score is null or overall_score between 0 and 100),
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index ai_reports_submission_idx on public.ai_reports (submission_id);

create table public.ai_findings (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.ai_reports (id) on delete cascade,
  category text not null check (category in (
    'brief_compliance', 'visual_sequence', 'subtitle_accuracy', 'voice_over_alignment',
    'audio_quality', 'technical_export', 'missing_visual_element', 'reference_match', 'other'
  )),
  nature public.ai_finding_nature not null,   -- objective failure vs subjective creative judgment
  severity public.ai_finding_severity not null,
  description text not null,
  video_timestamp_ms integer check (video_timestamp_ms is null or video_timestamp_ms >= 0),
  evidence jsonb not null default '{}'::jsonb,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  verification_status public.ai_verification_status not null default 'unverified',
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index ai_findings_report_idx on public.ai_findings (report_id);
