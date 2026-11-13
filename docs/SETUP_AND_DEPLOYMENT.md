# Setup & Deployment

This guide takes JAVORA DESK from an empty Supabase project to a private production deployment on Vercel.
Follow the steps in order. Nothing here requires code changes.

---

## 1. Create the Supabase project

1. Create a project at <https://supabase.com/dashboard> (pick the region closest to the team — e.g. Singapore for Indonesia).
2. Save the database password somewhere safe.
3. From **Project Settings → API Keys** copy:
   - the **Project URL**
   - the **publishable key** (`sb_publishable_…`) — or the legacy `anon` key
   - the **secret key** (`sb_secret_…`) — or the legacy `service_role` key. **Treat it like a root password.**

## 2. Apply the database migrations

The schema lives in `supabase/migrations/` and must be applied **in filename order**:

| File | Contents |
|---|---|
| `20261113000100_core_schema.sql` | Enums, tables, constraints, indexes, AI-QC tables |
| `20261113000200_access_control.sql` | Role helpers, Row Level Security, table privileges |
| `20261113000300_workflow_functions.sql` | State machine, invitations trigger, all write operations |
| `20261113000400_storage_views_realtime.sql` | Private storage bucket + policies, time read-model, dashboard/metrics, realtime |
| `20261113000500_member_tracking_rate_limits.sql` | Sign-in tracking, invitation rate limit |
| `20261114000600_open_google_registration.sql` | Optional open sign-up with Google (joins as Editor) |

**Option A — Supabase CLI (recommended)**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

**Option B — SQL Editor**

Open **SQL Editor**, paste each file's contents in order, and run it. Every file must succeed before running the next.

**Verify:** Table Editor shows `projects`, `profiles`, … each with the RLS shield enabled; Storage shows a **private** bucket named `project-files`.

## 3. Configure Supabase Auth

**Authentication → Sign In / Providers**

- **Email**: enabled.
- **Allow new users to sign up**: **OFF** (registration is invitation-only; the database rejects uninvited users anyway, this closes the front door too).
- Recommended: minimum password length **10**, enable **leaked password protection** (Pro plan).

**Authentication → URL Configuration**

- **Site URL**: your production URL, e.g. `https://desk.javora.com`
- **Redirect URLs**: add `https://desk.javora.com/auth/confirm**` (and `http://localhost:3000/auth/confirm**` for development).

**Authentication → Emails → Templates** — replace two templates so links work with server-side sessions:

| Template | Subject (suggested) | Body |
|---|---|---|
| Invite user | `You're invited to JAVORA DESK` | contents of `supabase/email-templates/invite.html` |
| Reset password | `Reset your JAVORA DESK password` | contents of `supabase/email-templates/recovery.html` |

The important part of each template is the link format:
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` (or `type=recovery`).
The default templates use a browser-only flow that a server-rendered app cannot complete.

**Authentication → Emails → SMTP Settings** — configure a custom SMTP provider (Resend, Postmark, SES, …).
Supabase's built-in mailer only delivers to project team members and is heavily rate-limited, so invitations to
editors will not arrive without custom SMTP.

## 3b. Sign in with Google

Everyone can sign in with their own Google account — no passwords and **no SMTP needed**.

1. **Google Cloud Console** (<https://console.cloud.google.com>): create a project → **APIs & Services → OAuth consent
   screen** (External, app name "JAVORA DESK", your support email; scopes: email, profile, openid) → **Publish app**.
   Then **Credentials → Create credentials → OAuth client ID → Web application**, and add the Authorized redirect URI
   shown in Supabase (`https://<your-project-ref>.supabase.co/auth/v1/callback`). Copy the Client ID and secret.
2. **Supabase → Authentication → Sign In / Providers → Google**: enable, paste Client ID and secret, save.
3. **Supabase → Authentication → Sign In / Providers**: turn **Allow new users to sign up ON** (needed for anyone's
   first Google sign-in).

Who gets in is decided by the database (`on_auth_user_created` trigger), not by that Supabase switch:

| Situation | Result |
|---|---|
| Email has a pending invitation (Google or password) | Joins with the invited role |
| No invitation, signs in with **Google**, *Settings → Workspace → "Anyone with a Google account can join"* **on** (default) | Joins as **Editor**; owners get a notification |
| Same, but that setting **off** | Rejected |
| No invitation, email/password sign-up | Always rejected |

