---
phase: 07-containerization
fixed_at: 2026-09-23T00:00:00Z
review_path: .planning/phases/07-containerization/07-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 5
skipped: 1
status: partial
---

# Phase 07: Code Review Fix Report

**Fixed at:** 2026-09-23
**Source review:** .planning/phases/07-containerization/07-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6
- Fixed: 5
- Skipped: 1

Verification ran in the main checkout (`workflow.use_worktrees=false`): `docker compose config -q` OK, `npm run build` OK, `npm test` 95/95, `npm run test:e2e` 169/169.

## Fixed Issues

### WR-01: No graceful shutdown

**Files modified:** `src/main.ts`, `docker-compose.yml`
**Commits:** 6b9524e (enableShutdownHooks), 631b019 (compose `init: true`)
**Applied fix:** `app.enableShutdownHooks()` in bootstrap; `init: true` on the compose api service. tini not added to the image (the ECS equivalent, `initProcessEnabled`, belongs to Phase 8; with shutdown hooks Node now handles SIGTERM itself).

### WR-02: /health throttled

**Files modified:** `src/health/health.controller.ts`
**Commit:** cae9497
**Applied fix:** `@SkipThrottle()` on `HealthController`.

### WR-03: Postgres published on all interfaces

**Files modified:** `docker-compose.yml`
**Commit:** 631b019
**Applied fix:** bound to `127.0.0.1:${DB_PORT:-5432}:5432`.

### WR-04: Compose env handling

**Files modified:** `docker-compose.yml`
**Commit:** 631b019
**Applied fix:** required vars use `${VAR:?message}` (db, healthcheck, api); `PORT: ${PORT:-3000}`; `NODE_ENV: production` set explicitly. Requires human verification that `.env` always defines the required vars (a `docker compose config` with the current `.env` passes).

### WR-05: Mutable base image tags

**Files modified:** `Dockerfile`
**Commit:** 2ef2a95
**Applied fix:** `ARG NODE_IMAGE=node:24-alpine` reused in both `FROM` lines so builder/runner cannot diverge; a digest can be pinned via `--build-arg`. The default is still a floating tag and `postgres:16` was left unchanged (digest pinning needs registry lookups; deferred to Phase 8 CI).

## Skipped Issues

### WR-04b: Compose stack starts the API against an empty schema

**File:** `docker-compose.yml:19-50`, `src/app.module.ts:50`
**Reason:** Migrations-in-container is a deliberate out-of-scope decision (07-CONTEXT.md / INFRA-04). Adding a migrate service or a migrations health indicator is a design change, not a targeted fix.
**Original issue:** The container never runs migrations, so a fresh `docker compose up` yields a "healthy" API whose first real request fails on missing relations.

---

_Fixed: 2026-09-23_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
