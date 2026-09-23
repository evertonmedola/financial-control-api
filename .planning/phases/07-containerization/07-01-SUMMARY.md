---
phase: 07-containerization
plan: 01
subsystem: infra
tags: [docker, terminus, health-check, nestjs, docker-compose, typeorm]

# Dependency graph
requires:
  - phase: 06-reports
    provides: Complete domain API (auth, accounts, categories, transactions, transfers, budgets, reports) — the thing being containerized
provides:
  - "GET /health endpoint (@nestjs/terminus + TypeOrmHealthIndicator), unauthenticated, ready for Docker HEALTHCHECK and the future ALB target group"
  - "Multi-stage Dockerfile (builder/runner) producing a clean, non-root, production image (financial-control-api:local)"
  - "docker-compose.yml api service wired alongside the existing db service, depends_on db condition service_healthy"
  - "Verified local-parity round trip (register -> login -> GET /auth/me) through the container's exposed port"
affects: [08-aws-infrastructure, 09-ci-cd]

# Actuals (#2632) — pairs with the plan's estimate to calibrate future estimates.
actuals:
  tokens: 8452
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: ["@nestjs/terminus@^11.1.1"]
  patterns:
    - "Multi-stage Docker build: builder (npm ci -> nest build -> npm prune --omit=dev) / runner (COPY dist + pruned node_modules + package.json only, non-root USER, HEALTHCHECK)"
    - "docker-compose api service overrides DB_HOST/DB_PORT to compose-internal DNS (db:5432), everything else passed through 1:1 from .env"
    - "Docker HEALTHCHECK via Node's built-in http module (no curl/wget in the image), reading process.env.PORT directly inside the inline script"

key-files:
  created:
    - src/health/health.controller.ts
    - src/health/health.module.ts
    - test/health.e2e-spec.ts
    - Dockerfile
    - .dockerignore
  modified:
    - src/app.module.ts
    - docker-compose.yml
    - package.json
    - package-lock.json
    - tsconfig.json
    - .gitignore

key-decisions:
  - "GET /health left unauthenticated by design (no JwtAuthGuard) — required for Docker HEALTHCHECK today and the future ALB target group in Phase 8; Terminus's own HealthCheckResult shape never exposes connection strings/credentials"
  - "tsconfig.json rootDir corrected from \"./\" to \"./src\" so nest build emits a flat dist/main.js, matching both the Dockerfile's `node dist/main` CMD and the pre-existing (never previously exercised) start:prod script"
  - "docker-compose.yml api service ports mapping changed to \"${PORT:-3000}:${PORT:-3000}\" (both sides track the same PORT value injected via environment.PORT) instead of a hardcoded container-side 3000"
  - "Stripped node_modules/typescript and node_modules/ts-node from the runtime image after npm prune — typeorm@1.1.1 lists ts-node as a production (non-dev) dependency for its CLI's TS-migration support, so prune alone doesn't remove it; neither is reachable from the compiled dist/ runtime path"

patterns-established:
  - "Container-internal PORT binding must always track the same env var used for the host-side ports mapping in docker-compose.yml — a hardcoded right-hand side silently breaks whenever PORT diverges from its default"
  - "*.tsbuildinfo excluded from both .dockerignore and .gitignore — TypeScript's incremental build cache is host-specific and must never leak into a build context or version control"

requirements-completed: [INFRA-01]

coverage:
  - id: D1
    description: "GET /health returns 200 with data.status=ok and data.details.database.status=up, proving the containerized API is alive and connected to a real Postgres instance"
    requirement: INFRA-01
    verification:
      - kind: e2e
        ref: "test/health.e2e-spec.ts#GET /health returns 200 with app+database status ok/up"
        status: pass
      - kind: integration
        ref: "docker compose up -d --build && GET http://localhost:<PORT>/health (manual verify chain, Task 1)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Final runtime image contains no /src, no tsconfig.json, and no devDependencies-only packages (jest, typescript) — only dist/, production node_modules, and package.json"
    requirement: INFRA-01
    verification:
      - kind: other
        ref: "docker run --rm financial-control-api:local sh -c \"test -d dist && ! test -d src && ! test -f tsconfig.json && [ ! -e node_modules/.bin/jest ] && [ ! -e node_modules/typescript ]\" (Task 2 verify chain)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Container process runs as a non-root user (uid != 0)"
    requirement: INFRA-01
    verification:
      - kind: other
        ref: "docker compose exec -T api id -u -> 100 (Task 1 and Task 2 verify chains)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Dockerfile declares a HEALTHCHECK instruction (Node inline script against GET /health, no curl/wget installed)"
    requirement: INFRA-01
    verification:
      - kind: other
        ref: "docker inspect --format='{{json .Config.Healthcheck}}' financial-control-api:local -> non-null, contains CMD-SHELL (Task 2 verify chain)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Real HTTP round trip through the container's exposed port (register -> login -> GET /auth/me) succeeds identically to local/non-containerized e2e behavior"
    requirement: INFRA-01
    verification:
      - kind: integration
        ref: "register(201) -> login(200, accessToken) -> GET /auth/me(200, same email) against http://localhost:<PORT> (Task 2 verify chain) -> ROUNDTRIP_OK"
        status: pass
    human_judgment: false