New members never receive a privileged role automatically. Promote someone to Dispatcher (or disable them) in **Team**.
An existing password account can also use "Continue with Google" with the same address — Supabase links them.

## 4. Optional: scheduled maintenance

Enable **Database → Extensions → pg_cron**, then run `supabase/optional/pg_cron_maintenance.sql` in the SQL Editor.
This runs every 5 minutes to auto-pause abandoned timers and send deadline reminders. Without it, the same job runs
whenever someone opens the dashboard.

## 5. Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | browser + server | Public key; safe because every table enforces RLS |
| `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) | **server only** | Invitations, disabling accounts, first-owner script |
| `NEXT_PUBLIC_SITE_URL` | browser + server | Base URL for links in emails (no trailing slash) |

Copy `.env.example` to `.env.local` for development. **Never** commit `.env.local` or prefix the secret key with `NEXT_PUBLIC_`.

## 6. Create the first Owner

There is deliberately no sign-up page. The first Owner is created once, from a trusted machine, with the secret key:

```bash
npm install
cp .env.example .env.local   # fill in the four values
npm run owner:create -- --email owner@javora.com --name "Owner Name" --password 'A-Strong-Passw0rd'
```

Omit `--password` to send an invitation email instead (requires the SMTP setup from step 3).

How this stays safe:
- The script records an owner invitation *without an inviter*. The database accepts such an invitation **only while
  the workspace has no owner** — after that, the script refuses to run and the database would reject it anyway.
- Every later member is invited from **Team → Invite member** by an Owner. Roles are stored in the database and are
  never taken from anything the invitee can edit.

**Alternative without Node:** in the SQL Editor run
`insert into public.invitations (email, role, full_name) values ('owner@javora.com', 'owner', 'Owner Name');`
then **Authentication → Users → Invite user** with the same email.

## 7. Deploy to Vercel

1. Push the repository to GitHub/GitLab/Bitbucket.
2. In Vercel: **Add New → Project → Import** the repository. Framework preset: **Next.js** (auto-detected).
3. Add the four environment variables from step 5 for **Production** (and **Preview** if you use preview deployments
   with a separate Supabase project).
4. Deploy. Then set your custom domain and update **Site URL** / **Redirect URLs** in Supabase (step 3) to match.
5. Sign in as the Owner and invite the team.

The app is public on the internet but every page except sign-in/password-reset requires a session, and every row of
data is filtered by Postgres RLS — even someone calling the Supabase API directly with the public key sees nothing
without a valid, active account.

---

## Deployment checklist

- [ ] All six migrations applied without errors (in order)
- [ ] `project-files` bucket exists and is **not public**
- [ ] Auth: sign-ups **disabled** (or enabled only because Google sign-in is used — invite-only is still enforced by the database); Site URL and Redirect URLs set to the production domain
- [ ] Invite and Reset-password email templates use the `token_hash` link
- [ ] Custom SMTP configured and a test invitation received
- [ ] `SUPABASE_SECRET_KEY` set in Vercel **without** `NEXT_PUBLIC_`; not present in the repository
- [ ] `NEXT_PUBLIC_SITE_URL` matches the production domain
- [ ] First Owner created; `npm run owner:create` now refuses to run
- [ ] Owner can sign in; `/dashboard` loads with zeros (no demo data)
- [ ] Invited a test Dispatcher and Editor; both received emails and set passwords
- [ ] Editor cannot open `/team`, `/projects/new` or `/activity`
- [ ] Created, published and claimed a test project; uploaded a storyboard PDF and opened it from the Storyboard tab
- [ ] Timer: started, refreshed the page, still running; paused from a second tab
- [ ] Submitted a Drive link, requested a revision, approved — project shows **Completed**
- [ ] Notifications appear live (bell updates without refresh) — confirms Realtime is working
- [ ] Optional: pg_cron maintenance scheduled
- [ ] Test data cancelled/archived (or the draft deleted) before go-live

## Upgrading later

Add new SQL files to `supabase/migrations/` with a later timestamp and apply them with `supabase db push`.
Never edit a migration that has already been applied to production. After schema changes, regenerate types:

```bash
npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
```
