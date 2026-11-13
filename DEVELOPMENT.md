# DEVELOPMENT.md — JAVORA DESK

_Last updated: 13 Nov 2026_

## Current status

**MVP feature-complete.** All nine development phases are implemented and verified locally (database tests,
browser end-to-end tests, typecheck, lint, production build). What remains before go-live is configuration and a
smoke test on the real Supabase project — see "Not yet verified" below.

## Completed phases

| Phase | Scope | Status |
|---|---|---|
| 1 Foundation | Next.js 16 + TS strict + Tailwind 4, design tokens, UI library, collapsible sidebar, mobile drawer | ✅ |
| 2 Authentication | Login, password reset, invite acceptance, protected routes (`proxy.ts`), invite-only registration enforced in DB, first-owner script, RLS | ✅ |
| 3 Project management | Create/edit, original brief + versioning, materials & references (links and files), publish, claim (atomic), assign/reassign/unassign | ✅ |
| 4 Production workflow | Editor understanding (7 fields + attachments), clarification loop, storyboard upload/review/comments, state machine | ✅ |
| 5 Time tracking | DB-backed sessions/intervals, pause/resume/stop, multi-tab safety, heartbeat + stale auto-pause, session history, deadline countdowns | ✅ |
| 6 Delivery | Drive submission with validation + access reminder, versioned submissions, review, revisions with required reason, completion | ✅ |
| 7 Team | Invitations, roles, disable/enable (DB + auth ban), editor metrics, realtime in-app notifications + preferences, activity log | ✅ |
| 8 QA | SQL suite (permissions, transitions, concurrency, timer, storage policies), Playwright e2e + sweep, mobile overflow checks | ✅ |
| 9 Deployment prep | `.env.example`, Supabase + Vercel guide, email templates, pg_cron script, go-live checklist | ✅ |

## Setup requirements

- Node.js ≥ 20.9
- A Supabase project (Free tier works; custom SMTP strongly recommended for invitations)
- Vercel account for hosting
- For running the test-suites locally: PostgreSQL 15/16 client + server (`psql`, `createdb`), Chrome/Chromium

Step-by-step: [docs/SETUP_AND_DEPLOYMENT.md](docs/SETUP_AND_DEPLOYMENT.md).

## Testing

### 1. Static checks
```bash
npm run check          # next typegen + tsc --noEmit + eslint + next build
```

### 2. Database test-suite (`supabase/tests/`)
Runs against a throwaway database with a minimal stub of Supabase's `auth`/`storage` schemas; every test executes as a
real `authenticated` user so RLS is enforced.
```bash
PGHOST=... PGPORT=... PGUSER=postgres npm run db:test
```
Covers: invite-only registration (incl. owner bootstrap guard), owner/dispatcher/editor permissions, blocked direct
writes and private helpers, draft visibility, brief versioning, claim exclusivity, understanding gate + clarification,
storyboard upload/type/path validation and storage RLS, timer idempotency / one-active-session / stale auto-pause,
Drive URL + access confirmation, review/revision/approval, full activity log, reassignment/hold/cancel, draft deletion,
last-owner and self-demotion guards, disabled accounts, notification preferences, deadline reminders, claim limit,
sign-in tracking, invitation rate limit. Plus two **real concurrency tests**: two editors claiming the same project at
the same instant, and one editor starting the timer from two connections at once.

### 3. Browser end-to-end tests (`e2e/`)
Playwright drives Chrome against the app + Supabase Auth (GoTrue) + PostgREST on a disposable database. See
[e2e/README.md](e2e/README.md). The flow covers 21 steps: owner invites three people → they accept from the email
link → editor blocked from manager pages → project created/published → brief v2 → claim race → clarification loop →
timer survives reload and syncs across tabs → Drive submission → revision → resubmission → approval → activity →
team metrics → disabling an account → mobile layouts without horizontal overflow. The sweep adds settings, workspace
settings, archive, draft edit/delete, notification preferences, password reset by email, wrong-password and
open-redirect checks, and file-route path validation.

Last results: DB suite ✅ · e2e flow ✅ (3 consecutive clean runs) · sweep ✅ · typecheck/lint/build ✅

## Not yet verified (requires the real Supabase project)

The local stack has no Storage or Realtime server, so these are implemented but only partly verified:

- **File uploads from the browser** (storyboards, attachments, material files). Storage RLS policies and the
  server-side upload verification are covered by the SQL suite; the browser → Storage upload path must be checked on
  Supabase (checklist item in the setup guide).
- **Realtime** (live notification bell, project page auto-refresh). Without it, everything still works on navigation.
- **Email delivery** through your SMTP provider (tested locally with an SMTP sink).

## Known issues & limitations

- Notifications are in-app only (no email/push).
- A Google Drive link's sharing settings cannot be verified by the app; editors confirm access explicitly and
  dispatchers see guidance if Drive asks for permission.
- If an editor's browser stops responding for longer than the stale threshold (default 10 min), the session pauses at
  the last heartbeat. Work done offline in that gap is not counted — by design, so time is never overstated.
- Only draft projects can be deleted; published projects are cancelled and archived to preserve history.
- Search is `ILIKE` across title/client/ID — fine for thousands of projects; add a trigram index if it grows further.
- A project's activity tab shows the latest 200 entries (the global Activity log paginates).
- Editor metrics are simple and noisy at small sample sizes; the UI says so.
- The e2e local stack scripts target Linux x64.

## Remaining tasks / suggested next steps

1. Go-live: complete the checklist in the setup guide on the production Supabase project.
2. Enable Supabase MFA for Owner accounts.
3. Optional: email notifications for revision requests and assignments (Supabase Edge Function or SMTP from a server action).
4. Optional: inline previews/thumbnails for storyboard images and PDFs.
5. Optional: CSV export of sessions/time per project for invoicing.
6. Future: AI Quality Control module using `ai_reports` / `ai_findings` (schema ready; see docs/DATABASE.md).

## Conventions

- Mutations: client component → server action (Zod validation) → Postgres function. No direct table writes.
- Reads: server components via `src/lib/queries.ts` with the user's session (RLS applies).
- New schema changes: add a new timestamped migration, extend `supabase/tests/10_workflow_tests.sql`, run
  `npm run db:test`, then `npm run db:types`.
- UI: use `src/components/ui/*`; colours via theme tokens in `globals.css`; every list has an empty state, every
  action reports errors via toast, destructive actions use `ConfirmDialog`.
