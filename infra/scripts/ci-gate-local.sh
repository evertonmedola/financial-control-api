#!/usr/bin/env bash
# Local reproduction of the Actions `test` job (Phase 9, D-04). Run from anywhere in the repo.
# Proves, from a CLEAN CLONE of committed HEAD (no .env, no node_modules) against a
# throwaway PostgreSQL 16 container, that this exact sequence is green:
#   npm ci -> lint:check -> npm audit (high, prod only) -> unit tests
#   -> migration:run (explicit CLI, synchronize stays false) -> e2e
# Prints CI_GATE_OK on success.
# Env: CI_GATE_PG_PORT (default 55432) host port, published on 127.0.0.1 only.
# Never reads .env and never prints a secret. The container and temp dir are
# removed by a trap on every exit path.
set -euo pipefail

CONTAINER=fc-ci-gate-pg
PG_PORT="${CI_GATE_PG_PORT:-55432}"
REPO="$(git rev-parse --show-toplevel)"
TMP=""

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  if [ -n "$TMP" ] && [ -d "$TMP" ]; then rm -rf "$TMP" || true; fi
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

echo "==> checking for uncommitted tracked changes"
# .planning/ and .claude/ hold workflow metadata that is never part of the app
# or its tests, so they are ignored here; any other tracked change is fatal.
if ! git -C "$REPO" diff --quiet HEAD -- . ':!.planning' ':!.claude'; then
  git -C "$REPO" status --short -- . ':!.planning' ':!.claude' >&2
  fail "tracked files have uncommitted changes; the clone would not contain them (commit first)"
fi

echo "==> starting throwaway postgres:16 on 127.0.0.1:${PG_PORT}"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=financial_control \
  -p "127.0.0.1:${PG_PORT}:5432" postgres:16 >/dev/null

echo "==> waiting for postgres readiness (max 60s)"
ready=0
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U ci -d financial_control >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[ "$ready" -eq 1 ] || fail "postgres did not become ready within 60 seconds"

echo "==> cloning committed HEAD into a temp dir"
TMP="$(mktemp -d)"
git -c core.autocrlf=false clone -q "$REPO" "$TMP/repo"
cd "$TMP/repo"
[ ! -f .env ] || fail "clone unexpectedly contains a .env file"

echo "==> exporting CI env contract"
export NODE_ENV=test
export PORT=3000
export DB_HOST=localhost
export DB_PORT="$PG_PORT"
export DB_USER=ci
export DB_PASSWORD=ci
export DB_NAME=financial_control
export JWT_ACCESS_SECRET=ci-only-throwaway-jwt-secret-not-real-0123456789
export JWT_ACCESS_EXPIRES_IN=15m
export JWT_REFRESH_EXPIRES_IN=7d
export ALLOWED_ORIGINS=http://localhost:3000
unset PGSSLMODE

echo "==> npm ci"
npm ci
echo "==> npm run lint:check"
npm run lint:check
echo "==> npm audit --omit=dev --audit-level=high"
npm audit --omit=dev --audit-level=high
echo "==> npm test (unit)"
npm test
echo "==> npm run migration:run"
npm run migration:run
echo "==> npm run test:e2e"
npm run test:e2e

echo "CI_GATE_OK"
