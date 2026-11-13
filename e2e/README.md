# End-to-end tests

Browser tests that drive the real UI with Playwright (Chrome) against a **disposable** Supabase-compatible stack:
your local Postgres + Supabase Auth (GoTrue) + PostgREST + a tiny API gateway + an SMTP sink that captures emails.
Storage and Realtime are not part of this stack (see DEVELOPMENT.md).

> Never point these scripts at production — they create users and projects.

## Requirements

- Linux x64, Node 20+, Chrome/Chromium (`CHROME_PATH` if not `/usr/bin/google-chrome`)
- A local PostgreSQL 15/16 superuser reachable via `PGHOST`/`PGPORT`/`PGUSER`
- `curl`, `tar`, `xz`, `python3`

## Run

```bash
cd e2e
npm install
bash local-stack/stack.sh up            # downloads GoTrue + PostgREST once, migrates, creates owner@javora.test
cp local-stack/app.env ../.env.local    # points the app at the local stack
cd .. && npm run build && npm start &   # app on http://localhost:3000
cd e2e
node flow.mjs                           # 21-step workflow
node sweep.mjs                          # settings, archive, drafts, password reset, security checks
bash local-stack/stack.sh reset         # fresh database before running flow.mjs again
bash local-stack/stack.sh down          # stop services
```

Screenshots are written to `e2e/shots/`. Captured emails are in `e2e/local-stack/mail.jsonl`.