# Metrics
duration: ~55min
completed: 2026-09-23
status: complete
---

# Phase 7 Plan 1: Containerized API Tracer Summary

**NestJS API packaged as a production multi-stage Docker image with a Terminus-backed `/health` endpoint, wired into `docker-compose.yml`, and proven to serve a real auth round trip identically to the local version.**

## Performance

- **Duration:** ~55 min (includes Docker Desktop startup, a stale-lockfile resync, and three build-breaking deviations discovered and fixed during verification)
- **Started:** 2026-09-23T13:00:00Z (approx. — continuation after Task 0 checkpoint approval)
- **Completed:** 2026-09-23T13:33:09Z
- **Tasks:** 2 (Task 0 checkpoint resolved by human approval prior to this continuation)
- **Files modified:** 10 (+ package-lock.json)

## Accomplishments

- Added `GET /health` (`@nestjs/terminus` + `TypeOrmHealthIndicator`), unauthenticated by design, proving both process liveness and real Postgres connectivity
- Built a multi-stage `Dockerfile` (builder/runner) producing `financial-control-api:local` — non-root `nestjs` user, `HEALTHCHECK` instruction, no `/src`/`tsconfig.json`/`jest`/`typescript` in the final image
- Wired a new `api` service into `docker-compose.yml` alongside the existing `db` service (`depends_on: db: condition: service_healthy`)
- Proved a full local-parity round trip (register -> login -> `GET /auth/me`) through the container's exposed port, matching the existing local e2e behavior exactly

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end "containerized API connects to Postgres and reports health" (tracer)** - `8ba606d` (feat)
2. **Task 2: Docker HEALTHCHECK, image hygiene, and local-parity round trip** - `cadda5e` (feat)

_Task 0 (package-legitimacy checkpoint for `@nestjs/terminus`) was a `checkpoint:human-verify` with no code changes of its own — resolved by human approval ("approved") before this continuation began; the dependency was already present in `package.json`/`package-lock.json`/`node_modules` from that prior session._

## Files Created/Modified

- `src/health/health.controller.ts` - `HealthController`, `GET /health` via `HealthCheckService.check([() => db.pingCheck('database')])`
- `src/health/health.module.ts` - `HealthModule`, imports `TerminusModule`
- `test/health.e2e-spec.ts` - in-process e2e proof (no auth/throttler override needed)
- `Dockerfile` - multi-stage build: `builder` (apk build toolchain, `npm ci`, `nest build`, `npm prune --omit=dev`, explicit `typescript`/`ts-node` strip) / `runner` (non-root user, `HEALTHCHECK`, `CMD ["node", "dist/main"]`)
- `.dockerignore` - excludes secrets, host `node_modules`, build artifacts, and `*.tsbuildinfo`
- `docker-compose.yml` - new `api` service (`image: financial-control-api:local`, `DB_HOST=db`/`DB_PORT=5432` override, `ports: "${PORT:-3000}:${PORT:-3000}"`)
- `src/app.module.ts` - `HealthModule` added to `imports`
- `package.json` / `package-lock.json` - `@nestjs/terminus@^11.1.1` added; lock resynced against the `node:24-alpine` image's bundled npm
- `tsconfig.json` - `rootDir` corrected from `"./"` to `"./src"` (flat `dist/main.js` output)
- `.gitignore` - added `*.tsbuildinfo`

## Decisions Made

