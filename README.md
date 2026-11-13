# JAVORA DESK

Internal editing-production management for the Javora video editing team — from a client order on Fiverr to the
approved final edit.

Dispatchers capture the original brief and materials; editors claim work, confirm their understanding, get storyboards
approved, track time, and deliver through Google Drive; dispatchers review, request revisions and approve. Every
instruction, decision and minute is kept.

**Stack:** Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS 4 · Supabase (Postgres, Auth, Storage,
Realtime) · Zod · Lucide · Vercel.

## Quick start (development)

```bash
npm install
cp .env.example .env.local        # fill in your Supabase project values
# apply supabase/migrations/* to your Supabase project (see docs)
npm run owner:create -- --email you@javora.com --name "Your Name" --password 'A-Strong-Passw0rd'
npm run dev                       # http://localhost:3000
```

Full instructions, Supabase configuration (auth, email templates, SMTP) and the Vercel deployment checklist:
**[docs/SETUP_AND_DEPLOYMENT.md](docs/SETUP_AND_DEPLOYMENT.md)**.

## Documentation

| Document | What's in it |
|---|---|
| [docs/SETUP_AND_DEPLOYMENT.md](docs/SETUP_AND_DEPLOYMENT.md) | Supabase setup, environment variables, first Owner, Vercel, go-live checklist |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema, roles, state machine, timer model, storage rules, AI-QC extension points |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Status, testing, known limitations, remaining work |
| [e2e/README.md](e2e/README.md) | Running the browser end-to-end tests against a disposable local stack |

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run check` | Typecheck + lint + production build |
| `npm run db:test` | Database test-suite on a throwaway local Postgres (needs `psql`) |
| `npm run db:types` | Regenerate `database.types.ts` from a migrated local database |
| `npm run owner:create` | One-time creation of the first Owner (uses the secret key) |

## Project layout

```
src/
  app/(auth)/        login, forgot password, set password
  app/(app)/         authenticated app: dashboard, projects, team, activity, notifications, settings
  app/auth/confirm   email-link landing (invites, password resets)
  app/api/files      signed-URL access to private files
  components/        ui/ (design system), layout/, projects/, workspace/, team/, settings/
  lib/actions/       server actions (validate with Zod → call database functions)
  lib/supabase/      server, browser, admin (server-only) clients + generated types
  lib/queries.ts     server-side reads
  proxy.ts           session refresh + sign-in gate
supabase/
  migrations/        schema, RLS, workflow functions, storage, read models
  tests/             SQL test-suite + concurrency tests
  email-templates/   Invite and reset-password emails
  optional/          pg_cron maintenance schedule
scripts/             first-owner bootstrap, type generator
e2e/                 Playwright end-to-end flow + local Supabase-compatible stack
```

## Security model in one paragraph

All writes go through Postgres functions that take the caller's identity from the JWT and their role from the
`profiles` table, validate the transition and lock rows. RLS restricts every read; there are no write policies, and
`anon` has no access. Registration is invite-only at the database level. The secret key is used only on the server
for sending invitations and banning disabled accounts. Files live in a private bucket and are served via short-lived
signed URLs created with the user's own session. See [docs/DATABASE.md](docs/DATABASE.md).
