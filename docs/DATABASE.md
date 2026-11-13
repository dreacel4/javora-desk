# Database Architecture

PostgreSQL (Supabase). Source of truth: `supabase/migrations/`. Tests: `supabase/tests/`.

## Design principles

1. **The database enforces the rules.** Every workflow transition is a `SECURITY DEFINER` function that reads the
   caller's role from `profiles` (never from client input), locks the affected rows, validates the transition and
   writes data + activity + notifications in one transaction. The Next.js server actions are thin wrappers.
2. **Deny by default.** RLS is enabled on every table. Signed-in users get `SELECT` only, filtered by policies.
   There are **no** insert/update/delete policies — direct writes through the API fail with `permission denied`.
   `anon` has no privileges at all.
3. **History is append-only.** Briefs are versioned, assignments/responses/storyboards/submissions/reviews are never
   overwritten, assets are soft-removed, and important history uses `ON DELETE RESTRICT`. Only *draft* projects (which
   have no history) can be deleted, by an Owner.
4. **Time comes from the database.** Timer state is stored as intervals with server timestamps; the browser only displays it.

## Roles

| Role | Capabilities (enforced in SQL) |
|---|---|
| `owner` | Everything a dispatcher can do + invitations, roles, enable/disable accounts, workspace settings, delete drafts |
| `dispatcher` | Create/edit/publish projects, version briefs, manage materials, assign/reassign, approve understanding & storyboards, review submissions, hold/cancel/archive |
| `editor` | See available projects + projects they were ever assigned to; claim; submit understanding, storyboards, work; track time on their own assignment |

A disabled account (`profiles.is_active = false`) resolves to *no role*: every RLS policy and function denies it
immediately, even before its JWT expires.

## Tables

| Table | Purpose | Notes |
|---|---|---|
| `profiles` | One row per auth user: name, role, active flag, time zone, notification preferences, last sign-in | Created by trigger from an invitation |
| `invitations` | Owner-issued invites with the intended role | Consumed by `on_auth_user_created`; uninvited sign-ups are rejected |
| `workspace_settings` | Singleton: workspace name, defaults, reminder window, stale-timer threshold, claim limit | |
| `projects` | Core project record + current status + denormalised current editor | Status changes only via functions |
| `project_briefs` | Versioned brief (`version` 1 = original client brief) | Editable in place only while draft |
| `project_assets` | Raw materials and references (URL **or** uploaded file) | Soft-removed (`removed_at`) |
| `project_files` | Metadata for files in the private bucket | Linked to a response, storyboard or material |
| `project_assignments` | Every claim/assignment with start/end and reason | ≤ 1 open row per project (unique partial index) |
| `editor_responses` | Editor's understanding (7 questions), versioned, with review decision | ≤ 1 pending per project |
| `storyboards` / `storyboard_reviews` | Versioned storyboards and every approve/changes/comment decision | ≤ 1 pending per project |
| `work_sessions` / `work_session_intervals` | Timer sessions and their active intervals | ≤ 1 running session per editor, ≤ 1 open session per editor per project, ≤ 1 open interval per editor |
| `submissions` | Every delivery (Drive URL, specs, summary, deviations) | Sequenced per project; never overwritten |
| `submission_reviews` / `revision_requests` | Review decisions; revisions require a reason and record which later delivery resolved them | |
| `project_activity` | Append-only audit log of every action | Realtime-enabled |
| `notifications` | In-app notifications per recipient | Realtime-enabled; respects preferences |
| `ai_reports` / `ai_findings` | **Future AI QC** (schema only) | See below |

Read models: view `work_session_summaries` (security-invoker, computes active seconds), functions
`dashboard_stats()` (security-invoker) and `team_metrics()` (managers only).

## Project state machine

```
draft ──publish──▶ available ──claim / assign──▶ claimed ──submit understanding──▶ awaiting_confirmation
                        ▲                          ▲   ▲                                │
                        │ unassign                 │   └──── clarification requested ───┤
                        │                          │                                    │ approve
                        │                    reassign (any production stage)            ▼
                        │                                        storyboard required? ──yes──▶ awaiting_storyboard_approval
                        │                                                │ no                    │ approve (changes requested stays here)
                        │                                                ▼                       ▼
                        │                                          ready_to_start ◀──────────────┘
                        │                                                │ start timer
                        │                                                ▼
                        │       revision_requested ──start timer──▶ in_progress ──submit──▶ submitted ──start review──▶ dispatcher_review
                        │                ▲                                                       │                            │
                        │                └──────────────── request revision (reason required) ──┴────────────────────────────┤
                        │                                                                                                     │ approve
                        │                                                                                                     ▼
   on_hold ◀── any open status (resume returns to the previous status)                                                   completed
   cancelled ◀── any non-closed status (reason required)                                  completed / cancelled ──▶ archived (flag)
```

