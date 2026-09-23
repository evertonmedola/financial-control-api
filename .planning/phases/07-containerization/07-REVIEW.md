---
phase: 07-containerization
reviewed: 2026-09-23T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - .dockerignore
  - .gitignore
  - Dockerfile
  - docker-compose.yml
  - package.json
  - src/app.module.ts
  - src/health/health.controller.ts
  - src/health/health.module.ts
  - test/health.e2e-spec.ts
  - tsconfig.json
findings:
  critical: 0
  warning: 6
  info: 3
  total: 9
status: issues_found
---

# Phase 07: Code Review Report

**Reviewed:** 2026-09-23
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

The multi-stage Dockerfile, non-root user, and Terminus health endpoint are broadly sound. The problems are operational: the container does not shut down gracefully, /health is subject to the global rate limiter, and compose publishes Postgres to all host interfaces. Compose also has env handling gaps. No security blockers were found.

## Warnings

### WR-01: No graceful shutdown; Node runs as PID 1 and ignores SIGTERM

**File:** `Dockerfile:63` (and `src/main.ts:37-42`)
**Issue:** `CMD ["node","dist/main"]` makes Node PID 1 with no init. `bootstrap()` never calls `app.enableShutdownHooks()` and registers no SIGTERM handler. On PID 1 the kernel ignores signals that have no handler, so `docker stop` and ECS task stops (Phase 8) hang until SIGKILL (10s and 30s respectively). In-flight requests are dropped and the TypeORM pool is not closed.
**Fix:** Call `app.enableShutdownHooks()` in `bootstrap()`. Also add `init: true` to the compose `api` service, or install tini in the image and use `ENTRYPOINT ["/sbin/tini","--"]`.

### WR-02: /health is covered by the global ThrottlerGuard

**File:** `src/health/health.controller.ts:13`, `src/app.module.ts:33-35,79-80`
**Issue:** The global guard limits every route to 100 req/60s per IP. Behind the Phase 8 ALB, health probes from several ALB nodes, plus any monitoring, can share source IPs. Once the limit is exceeded, /health returns 429 and the target is marked unhealthy, which causes a restart loop under load. A health endpoint must not be throttled.
**Fix:**
```ts
import { SkipThrottle } from '@nestjs/throttler';
@SkipThrottle()
@Controller('health')
```

### WR-03: Postgres published on all host interfaces

**File:** `docker-compose.yml:9-10`
**Issue:** `"${DB_PORT:-5432}:5432"` binds to 0.0.0.0. Anyone on the LAN can reach the DB, which is guarded only by a local password (`change-me-locally` in `.env.example`). This conflicts with the project's stated no-public-DB stance. The API reaches the DB over compose DNS and does not need the host mapping.
**Fix:** Bind to loopback: `"127.0.0.1:${DB_PORT:-5432}:5432"`.

### WR-04: Compose does not fail fast on missing env vars, and PORT handling is inconsistent

**File:** `docker-compose.yml:6-8,14,26-27,47`
**Issue:** An unset `${DB_PASSWORD}` interpolates to an empty string. The postgres image then fails to initialize, and the `pg_isready` healthcheck gets malformed arguments. `ports` falls back to `${PORT:-3000}`, but `environment.PORT: ${PORT}` becomes empty when PORT is unset. Zod's `.default(3000)` may not apply to an empty string (`z.coerce.number()` turns `''` into 0, which fails `.positive()`), so the app crashes while the mapping still targets 3000. `NODE_ENV: ${NODE_ENV}` can also override the image's `production` with `development` from `.env`.
**Fix:** Use `${VAR:?message}` for required vars. Use `PORT: ${PORT:-3000}` in `environment`. Set `NODE_ENV: production` explicitly, or drop the override.

### WR-04b: Compose stack starts the API against an empty schema

**File:** `docker-compose.yml:19-50`, `src/app.module.ts:50`
**Issue:** `synchronize: false` and the container never runs migrations (by design, per the Dockerfile comment). A fresh `docker compose up` gives a "healthy" container, because `pingCheck` only runs `SELECT 1`, whose first real request fails with relation-does-not-exist errors. The healthcheck does not prove the app is usable.
**Fix:** Document and provide a one-shot `migrate` compose service or command. Optionally add a `MigrationsHealthIndicator`.

### WR-05: Mutable base image tags; unpinned reproducibility

**File:** `Dockerfile:5,36`, `docker-compose.yml:3`
**Issue:** `node:24-alpine` and `postgres:16` float. The two stages can resolve to different digests within one build. That breaks the native-ABI parity that the stack notes call out for argon2. It also conflicts with the project's immutable-tag stance.
**Fix:** Pin the same minor version and digest for both stages, e.g. `node:24.11-alpine3.22@sha256:...`. Alternatively define an `ARG NODE_IMAGE` and reuse it in both `FROM` lines.

## Info

### IN-01: .dockerignore omits .planning, .claude, .gsd, .github

**File:** `.dockerignore:1-21`
**Issue:** `COPY . .` in the builder copies internal planning and agent-config directories, including `.claude/settings.local.json`. They are not in the runner stage, but they bloat the build context and sit in builder layers and the build cache. `.env*` is correctly excluded.
**Fix:** Add `.planning`, `.claude`, `.gsd`, `.github`, `docker-compose*.yml`.

### IN-02: Health e2e test covers only the happy path

**File:** `test/health.e2e-spec.ts:42-50`
**Issue:** There is no assertion for the DB-down case (should be 503) or for the `Cache`/throttle behavior. The header comment says "at most two requests" but only one is made. The test also silently depends on a live Postgres and the env vars.
**Fix:** Add a test that overrides `TypeOrmHealthIndicator.pingCheck` to fail and expects 503. Correct the comment.

### IN-03: Toolchain drift and fragile build-cache workaround

**File:** `package.json:60`, `tsconfig.json:17`, `.dockerignore:14-21`
**Issue:** `@types/node ^22` is used while the runtime is Node 24. `incremental: true` combined with `deleteOutDir` caused the tsbuildinfo emission bug, which is now patched only via `.dockerignore`. Local `nest build` runs remain susceptible to it.
**Fix:** Bump `@types/node` to `^24`. Set `"incremental": false` in `tsconfig.build.json` (or a `tsBuildInfoFile` inside `dist`) to remove the root cause.

---

_Reviewed: 2026-09-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