- `/health` stays unauthenticated (no `JwtAuthGuard`) — required for both Docker's `HEALTHCHECK` today and the ALB target group in Phase 8; Terminus's own response shape never exposes infra/credential details (T-07-03)
- `docker-compose.yml`'s `api` service `ports` mapping uses `${PORT:-3000}` on both sides, not a hardcoded container-side `3000` — keeps the host mapping in sync with whatever `PORT` value is actually injected into the container's environment
- Explicitly strip `node_modules/typescript` and `node_modules/ts-node` from the runtime image after `npm prune --omit=dev`, since `typeorm@1.1.1` pulls `ts-node` in as a production dependency (for its CLI's TS-migration support) that `npm prune` alone won't remove, and neither package is reachable from the compiled `dist/` runtime path

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] package-lock.json out of sync with the `node:24-alpine` image's npm version**
- **Found during:** Task 1, first `docker compose up -d --build`
- **Issue:** `npm ci` failed inside the `builder` stage with `EUSAGE` — the lock file (generated against npm 11.6 on the Windows host) was missing `@emnapi/core@1.11.3`/`@emnapi/runtime@1.11.3` entries that npm 11.19 (bundled with `node:24-alpine`) requires to resolve an optional peer dependency of a dev-only `@nestjs/cli` transitive package
- **Fix:** Regenerated `package-lock.json` via `npm install --package-lock-only` run inside a throwaway `node:24-alpine` container (same npm version as the builder stage), then verified `npm ci --dry-run` succeeds in that same image before rebuilding
- **Files modified:** `package-lock.json`
- **Verification:** `npm ci` succeeds inside `node:24-alpine`; full local unit suite (95/95) and `test:e2e -- health.e2e-spec.ts` still pass
- **Committed in:** `8ba606d` (Task 1 commit)

**2. [Rule 1 - Bug] `tsconfig.json`'s `rootDir: "./"` caused `nest build` to emit `dist/src/main.js` instead of `dist/main.js`**
- **Found during:** Task 1, second `docker compose up -d --build` attempt
- **Issue:** Container crash-looped with `Error: Cannot find module '/app/dist/main'` — the pre-existing `rootDir: "./"` setting preserved the `src/` prefix in the build output, silently breaking both the Dockerfile's `CMD ["node", "dist/main"]` (as literally specified in the plan, mirroring `start:prod`) and the `start:prod` script itself, which had never actually been exercised before this phase
- **Fix:** Changed `tsconfig.json`'s `rootDir` from `"./"` to `"./src"`, producing a flat `dist/main.js`
- **Files modified:** `tsconfig.json`
- **Verification:** Local `npm run build` produces `dist/main.js`; `node dist/main` resolves the entrypoint (fails only on DB connectivity in the smoke check, as expected outside Docker); full local unit suite (95/95) and `test:e2e -- health.e2e-spec.ts` still pass after the change
- **Committed in:** `8ba606d` (Task 1 commit)

**3. [Rule 3 - Blocking] Stale `tsconfig.build.tsbuildinfo` leaking into the Docker build context broke incremental compilation inside the container**
- **Found during:** Task 1, third `docker compose up -d --build` attempt (after the `rootDir` fix)
- **Issue:** Even with the corrected `rootDir`, the container still crash-looped with the same `Cannot find module '/app/dist/main'` error. Investigation showed only `database/migrations/*.js` were emitted inside the image — the host's `tsconfig.build.tsbuildinfo` (TypeScript's incremental-build cache, generated locally with the old `rootDir` value and not excluded by the original `.dockerignore`) was copied into the build context via `COPY . .`, confusing `tsc`'s incremental compiler into believing most output files were already up-to-date and skipping their emission
- **Fix:** Added `*.tsbuildinfo` to `.dockerignore` (and to `.gitignore`, since it's a generated build artifact that shouldn't be tracked at all); rebuilt with `--no-cache` to confirm a clean run
- **Files modified:** `.dockerignore`, `.gitignore`
- **Verification:** `docker run --rm financial-control-api:local sh -c "ls /app/dist/*.js"` shows `app.module.js`/`main.js` present; full Task 1 verify chain (health check body, non-root uid) passes
- **Committed in:** `8ba606d` (Task 1 commit)