Rules enforced in SQL:
- Claiming is an atomic compare-and-set (`UPDATE … WHERE status = 'available'`); concurrent claims cannot both win.
  Claims are also serialised per editor so the per-editor active-project limit cannot be raced.
- Production cannot start before the understanding is approved, nor before a required storyboard is approved.
- A timer can only run while the project is `in_progress` (starting it from `ready_to_start`/`revision_requested`
  performs that transition atomically).
- Submitting work stops the editor's session; hold, cancel, reassign, role change and disabling also stop sessions.
- Only the current editor can submit understanding/storyboards/work; only managers can review; editors can never
  approve anything.
- The storyboard requirement cannot be toggled after the understanding is approved.

## Timer model

```
work_sessions (status active|paused|stopped, last_heartbeat_at)
   └── work_session_intervals (started_at, ended_at)  — active time = Σ(ended_at − started_at)
```

- *Start/Resume* opens an interval; *Pause* closes it; *Stop* closes it and ends the session.
- Per-editor row locks + unique partial indexes make multiple tabs/devices safe: a second "Start" returns the running
  session instead of creating another.
- The open browser sends a heartbeat every 60 s. If heartbeats stop for longer than
  `workspace_settings.stale_session_minutes` (default 10), the session is auto-paused **at the last heartbeat**
  (on the editor's next action, on `run_maintenance()`, or by pg_cron). Read models already cap open intervals at
  `last_heartbeat + threshold`, so a closed laptop never inflates totals.

## Storage

Private bucket `project-files` (50 MB/file, document & image MIME types). Object path:
`<project_id>/<materials|understanding|storyboards>/<uuid>-<filename>`.

- Upload: managers → `materials`; the current assigned editor → `understanding`, `storyboards`.
- Read: managers; the uploader; anyone who can view the project → `materials`; the current editor → `storyboards`.
- Delete: only files not yet registered in `project_files` (cleans up abandoned uploads).
- Registration functions verify the object exists, was uploaded by the caller, sits in the right folder, and take the
  MIME type/size from Storage metadata — not from the client.
- Files are opened through `/api/files`, which creates a 5-minute signed URL **with the user's own session**, so
  Storage RLS decides access.

## Future AI Quality Control (not implemented)

`ai_reports` ties one QC run to the exact inputs it compared: `brief_id` (brief version), `editor_response_id`,
`storyboard_id` (approved storyboard) and `submission_id` (final video). `ai_findings` stores each finding with:

| Column | Meaning |
|---|---|
| `category` | brief_compliance, visual_sequence, subtitle_accuracy, voice_over_alignment, audio_quality, technical_export, missing_visual_element, reference_match, other |
| `nature` | `objective` (verifiable failure, e.g. wrong frame rate) vs `subjective` (creative judgment) |
| `severity` | info / minor / major / critical |
| `video_timestamp_ms`, `evidence` (JSON), `confidence` (0–1) | Where, why, how sure |
| `verification_status`, `verified_by`, `verified_at` | Manual confirmation by a dispatcher |

Both tables are readable by managers only and have no write path for users; a future worker would write with the
service role. Submissions already store `brief_version`, so a report can always be tied to the brief the editor saw.

## Function reference (callable by signed-in users)

Projects: `create_project`, `update_project`, `update_project_brief`, `publish_project`, `add_project_asset`,
`add_project_file_asset`, `remove_project_asset`, `claim_project`, `assign_editor`, `unassign_editor`,
`put_project_on_hold`, `resume_project`, `cancel_project`, `set_project_archived`, `delete_draft_project`.
Workflow: `submit_editor_response`, `review_editor_response`, `submit_storyboard`, `review_storyboard`,
`submit_work`, `begin_submission_review`, `review_submission`.
Timer: `start_work_session`, `pause_work_session`, `resume_work_session`, `stop_work_session`, `heartbeat_work_session`.
Team & settings: `create_invitation`, `revoke_invitation`, `set_member_role`, `set_member_active`,
`update_my_profile`, `update_workspace_settings`, `mark_notifications_read`.
Read/maintenance: `dashboard_stats`, `team_metrics`, `run_maintenance`.

Errors use SQLSTATE codes the UI shows verbatim: `42501` not allowed, `P0002` not found, `22023` invalid input,
`55000` wrong state, `23505` duplicate. Anything else is logged server-side and shown as a generic message.
