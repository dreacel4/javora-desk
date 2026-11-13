#!/usr/bin/env bash
# Disposable, Supabase-compatible stack for end-to-end tests (NOT for production):
#   Postgres 15+/16 (yours) + Supabase Auth (GoTrue) + PostgREST + a tiny gateway + SMTP sink.
# Storage and Realtime are not included: file uploads and live updates are
# covered by the SQL test-suite and manual checks against a real Supabase project.
#
# Requirements: psql/createdb pointing at a local Postgres superuser (PGHOST/PGPORT/PGUSER),
# curl, tar, xz, python3, node 20+.
#   bash local-stack/stack.sh up      # download binaries (once), start services, migrate, create owner
#   bash local-stack/stack.sh reset   # wipe the database and start over
#   bash local-stack/stack.sh down    # stop services
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BIN="$HERE/.bin"
DB="${E2E_DB:-javora_e2e}"
SECRET="local-e2e-jwt-secret-must-be-at-least-32-chars"
POSTGREST_VERSION="v12.2.3"
AUTH_VERSION="v2.177.0"

jwt() { node -e 'const c=require("crypto"),[s,r]=process.argv.slice(1),b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");const h=b({alg:"HS256",typ:"JWT"}),p=b({role:r,iss:"supabase",exp:Math.floor(Date.now()/1e3)+31536000});console.log(h+"."+p+"."+c.createHmac("sha256",s).update(h+"."+p).digest("base64url"))' "$SECRET" "$1"; }

download() {
  mkdir -p "$BIN"
  if [ ! -x "$BIN/postgrest" ]; then
    curl -sSL "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-linux-static-x64.tar.xz" | tar -xJ -C "$BIN"
  fi
  if [ ! -x "$BIN/auth" ]; then
    mkdir -p "$BIN/auth-dist"
    curl -sSL "https://github.com/supabase/auth/releases/download/$AUTH_VERSION/auth-$AUTH_VERSION-x86.tar.gz" | tar -xz -C "$BIN/auth-dist"
    ln -sf "$BIN/auth-dist/auth" "$BIN/auth"
  fi
}

down() {
  pkill -f "$BIN/auth" 2>/dev/null || true
  pkill -f "$BIN/postgrest" 2>/dev/null || true
  pkill -f "local-stack/gateway.mjs" 2>/dev/null || true
  pkill -f "local-stack/smtp-sink.mjs" 2>/dev/null || true
  pkill -f "http.server 54399" 2>/dev/null || true
}

start_aux() {
  (cd "$HERE" && setsid nohup node gateway.mjs < /dev/null > gateway.log 2>&1 &)
  (cd "$HERE" && setsid nohup node smtp-sink.mjs < /dev/null > smtp.log 2>&1 &)
  (cd "$HERE/templates" && setsid nohup python3 -m http.server 54399 --bind 127.0.0.1 < /dev/null > ../templates.log 2>&1 &)
}

reset_db() {
  pkill -f "$BIN/auth" 2>/dev/null || true; pkill -f "$BIN/postgrest" 2>/dev/null || true; sleep 1
  rm -f "$HERE/mail.jsonl"
  dropdb --if-exists "$DB"; createdb "$DB"
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin login superuser; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if;
end \$\$;
grant anon, authenticated, service_role to authenticator;
alter role supabase_auth_admin set search_path = auth;
create schema auth authorization supabase_auth_admin;
create schema extensions;
SQL
  local HOSTPARAM="host=${PGHOST:-/var/run/postgresql}&port=${PGPORT:-5432}"
  GOTRUE_API_HOST=127.0.0.1 PORT=9999 API_EXTERNAL_URL=http://localhost:54321/auth/v1 \
  GOTRUE_DB_DRIVER=postgres DATABASE_URL="postgres://supabase_auth_admin@localhost/$DB?$HOSTPARAM&sslmode=disable" \
  GOTRUE_SITE_URL=http://localhost:3000 GOTRUE_URI_ALLOW_LIST='http://localhost:3000/**' GOTRUE_DISABLE_SIGNUP=true \
  GOTRUE_JWT_SECRET="$SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
  GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=false \
  GOTRUE_SMTP_HOST=127.0.0.1 GOTRUE_SMTP_PORT=2525 GOTRUE_SMTP_ADMIN_EMAIL=desk@javora.test GOTRUE_SMTP_SENDER_NAME="JAVORA DESK" \
  GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_MAILER_TEMPLATES_INVITE=http://127.0.0.1:54399/invite.html \
  GOTRUE_MAILER_TEMPLATES_RECOVERY=http://127.0.0.1:54399/recovery.html \
  setsid nohup "$BIN/auth" < /dev/null > "$HERE/auth.log" 2>&1 &
  for _ in $(seq 1 30); do curl -sf localhost:9999/health >/dev/null && break; sleep 1; done

  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL' 2>&1 | grep -v -E "NOTICE|wal_level|HINT" || true
create schema if not exists storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null, owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
create publication supabase_realtime;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
SQL
  for f in "$ROOT"/supabase/migrations/*.sql; do psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 | grep -v NOTICE || true; done
  psql -X -q -d "$DB" -c "grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; grant execute on all functions in schema public to service_role;"

  cat > "$HERE/postgrest.conf" <<CONF
db-uri = "postgres://authenticator@localhost/$DB?$HOSTPARAM"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = 3001
CONF
  setsid nohup "$BIN/postgrest" "$HERE/postgrest.conf" < /dev/null > "$HERE/postgrest.log" 2>&1 &
  sleep 2

  local ANON SERVICE; ANON=$(jwt anon); SERVICE=$(jwt service_role)
  cat > "$HERE/app.env" <<ENV
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$ANON
SUPABASE_SECRET_KEY=$SERVICE
NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV
  (cd "$ROOT" && node --env-file="$HERE/app.env" scripts/create-first-owner.mjs --email owner@javora.test --name "Olivia Owner" --password 'OwnerPass123')
  echo "Stack ready. Copy e2e/local-stack/app.env to .env.local, then: npm run build && npm start"
}

case "${1:-up}" in
  up) download; down; start_aux; reset_db ;;
  reset) reset_db ;;
  down) down ;;
  *) echo "usage: stack.sh up|reset|down"; exit 1 ;;
esac