**4. [Rule 1 - Bug] `docker-compose.yml`'s `ports: "${PORT:-3000}:3000"` breaks whenever `PORT` diverges from `3000`**
- **Found during:** Task 1 verification — this machine already has an unrelated project's container (`medolai-api`) bound to host port 3000 (a pre-existing, documented condition — see STATE.md's "Local dev note"), so `docker compose up` failed with `port is already allocated`. Since the container's actual internal bind port tracks the `PORT` env var injected via `environment.PORT` (not the literal `3000`), overriding `PORT` for verification without also fixing the compose file's hardcoded container-side port would have caused a silent host<->container port mismatch
- **Fix:** Changed the `ports` mapping to `"${PORT:-3000}:${PORT:-3000}"` so both sides always track the same runtime value; verified with a per-invocation `PORT=3010` override (shell env var, never touching `.env` or the unrelated container) for the duration of local verification only
- **Files modified:** `docker-compose.yml`
- **Verification:** Full Task 1 and Task 2 verify chains pass against `http://localhost:3010` with `PORT=3010` overridden at invocation time; `.env`'s own `PORT` value (used by normal, non-conflicting local dev) is untouched
- **Committed in:** `8ba606d` (Task 1 commit)

**5. [Rule 1 - Bug] `typescript`/`ts-node` survive `npm prune --omit=dev`, violating ROADMAP Success Criterion #1**
- **Found during:** Task 2's image-hygiene check
- **Issue:** `docker run --rm financial-control-api:local sh -c "... [ ! -e node_modules/typescript ]"` failed — `typeorm@1.1.1` lists `ts-node` as a regular (non-dev) dependency of its own (for CLI-driven TS migration support), which transitively pulls in `typescript`; `npm prune --omit=dev` correctly treats both as production dependencies and leaves them in place
- **Fix:** Added `RUN rm -rf node_modules/typescript node_modules/ts-node` immediately after `npm prune --omit=dev` in the Dockerfile — neither package is ever imported by the compiled `dist/` runtime path (the TypeORM CLI/migration commands that need them are never run inside this container, per INFRA-04)
- **Files modified:** `Dockerfile`
- **Verification:** Image-hygiene check passes; app still boots and serves `/health` and the full register->login->me round trip identically after the strip
- **Committed in:** `cadda5e` (Task 2 commit)

---

**Total deviations:** 5 auto-fixed (2 Rule 3 blocking, 3 Rule 1 bug)
**Impact on plan:** All five were required for the Dockerfile/compose stack to build and run at all, or for the image to actually meet the phase's own stated success criteria. No scope creep — every fix stayed inside `Dockerfile`, `docker-compose.yml`, `tsconfig.json`, `.dockerignore`, `.gitignore`, or `package-lock.json`; no application/domain code was touched.

## Issues Encountered

- Docker Desktop was not running at session start (required to launch and wait ~2 min for readiness before any `docker` command would work) — not a deviation from the plan, just environment setup.
- Host port 3000 is occupied by an unrelated personal project's container (`medolai-api`) on this machine — pre-existing, documented in STATE.md's "Local dev note". Worked around via a per-invocation `PORT=3010` shell override (see Deviation 4) rather than stopping the unrelated container, which the environment's own workload-isolation guard correctly refused to allow.

## User Setup Required

None — no external service configuration required. `.env` already existed and satisfied Task 1's precondition; no new environment variables were introduced.

## Next Phase Readiness

- `financial-control-api:local` is a proven, production-shaped image (non-root, no dev deps/source, `HEALTHCHECK` wired) ready for Plan 07-02's further hardening and, eventually, Phase 8's ECR push.
- `docker-compose.yml`'s `api` service is the reference shape for how the container expects its environment (discrete `DB_*`/`JWT_*`/`ALLOWED_ORIGINS` vars) — Phase 8's ECS task definition should mirror this same variable set via Secrets Manager `valueFrom` injection.
- No blockers for Phase 8. One non-blocking environment note carried forward: this dev machine's host port 3000 conflicts with an unrelated project's container: any future local Docker verification on this machine should expect to override `PORT` per-invocation rather than assume port 3000 is free.

---
*Phase: 07-containerization*
*Completed: 2026-09-23*

## Self-Check: PASSED

All created files verified present on disk (`src/health/health.controller.ts`, `src/health/health.module.ts`, `test/health.e2e-spec.ts`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `src/app.module.ts`, `tsconfig.json`). Both task commits (`8ba606d`, `cadda5e`) verified present in git history.
