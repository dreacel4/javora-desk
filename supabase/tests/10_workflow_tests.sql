-- =============================================================================
-- JAVORA DESK — database test suite
-- Runs as real `authenticated` users (RLS enforced) against the migrations.
-- Every failed expectation raises and aborts the run (ON_ERROR_STOP).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- Fixed identities
\set owner_id    '''00000000-0000-0000-0000-0000000000a1'''
\set disp_id     '''00000000-0000-0000-0000-0000000000b1'''
\set e1_id       '''00000000-0000-0000-0000-0000000000c1'''
\set e2_id       '''00000000-0000-0000-0000-0000000000c2'''
\set e3_id       '''00000000-0000-0000-0000-0000000000c3'''

-- Identity switching: tests.login(<uuid>) sets the JWT claims, then `set role authenticated`.
reset role;
create schema if not exists tests;
grant usage on schema tests to authenticated;

create or replace function tests.login(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, false);
$$;
create or replace function tests.assert(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'ASSERTION FAILED: %', p_msg; end if;
end $$;
-- Runs SQL that must fail; the error message must match p_pattern (ILIKE).
create or replace function tests.expect_error(p_sql text, p_pattern text) returns void language plpgsql as $$
declare
  v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    v_msg := sqlerrm;
    if v_msg ilike p_pattern then
      return;
    end if;
    raise exception 'ASSERTION FAILED: expected error like "%" from [%] but got "%"', p_pattern, p_sql, v_msg;
  end;
  raise exception 'ASSERTION FAILED: expected an error like "%" from [%] but it succeeded', p_pattern, p_sql;
end $$;
-- Simulates a Supabase Storage upload by the current user (RLS insert policy applies).
create or replace function tests.upload(p_name text, p_mime text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('project-files', p_name, auth.uid(), auth.uid()::text, jsonb_build_object('mimetype', p_mime, 'size', 1234));
$$;
grant execute on all functions in schema tests to authenticated;

create temp table ids (k text primary key, v uuid);
grant select, insert, update on ids to authenticated;
create or replace function tests.id(p text) returns uuid language sql as $$ select v from ids where k = p $$;
grant execute on function tests.id(text) to authenticated;

\echo '1. Invitation-only registration'
do $$ begin
  perform tests.expect_error($q$insert into auth.users (id, email) values (gen_random_uuid(), 'stranger@example.com')$q$, '%invitation only%');
end $$;

-- Documented first-owner bootstrap (performed with the service role).
insert into public.invitations (email, role, full_name, invited_by) values ('owner@javora.test', 'owner', 'Olivia Owner', null);
insert into auth.users (id, email) values (:owner_id, 'owner@javora.test');

do $$ begin
  perform tests.assert((select role from public.profiles where email = 'owner@javora.test') = 'owner', 'bootstrap owner created');
  -- a second unauthenticated owner bootstrap must be rejected
  insert into public.invitations (email, role, invited_by) values ('owner2@javora.test', 'owner', null);
  perform tests.expect_error($q$insert into auth.users (email) values ('owner2@javora.test')$q$, '%first owner%');
  delete from public.invitations where email = 'owner2@javora.test';
end $$;

\echo '2. Owner invites team; others cannot invite'
select tests.login(:owner_id);
set role authenticated;
select public.create_invitation('dispatch@javora.test', 'dispatcher', 'Dana Dispatch');
select public.create_invitation('e1@javora.test', 'editor', 'Eli One');
select public.create_invitation('e2@javora.test', 'editor', 'Eva Two');
select public.create_invitation('e3@javora.test', 'editor', 'Ezra Three');
-- Re-inviting a pending email replaces the old invitation; inviting a member fails.
select public.create_invitation('e1@javora.test', 'editor', 'Eli One');
do $$ begin
  perform tests.expect_error($q$select public.create_invitation('owner@javora.test', 'editor')$q$, '%already a member%');
end $$;
reset role;
do $$ begin
  perform tests.assert((select count(*) from public.invitations where email = 'e1@javora.test' and status = 'pending') = 1, 'one pending invite per email');
end $$;

-- Supabase Auth creates the users when invitations are accepted.
insert into auth.users (id, email) values (:disp_id, 'dispatch@javora.test');
insert into auth.users (id, email) values (:e1_id, 'e1@javora.test');
insert into auth.users (id, email) values (:e2_id, 'e2@javora.test');
insert into auth.users (id, email) values (:e3_id, 'e3@javora.test');

do $$ begin
  perform tests.assert((select role from public.profiles where email = 'dispatch@javora.test') = 'dispatcher', 'dispatcher role from invite');
  perform tests.assert((select role from public.profiles where email = 'e1@javora.test') = 'editor', 'editor role from invite');
  perform tests.assert((select count(*) from public.invitations where status = 'accepted') = 5, 'invitations consumed');
end $$;

select tests.login(:disp_id);
set role authenticated;
do $$ begin
  perform tests.expect_error($q$select public.create_invitation('y@javora.test', 'editor')$q$, '%permission%');
  perform tests.expect_error($q$select public.set_member_role('00000000-0000-0000-0000-0000000000c1', 'dispatcher')$q$, '%permission%');
  perform tests.assert((select count(*) from public.invitations) = 0, 'dispatcher cannot read invitations');
end $$;

\echo '3. Direct table writes and private helpers are blocked'
do $$ begin
  perform tests.expect_error($q$insert into public.projects (internal_ref, title, client_name, created_by) values ('X-1', 'Hack', 'c', auth.uid())$q$, '%permission denied%');
  perform tests.expect_error($q$update public.profiles set role = 'owner' where id = auth.uid()$q$, '%permission denied%');
  perform tests.expect_error($q$delete from public.project_activity$q$, '%permission denied%');
  perform tests.expect_error($q$select private.log(null, 'x.y', '{}')$q$, '%permission denied%');
  perform tests.expect_error($q$select private.close_stale_sessions(null)$q$, '%permission denied%');
end $$;
reset role;

select tests.login(:e1_id);
set role authenticated;
do $$ begin
  perform tests.expect_error($q$update public.profiles set role = 'owner' where id = auth.uid()$q$, '%permission denied%');
  perform tests.expect_error($q$select public.create_project('{"title":"x"}'::jsonb)$q$, '%permission%');
end $$;
reset role;

\echo '4. Dispatcher creates a draft project; editors cannot see drafts'
select tests.login(:disp_id);
set role authenticated;
insert into ids values ('p1', public.create_project($j${
  "internal_ref": "JV-1001",
  "title": "Product launch teaser",
  "client_name": "acme_studio",
  "client_platform": "Fiverr",
  "description": "30s teaser",
  "original_client_brief": "Make a punchy 30 second teaser with captions.",
  "editing_requirements": "Captions, music bed",
  "priority": "high",
  "deadline": "2099-01-01T10:00:00Z",
  "storyboard_required": true,
  "assets": [
    {"kind": "raw_material", "label": "Raw footage", "url": "https://drive.google.com/drive/folders/abcdefghijk123"},
    {"kind": "reference", "label": "Style ref", "url": "https://youtube.com/watch?v=xyz"}
  ]
}$j$::jsonb, false));
do $$ begin
  perform tests.assert((select status from public.projects where id = tests.id('p1')) = 'draft', 'draft created');
  perform tests.assert((select count(*) from public.project_assets where project_id = tests.id('p1')) = 2, 'assets stored');
  perform tests.expect_error($q$select public.create_project('{"internal_ref":"JV-1001","title":"Dup","client_name":"c","original_client_brief":"b"}'::jsonb)$q$, '%already exists%');
  perform tests.expect_error($q$select public.create_project('{"internal_ref":"JV-1002","title":"No brief","client_name":"c"}'::jsonb)$q$, '%brief is required%');
end $$;
reset role;

select tests.login(:e1_id);
set role authenticated;
do $$ begin
  perform tests.assert((select count(*) from public.projects) = 0, 'editor cannot see drafts');
  perform tests.assert((select count(*) from public.project_briefs) = 0, 'editor cannot see draft briefs');
end $$;
reset role;

\echo '5. Draft brief edits in place; publish makes it available and notifies editors'
select tests.login(:disp_id);
set role authenticated;
select public.update_project_brief(tests.id('p1'), 'Make a punchy 30 second teaser with captions and logo sting.', 'Captions, music bed', '', '');
do $$ begin
  perform tests.assert((select count(*) from public.project_briefs where project_id = tests.id('p1')) = 1, 'draft edit keeps one version');
end $$;
select public.publish_project(tests.id('p1'));
do $$ begin
  perform tests.assert((select status from public.projects where id = tests.id('p1')) = 'available', 'published -> available');
  perform tests.expect_error($q$select public.publish_project(tests.id('p1'))$q$, '%Cannot publish%');
end $$;
reset role;
do $$ begin
  perform tests.assert((select count(*) from public.notifications where type = 'project_available' and project_id = tests.id('p1')) = 3, 'three editors notified');
end $$;

\echo '6. Brief versioning after publication'
select tests.login(:disp_id);
set role authenticated;
do $$ begin
  perform tests.expect_error($q$select public.update_project_brief(tests.id('p1'), 'Changed brief', '', '', '')$q$, '%Describe what changed%');
  perform tests.assert(public.update_project_brief(tests.id('p1'), 'Changed brief: now 45 seconds.', 'Captions', '', 'Client extended duration') = 2, 'new version 2');
  perform tests.assert((select original_client_brief from public.project_briefs where project_id = tests.id('p1') and version = 1)
     = 'Make a punchy 30 second teaser with captions and logo sting.', 'version 1 preserved');
  perform tests.assert((select current_brief_version from public.projects where id = tests.id('p1')) = 2, 'current version pointer');
end $$;
reset role;

\echo '7. Claiming: only one editor wins'
select tests.login(:e1_id);
set role authenticated;
do $$ begin
  perform tests.assert((select count(*) from public.projects where status = 'available') = 1, 'editor sees available project');
  perform tests.assert((select count(*) from public.project_briefs where project_id = tests.id('p1')) = 2, 'editor sees briefs of available project');
  perform tests.expect_error($q$select public.start_work_session(tests.id('p1'))$q$, '%assigned editor%');
end $$;
select public.claim_project(tests.id('p1'));
reset role;
select tests.login(:e2_id);
set role authenticated;
do $$ begin
  perform tests.expect_error($q$select public.claim_project(tests.id('p1'))$q$, '%no longer available%');
  perform tests.assert((select count(*) from public.projects where id = tests.id('p1')) = 0, 'other editor loses visibility after claim');
end $$;
reset role;
do $$ begin
  perform tests.assert((select assigned_editor_id from public.projects where id = tests.id('p1')) = '00000000-0000-0000-0000-0000000000c1', 'e1 owns p1');
  perform tests.assert((select count(*) from public.project_assignments where project_id = tests.id('p1') and ended_at is null) = 1, 'one open assignment');
end $$;

\echo '8. Editor understanding: gatekeeping and review'
select tests.login(:e1_id);
set role authenticated;
do $$ begin
  perform tests.expect_error($q$select public.start_work_session(tests.id('p1'))$q$, '%Cannot start the timer%');
  perform tests.expect_error($q$select public.submit_storyboard(tests.id('p1'), 'x', '', '[]')$q$, '%Cannot submit a storyboard%');
end $$;
select tests.upload(tests.id('p1')::text || '/understanding/11111111-1111-1111-1111-111111111111-notes.pdf', 'application/pdf');
insert into ids values ('r1', public.submit_editor_response(tests.id('p1'), $j${
  "materials_description": "12 clips of product b-roll plus logo files",
  "requirements_understanding": "Client wants a 45s teaser with captions",
  "editing_approach": "Fast cuts on the beat, kinetic captions",
  "visual_sequence": "Hook, product hero, features, CTA with logo",
  "expected_deliverables": "1080p MP4",
  "questions": "Which music track?"
}$j$::jsonb, jsonb_build_array(jsonb_build_object('path', tests.id('p1')::text || '/understanding/11111111-1111-1111-1111-111111111111-notes.pdf', 'name', 'notes.pdf'))));
do $$ begin
  perform tests.expect_error($q$select public.review_editor_response(tests.id('r1'), 'approved')$q$, '%permission%');
  perform tests.assert((select count(*) from public.project_files where editor_response_id = tests.id('r1')) = 1, 'attachment linked');
end $$;
reset role;

select tests.login(:e2_id);
set role authenticated;
do $$ begin
  perform tests.assert((select count(*) from public.editor_responses) = 0, 'other editor cannot read responses');
  perform tests.expect_error($q$select tests.upload(tests.id('p1')::text || '/storyboards/x-hack.pdf', 'application/pdf')$q$, '%row-level security%');
end $$;
reset role;

select tests.login(:disp_id);
set role authenticated;
do $$ begin
  perform tests.assert((select status from public.projects where id = tests.id('p1')) = 'awaiting_confirmation', 'awaiting confirmation');
  perform tests.expect_error($q$select public.review_editor_response(tests.id('r1'), 'clarification_requested', '')$q$, '%clarification%');
end $$;
select public.review_editor_response(tests.id('r1'), 'clarification_requested', 'Use track #2 from the shared folder.');
reset role;

select tests.login(:e1_id);
set role authenticated;
insert into ids values ('r2', public.submit_editor_response(tests.id('p1'), $j${
  "materials_description": "12 clips of product b-roll plus logo files",
  "requirements_understanding": "Client wants a 45s teaser with captions, track #2",
  "editing_approach": "Fast cuts on the beat, kinetic captions",
  "visual_sequence": "Hook, product hero, features, CTA with logo",
  "expected_deliverables": "1080p MP4"
}$j$::jsonb));
reset role;

select tests.login(:disp_id);
set role authenticated;
select public.review_editor_response(tests.id('r2'), 'approved', 'Looks right.');
do $$ begin
  perform tests.assert((select status from public.projects where id = tests.id('p1')) = 'awaiting_storyboard_approval', 'storyboard stage next');
  perform tests.expect_error($q$select public.review_editor_response(tests.id('r2'), 'approved')$q$, '%already been reviewed%');
end $$;
reset role;

\echo '9. Storyboards'
select tests.login(:e1_id);
set role authenticated;
do $$ begin
  perform tests.expect_error($q$select public.submit_storyboard(tests.id('p1'), 'Board', '', '[]')$q$, '%at least one%');
  perform tests.expect_error($q$select public.submit_storyboard(tests.id('p1'), 'Board', '', jsonb_build_array(jsonb_build_object('path', tests.id('p1')::text || '/storyboards/missing.pdf', 'name', 'm.pdf')))$q$, '%not found%');
  perform tests.expect_error($q$select public.submit_storyboard(tests.id('p1'), 'Board', '', jsonb_build_array(jsonb_build_object('path', tests.id('p1')::text || '/understanding/11111111-1111-1111-1111-111111111111-notes.pdf', 'name', 'm.pdf')))$q$, '%Invalid file path%');
end $$;
select tests.upload(tests.id('p1')::text || '/storyboards/22222222-2222-2222-2222-222222222222-board.pdf', 'application/pdf');
select tests.upload(tests.id('p1')::text || '/storyboards/33333333-3333-3333-3333-333333333333-board.txt', 'text/plain');
do $$ begin
  perform tests.expect_error($q$select public.submit_storyboard(tests.id('p1'), 'Board', '', jsonb_build_array(jsonb_build_object('path', tests.id('p1')::text || '/storyboards/33333333-3333-3333-3333-333333333333-board.txt', 'name', 'b.txt')))$q$, '%PDF, PNG or JPG%');
end $$;
insert into ids values ('sb1', public.submit_storyboard(tests.id('p1'), 'Six-panel board', 'Panel 3 holds 2s',
  jsonb_build_array(jsonb_build_object('path', tests.id('p1')::text || '/storyboards/22222222-2222-2222-2222-222222222222-board.pdf', 'name', 'board.pdf'))));
do $$ begin
  perform tests.expect_error($q$select public.review_storyboard(tests.id('sb1'), 'approved')$q$, '%permission%');
end $$;
reset role;

select tests.login(:e2_id);
set role authenticated;
do $$ begin
  perform tests.assert((select count(*) from storage.objects where name like tests.id('p1')::text || '/storyboards/%') = 0, 'other editor cannot read storyboard files');
end $$;
reset role;

select tests.login(:disp_id);
set role authenticated;
do $$ begin
  perform tests.assert((select count(*) from storage.objects where name like tests.id('p1')::text || '/storyboards/%') = 2, 'dispatcher can read storyboard files');
  perform tests.expect_error($q$select public.review_storyboard(tests.id('sb1'), 'changes_requested', '')$q$, '%Explain%');
end $$;
select public.review_storyboard(tests.id('sb1'), 'comment', 'Nice pacing on panel 2.');
select public.review_storyboard(tests.id('sb1'), 'changes_requested', 'Swap panels 4 and 5.');
reset role;

select tests.login(:e1_id);
set role authenticated;
select tests.upload(tests.id('p1')::text || '/storyboards/44444444-4444-4444-4444-444444444444-board-v2.png', 'image/png');
insert into ids values ('sb2', public.submit_storyboard(tests.id('p1'), 'Six-panel board v2', '',
  jsonb_build_array(jsonb_build_object('path', tests.id('p1')::text || '/storyboards/44444444-4444-4444-4444-444444444444-board-v2.png', 'name', 'board-v2.png'))));
do $$ begin
  perform tests.assert((select count(*) from public.storyboard_reviews) = 2, 'editor sees reviews of own storyboards');
end $$;
reset role;

select tests.login(:disp_id);
set role authenticated;
select public.review_storyboard(tests.id('sb2'), 'approved', '');
do $$ begin
  perform tests.assert((select status from public.projects where id = tests.id('p1')) = 'ready_to_start', 'ready to start');
  perform tests.expect_error($q$select public.review_storyboard(tests.id('sb2'), 'approved')$q$, '%already been decided%');
end $$;
reset role;

\echo '10. Timer: start, idempotency, one-active rule, pause/resume, stale auto-pause'
-- second project for e1, no storyboard, fast-tracked to ready_to_start
select tests.login(:disp_id);
set role authenticated;
insert into ids values ('p2', public.create_project($j${
  "internal_ref": "JV-1002", "title": "Podcast clips", "client_name": "pod_co",
  "original_client_brief": "Cut 3 vertical clips.", "deadline": "2099-02-01T10:00:00Z",
  "storyboard_required": false, "planned_editor_id": "00000000-0000-0000-0000-0000000000c1"
}$j$::jsonb, true));
do $$ begin
  perform tests.assert((select status from public.projects where id = tests.id('p2')) = 'claimed', 'pre-assigned publish -> claimed');
end $$;
reset role;
select tests.login(:e1_id);
set role authenticated;
insert into ids values ('r3', public.submit_editor_response(tests.id('p2'), $j${
  "materials_description": "One 60 minute podcast recording",
  "requirements_understanding": "Three vertical highlight clips",
  "editing_approach": "Find hooks, add captions",
  "visual_sequence": "Hook, story, payoff for each clip",
  "expected_deliverables": "3 x 1080x1920 MP4"
}$j$::jsonb));
reset role;
select tests.login(:disp_id);
set role authenticated;
select public.review_editor_response(tests.id('r3'), 'approved');
do $$ begin
  perform tests.assert((select status from public.projects where id = tests.id('p2')) = 'ready_to_start', 'no storyboard -> ready to start');
end $$;
reset role;

select tests.login(:e1_id);
set role authenticated;
insert into ids values ('s1', public.start_work_session(tests.id('p1')));
do $$ begin
  perform tests.assert((select status from public.projects where id = tests.id('p1')) = 'in_progress', 'timer start -> in_progress');
  perform tests.assert(public.start_work_session(tests.id('p1')) = tests.id('s1'), 'start is idempotent (second tab)');
  perform tests.expect_error($q$select public.start_work_session(tests.id('p2'))$q$, '%already have a running timer%');
  perform tests.assert((select count(*) from public.work_session_intervals where ended_at is null) = 1, 'one open interval');
end $$;
select public.pause_work_session(tests.id('s1'));
select public.pause_work_session(tests.id('s1'));  -- idempotent
-- now the other project can run
insert into ids values ('s2', public.start_work_session(tests.id('p2')));
select public.pause_work_session(tests.id('s2'));
select public.resume_work_session(tests.id('s1'));
do $$ begin
  perform tests.assert((select status from public.work_sessions where id = tests.id('s1')) = 'active', 'resumed same session');
  perform tests.assert((select count(*) from public.work_session_intervals where session_id = tests.id('s1')) = 2, 'two intervals');
  perform tests.assert(public.heartbeat_work_session(tests.id('s1')) = 'active', 'heartbeat ok');
end $$;
reset role;

-- unique index backstop: a raw duplicate active session is impossible
do $$ begin
  perform tests.expect_error(format($q$insert into public.work_sessions (project_id, editor_id) values (%L, '00000000-0000-0000-0000-0000000000c1')$q$, tests.id('p2')), '%duplicate key%');
end $$;

-- Simulate a closed laptop: last heartbeat 30 minutes ago, interval started 40 minutes ago.
update public.work_session_intervals set started_at = now() - interval '40 minutes' where session_id = tests.id('s1') and ended_at is null;
update public.work_sessions set last_heartbeat_at = now() - interval '30 minutes' where id = tests.id('s1');
select tests.login(:e1_id);
set role authenticated;
do $$
declare v_secs bigint;
begin
  -- before cleanup, the read model already caps the open interval at heartbeat + 10 min
  select active_seconds into v_secs from public.work_session_summaries where id = tests.id('s1');
  perform tests.assert(v_secs between 1190 and 1230, 'summary capped at 20 min, got ' || v_secs);
  perform tests.assert(public.heartbeat_work_session(tests.id('s1')) = 'paused', 'stale session auto-paused on heartbeat');
  select active_seconds into v_secs from public.work_session_summaries where id = tests.id('s1');
  perform tests.assert(v_secs between 590 and 630, 'interval closed at last heartbeat (~10 min), got ' || v_secs);
  perform tests.assert((select count(*) from public.notifications where type = 'session_auto_paused') = 1, 'editor told about auto-pause');
end $$;
select public.start_work_session(tests.id('p1'));
reset role;

select tests.login(:e2_id);
set role authenticated;
do $$ begin
  perform tests.assert((select count(*) from public.work_sessions) = 0, 'editors cannot see others'' sessions');
  perform tests.assert((select count(*) from public.work_session_summaries) = 0, 'nor their summaries');
  perform tests.expect_error(format($q$select public.pause_work_session(%L)$q$, tests.id('s1')), '%not found%');
end $$;
reset role;

\echo '11. Submission'
select tests.login(:e1_id);
set role authenticated;
do $$ begin
  perform tests.expect_error(format($q$select public.submit_work(%L, '{"drive_url":"https://dropbox.com/x","access_confirmed":true}'::jsonb)$q$, tests.id('p1')), '%valid Google Drive%');
  perform tests.expect_error(format($q$select public.submit_work(%L, '{"drive_url":"https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view","access_confirmed":false}'::jsonb)$q$, tests.id('p1')), '%Confirm%');
end $$;
insert into ids values ('sub1', public.submit_work(tests.id('p1'), $j${
  "drive_url": "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing",
  "file_name": "teaser_v1.mp4", "version_label": "v1", "export_resolution": "1920x1080",
  "aspect_ratio": "16:9", "frame_rate": "30", "export_format": "MP4 H.264",
  "work_summary": "Cut teaser with kinetic captions and logo sting.",
  "completed_requirements": "Captions, music, logo", "access_confirmed": true
}$j$::jsonb));
do $$ begin
  perform tests.assert((select status from public.projects where id = tests.id('p1')) = 'submitted', 'submitted');
  perform tests.assert((select count(*) from public.work_sessions where project_id = tests.id('p1') and status <> 'stopped') = 0, 'submission stopped the session');
  perform tests.expect_error(format($q$select public.review_submission(%L, 'approved')$q$, tests.id('sub1')), '%permission%');
  perform tests.expect_error(format($q$select public.begin_submission_review(%L)$q$, tests.id('p1')), '%permission%');
end $$;
reset role;

\echo '12. Dispatcher review: revision then approval'
select tests.login(:disp_id);
set role authenticated;
select public.begin_submission_review(tests.id('p1'));
do $$ begin
  perform tests.assert((select status from public.projects where id = tests.id('p1')) = 'dispatcher_review', 'in review');
  perform tests.expect_error(format($q$select public.review_submission(%L, 'revision_requested', '', '')$q$, tests.id('sub1')), '%reason is required%');
end $$;
select public.review_submission(tests.id('sub1'), 'revision_requested', 'Minor', 'Logo sting is too long, trim to 2s.');
do $$ begin
  perform tests.assert((select status from public.projects where id = tests.id('p1')) = 'revision_requested', 'revision requested');
end $$;
reset role;

select tests.login(:e1_id);
set role authenticated;
do $$ begin
  perform tests.assert((select count(*) from public.notifications where type = 'revision_requested') = 1, 'editor notified of revision');
  perform tests.assert((select count(*) from public.revision_requests) = 1, 'editor can read revision request');
end $$;
select public.start_work_session(tests.id('p1'));
insert into ids values ('sub2', public.submit_work(tests.id('p1'), $j${
  "drive_url": "https://drive.google.com/drive/folders/1ZyXwVuTsRqPoN",
  "file_name": "teaser_v2.mp4", "export_resolution": "1920x1080",
  "aspect_ratio": "16:9", "frame_rate": "30", "export_format": "MP4 H.264",
  "work_summary": "Trimmed logo sting to 2 seconds.",
  "completed_requirements": "All", "access_confirmed": true
}$j$::jsonb));
do $$ begin
  perform tests.assert((select version_label from public.submissions where id = tests.id('sub2')) = 'v2', 'auto version label');
  perform tests.assert((select resolved_by_submission_id from public.revision_requests limit 1) = tests.id('sub2'), 'revision resolved by v2');
  perform tests.assert((select count(*) from public.submissions where project_id = tests.id('p1')) = 2, 'history kept');
end $$;
reset role;

select tests.login(:disp_id);
set role authenticated;
do $$ begin
  perform tests.expect_error(format($q$select public.review_submission(%L, 'approved')$q$, tests.id('sub1')), '%already been reviewed%');
end $$;
select public.review_submission(tests.id('sub2'), 'approved', 'Great.');
do $$ begin
  perform tests.assert((select status from public.projects where id = tests.id('p1')) = 'completed', 'completed');
  perform tests.assert((select completed_at from public.projects where id = tests.id('p1')) is not null, 'completed_at set');
  perform tests.assert((select count(*) from public.project_assignments where project_id = tests.id('p1') and ended_at is null) = 0, 'assignment closed');
  perform tests.expect_error(format($q$select public.update_project(%L, '{"title":"New"}'::jsonb)$q$, tests.id('p1')), '%cannot be edited%');
end $$;
select public.set_project_archived(tests.id('p1'), true);
reset role;

select tests.login(:e1_id);
set role authenticated;
do $$ begin
  perform tests.assert((select count(*) from public.projects where id = tests.id('p1')) = 1, 'editor keeps history access');
  perform tests.assert((select count(*) from public.project_activity where project_id = tests.id('p1')) > 10, 'editor sees project activity');
end $$;
reset role;

\echo '13. Activity log completeness'
do $$
declare
  a text;
begin
  foreach a in array array[
    'project.created', 'brief.edited_draft', 'project.published', 'brief.versioned', 'project.claimed',
    'understanding.submitted', 'understanding.clarification_requested', 'understanding.approved',
    'storyboard.submitted', 'storyboard.commented', 'storyboard.changes_requested', 'storyboard.approved',
    'project.production_started', 'work_session.started', 'work_session.paused', 'work_session.resumed',
    'work_session.auto_paused', 'submission.created', 'review.started', 'submission.revision_requested',
    'submission.approved', 'project.archived'
  ] loop
    perform tests.assert(exists (select 1 from public.project_activity where project_id = tests.id('p1') and action = a), 'activity logged: ' || a);
  end loop;
end $$;

\echo '14. Reassignment, hold, cancel'
select tests.login(:disp_id);
set role authenticated;
insert into ids values ('p3', public.create_project($j${
  "internal_ref": "JV-1003", "title": "Wedding highlight", "client_name": "j_and_k",
  "original_client_brief": "4 minute highlight film.", "deadline": "2099-03-01T10:00:00Z",
  "storyboard_required": false
}$j$::jsonb, true));
reset role;
select tests.login(:e2_id);
set role authenticated;
select public.claim_project(tests.id('p3'));
reset role;
select tests.login(:disp_id);
set role authenticated;
do $$ begin
  perform tests.expect_error(format($q$select public.assign_editor(%L, '00000000-0000-0000-0000-0000000000c3', '')$q$, tests.id('p3')), '%reason%');
  perform tests.expect_error(format($q$select public.assign_editor(%L, '00000000-0000-0000-0000-0000000000b1', 'x')$q$, tests.id('p3')), '%not an active editor%');
end $$;
select public.assign_editor(tests.id('p3'), :e3_id, 'Eva is overloaded');
do $$ begin
  perform tests.assert((select assigned_editor_id from public.projects where id = tests.id('p3')) = '00000000-0000-0000-0000-0000000000c3', 'reassigned');
  perform tests.assert((select count(*) from public.project_assignments where project_id = tests.id('p3')) = 2, 'assignment history kept');
end $$;
select public.put_project_on_hold(tests.id('p3'), 'Client paused');
do $$ begin
  perform tests.assert((select status from public.projects where id = tests.id('p3')) = 'on_hold', 'on hold');
end $$;
select public.resume_project(tests.id('p3'));
do $$ begin
  perform tests.assert((select status from public.projects where id = tests.id('p3')) = 'claimed', 'resumed to previous status');
end $$;
select public.cancel_project(tests.id('p3'), 'Client withdrew');
do $$ begin
  perform tests.assert((select status from public.projects where id = tests.id('p3')) = 'cancelled', 'cancelled');
  perform tests.expect_error(format($q$select public.delete_draft_project(%L)$q$, tests.id('p3')), '%permission%');
end $$;
reset role;

select tests.login(:e2_id);
set role authenticated;
do $$ begin
  perform tests.assert((select count(*) from public.projects where id = tests.id('p3')) = 1, 'previous assignee keeps history visibility');
  perform tests.assert((select count(*) from public.notifications where type = 'project_unassigned') = 1, 'previous assignee notified');
end $$;
reset role;

\echo '15. Owner-only deletion of drafts'
select tests.login(:owner_id);
set role authenticated;
insert into ids values ('p4', public.create_project('{"internal_ref":"JV-1004","title":"Scratch draft","client_name":"c","original_client_brief":"b"}'::jsonb));
do $$ begin
  perform tests.expect_error(format($q$select public.delete_draft_project(%L)$q$, tests.id('p3')), '%Only draft%');
  perform tests.assert(public.delete_draft_project(tests.id('p4')) = '{}'::text[], 'draft deleted');
  perform tests.assert((select count(*) from public.projects where id = tests.id('p4')) = 0, 'gone');
end $$;
reset role;

\echo '16. Team management guards and disabled accounts'
select tests.login(:owner_id);
set role authenticated;
do $$ begin
  perform tests.expect_error($q$select public.set_member_role('00000000-0000-0000-0000-0000000000a1', 'editor')$q$, '%own role%');
  perform tests.expect_error($q$select public.set_member_active('00000000-0000-0000-0000-0000000000a1', false)$q$, '%own account%');
  perform tests.expect_error($q$select public.set_member_role('00000000-0000-0000-0000-0000000000c1', 'dispatcher')$q$, '%Reassign%');
end $$;
select public.set_member_active(:e3_id, false);
do $$ begin
  perform tests.assert((select count(*) from public.team_metrics()) = 3, 'metrics for three editors');
  perform tests.assert((select projects_completed from public.team_metrics() where editor_id = '00000000-0000-0000-0000-0000000000c1') = 1, 'e1 completed one');
  perform tests.assert((select revision_requests from public.team_metrics() where editor_id = '00000000-0000-0000-0000-0000000000c1') = 1, 'e1 had one revision');
  perform tests.assert((select completed_on_time from public.team_metrics() where editor_id = '00000000-0000-0000-0000-0000000000c1') = 1, 'on time');
end $$;
reset role;

select tests.login(:e3_id);
set role authenticated;
do $$ begin
  perform tests.assert((select count(*) from public.projects) = 0, 'disabled account sees no projects');
  perform tests.assert((select count(*) from public.profiles where id <> auth.uid()) = 0, 'disabled account sees no colleagues');
  perform tests.expect_error($q$select public.run_maintenance()$q$, '%permission%');
end $$;
reset role;

select tests.login(:e1_id);
set role authenticated;
do $$ begin
  perform tests.expect_error($q$select public.team_metrics()$q$, '%permission%');
  perform tests.assert((public.dashboard_stats() ->> 'completed')::int = 1, 'editor dashboard scoped');
  perform tests.expect_error($q$select public.update_my_profile('Eli', 'Mars/Olympus', '{}')$q$, '%time zone%');
  perform tests.expect_error($q$select public.update_my_profile('Eli', 'Asia/Jakarta', '{"role":"owner"}')$q$, '%Invalid notification preference%');
end $$;
select public.update_my_profile('Eli One', 'Asia/Jakarta', '{"project_available": false}');
select public.mark_notifications_read(null);
do $$ begin
  perform tests.assert((select count(*) from public.notifications where read_at is null) = 0, 'all read');
  perform tests.assert((select count(*) from public.notifications where recipient_id <> auth.uid()) = 0, 'only own notifications visible');
end $$;
reset role;

\echo '17. Notification preferences respected; deadline reminders'
select tests.login(:disp_id);
set role authenticated;
insert into ids values ('p5', public.create_project(format($j${
  "internal_ref": "JV-1005", "title": "Rush job", "client_name": "rush",
  "original_client_brief": "Same-day edit.", "deadline": "%s", "storyboard_required": false
}$j$, (now() + interval '3 hours')::text)::jsonb, true));
reset role;
do $$ begin
  perform tests.assert(not exists (select 1 from public.notifications where project_id = tests.id('p5') and recipient_id = '00000000-0000-0000-0000-0000000000c1'), 'opted-out type not delivered');
  perform tests.assert(exists (select 1 from public.notifications where project_id = tests.id('p5') and recipient_id = '00000000-0000-0000-0000-0000000000c2'), 'others still notified');
end $$;
select tests.login(:e2_id);
set role authenticated;
select public.run_maintenance();
reset role;
do $$ begin
  perform tests.assert((select count(*) from public.notifications where project_id = tests.id('p5') and type = 'deadline_approaching') = 2, 'deadline reminders to owner + dispatcher');
  perform tests.assert((select (public.run_maintenance() ->> 'deadline_reminders')::int) = 0, 'reminders are idempotent');
end $$;

\echo '18. Claim limit per editor'
update public.workspace_settings set max_active_projects_per_editor = 1;
select tests.login(:e2_id);
set role authenticated;
select public.claim_project(tests.id('p5'));
reset role;
select tests.login(:disp_id);
set role authenticated;
insert into ids values ('p6', public.create_project('{"internal_ref":"JV-1006","title":"Another job","client_name":"c","original_client_brief":"b","deadline":"2099-01-01T00:00:00Z"}'::jsonb, true));
reset role;
select tests.login(:e2_id);
set role authenticated;
do $$ begin
  perform tests.expect_error(format($q$select public.claim_project(%L)$q$, tests.id('p6')), '%limit%');
end $$;
reset role;
update public.workspace_settings set max_active_projects_per_editor = 3;

\echo '19. Sign-in tracking and invitation rate limit'
update auth.users set last_sign_in_at = now() where id = :e1_id;
do $$ begin
  perform tests.assert((select last_sign_in_at from public.profiles where id = '00000000-0000-0000-0000-0000000000c1') is not null, 'last sign-in synced to profile');
end $$;
select tests.login(:owner_id);
set role authenticated;
do $$
declare i int;
begin
  -- 5 invitations were already created by the owner this hour
  for i in 1..25 loop
    perform public.create_invitation('bulk' || i || '@javora.test', 'editor');
  end loop;
  perform tests.expect_error($q$select public.create_invitation('bulk-over@javora.test', 'editor')$q$, '%Too many invitations%');
end $$;
reset role;

\echo 'ALL DATABASE TESTS PASSED'
