#!/usr/bin/env bash
# Runs the JAVORA DESK database test-suite against a throwaway local Postgres
# database: Supabase stub -> migrations -> workflow tests -> concurrency tests.
#
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="${TEST_DB:-javora_desk_test}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")

dropdb --if-exists "$DB" >/dev/null 2>&1 || true
createdb "$DB"

echo "→ Supabase stub"
"${PSQL[@]}" -f supabase/tests/00_supabase_stub.sql 2>&1 | grep -v -e wal_level -e 'Set wal_level' || true

echo "→ Migrations"
for f in supabase/migrations/*.sql; do
  echo "   $(basename "$f")"
  "${PSQL[@]}" -f "$f" 2>&1 | grep -v -e NOTICE || true
done

echo "→ Workflow, permission and timer tests"
"${PSQL[@]}" -f supabase/tests/10_workflow_tests.sql

echo "→ Concurrency: two editors claim the same project at the same moment"
P7=$("${PSQL[@]}" -Atc "
  select tests.login('00000000-0000-0000-0000-0000000000b1');
  set role authenticated;
  select public.create_project('{\"internal_ref\":\"JV-RACE\",\"title\":\"Race project\",\"client_name\":\"c\",\"original_client_brief\":\"b\",\"deadline\":\"2099-01-01T00:00:00Z\",\"storyboard_required\":false}'::jsonb, true);
" | tail -n1)

claim() {
  # Each claimant holds its transaction open for 1s after claiming so the two
  # attempts are guaranteed to overlap.
  "${PSQL[@]}" -Atc "
    select tests.login('$1');
    set role authenticated;
    begin;
    select pg_sleep_until(to_timestamp($2));
    select public.claim_project('$P7');
    select pg_sleep(1);
    commit;
  " >/dev/null 2>"/tmp/jd_claim_$1.err" && echo ok || echo fail
}
START=$(( $(date +%s) + 2 ))
claim 00000000-0000-0000-0000-0000000000c1 "$START" > /tmp/jd_claim_c1.out &
claim 00000000-0000-0000-0000-0000000000c2 "$START" > /tmp/jd_claim_c2.out &
wait
R1=$(cat /tmp/jd_claim_c1.out); R2=$(cat /tmp/jd_claim_c2.out)
OK=$(printf '%s\n%s\n' "$R1" "$R2" | grep -c '^ok$' || true)
OPEN=$("${PSQL[@]}" -Atc "select count(*) from public.project_assignments where project_id = '$P7' and ended_at is null")
echo "   editor1=$R1 editor2=$R2 open_assignments=$OPEN"
if [[ "$OK" != "1" || "$OPEN" != "1" ]]; then
  echo "CONCURRENCY TEST FAILED"; cat /tmp/jd_claim_*.err; exit 1
fi
grep -h "no longer available" /tmp/jd_claim_*.err >/dev/null || { echo "loser did not get a clean error"; exit 1; }

echo "→ Concurrency: the same editor starts the timer from two tabs at once"
"${PSQL[@]}" -Atc "
  select tests.login('00000000-0000-0000-0000-0000000000c1'); set role authenticated;
  select public.pause_work_session(id) from public.work_sessions where status = 'active';
" >/dev/null
P2=$("${PSQL[@]}" -Atc "select id from public.projects where internal_ref = 'JV-1002'")
tab() {
  "${PSQL[@]}" -Atc "
    select tests.login('00000000-0000-0000-0000-0000000000c1'); set role authenticated;
    select pg_sleep_until(to_timestamp($1));
    select public.start_work_session('$P2');
  " 2>&1 | tail -n1
}
START=$(( $(date +%s) + 2 ))
tab "$START" > /tmp/jd_tab1.out & tab "$START" > /tmp/jd_tab2.out & wait
ACTIVE=$("${PSQL[@]}" -Atc "select count(*) from public.work_sessions where editor_id = '00000000-0000-0000-0000-0000000000c1' and status = 'active'")
INTERVALS=$("${PSQL[@]}" -Atc "select count(*) from public.work_session_intervals where editor_id = '00000000-0000-0000-0000-0000000000c1' and ended_at is null")
echo "   tab1=$(cat /tmp/jd_tab1.out) tab2=$(cat /tmp/jd_tab2.out) active_sessions=$ACTIVE open_intervals=$INTERVALS"
if [[ "$ACTIVE" != "1" || "$INTERVALS" != "1" || "$(cat /tmp/jd_tab1.out)" != "$(cat /tmp/jd_tab2.out)" ]]; then
  echo "TIMER CONCURRENCY TEST FAILED"; exit 1
fi

rm -f /tmp/jd_claim_* /tmp/jd_tab*.out
echo "✓ All database tests passed"
