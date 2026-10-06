#!/usr/bin/env bash
# Fast local e2e run against a throwaway PostgreSQL 16 container.
# Usage: bash infra/scripts/e2e-local.sh [jest args, e.g. a test name pattern]
#
# What it does, in order: starts postgres:16 on a free 127.0.0.1 port (chosen by
# Docker, so it cannot collide with the dev DB or another run) -> exports the
# env contract INLINE -> npm run migration:run -> npm run test:e2e --runInBand ->
# removes the container on every exit path (success, failure, Ctrl-C).
#
# Never reads or writes a .env and never touches the dev database: every DB_*
# variable is overridden below, and process env wins over any .env file.
#
# Difference from ci-gate-local.sh: that script reproduces the whole Actions job
# from a CLEAN CLONE of committed HEAD (npm ci, lint, audit, unit tests, e2e) and
# is the pre-push gate. This one tests the CURRENT working tree (uncommitted
# changes included, existing node_modules), so it is the quick dev loop.
#
# Serial on purpose: the suites share one database. Parallel runs were seen to
# fail intermittently (probable cause, not confirmed: workers contending for the
# shared DB), so --runInBand is passed explicitly in addition to maxWorkers: 1
# in test/jest-e2e.json.
set -euo pipefail

CONTAINER="fc-e2e-local-$$"
LOG=""
REPO="$(git rev-parse --show-toplevel)"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  if [ -n "$LOG" ] && [ -f "$LOG" ]; then rm -f "$LOG" || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

fail() { echo "FAIL: $*" >&2; exit 1; }

cd "$REPO"
[ -d node_modules ] || fail "node_modules missing in $REPO (run npm ci, or link it into this worktree)"
command -v docker >/dev/null 2>&1 || fail "docker not found on PATH"

echo "==> starting throwaway postgres:16 (random free port on 127.0.0.1)"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=financial_control_e2e \
  -p 127.0.0.1::5432 postgres:16 >/dev/null

PG_PORT="$(docker port "$CONTAINER" 5432/tcp | head -n 1)"
PG_PORT="${PG_PORT##*:}"
[ -n "$PG_PORT" ] || fail "could not determine the published postgres port"
echo "    container=$CONTAINER port=$PG_PORT"

echo "==> waiting for postgres readiness (max 60s)"
# -h 127.0.0.1: the image's init phase runs a temporary server that listens on
# the unix socket only, so a TCP probe only succeeds for the real server.
ready=0
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U e2e -d financial_control_e2e >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[ "$ready" -eq 1 ] || fail "postgres did not become ready within 60 seconds"

echo "==> exporting env contract (inline, no .env)"
export NODE_ENV=test
export PORT=3000
export DB_HOST=127.0.0.1
export DB_PORT="$PG_PORT"
export DB_USER=e2e
export DB_PASSWORD=e2e
export DB_NAME=financial_control_e2e
export JWT_ACCESS_SECRET=e2e-only-throwaway-jwt-secret-not-real-0123456789
export JWT_ACCESS_EXPIRES_IN=15m
export JWT_REFRESH_EXPIRES_IN=7d
export ALLOWED_ORIGINS=http://localhost:3000
unset PGSSLMODE

echo "==> npm run migration:run"
LOG="$(mktemp)"
if ! npm run migration:run >"$LOG" 2>&1; then
  tail -n 40 "$LOG" >&2
  fail "migrations failed"
fi
echo "    $(sed 's/\x1b\[[0-9;]*m//g' "$LOG" | grep -c 'has been executed successfully') migration(s) executed"

echo "==> npm run test:e2e -- --runInBand $*"
npm run test:e2e -- --runInBand "$@"

echo "E2E_LOCAL_OK"
