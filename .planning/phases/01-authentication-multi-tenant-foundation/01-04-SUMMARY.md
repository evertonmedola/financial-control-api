---
phase: 01-authentication-multi-tenant-foundation
plan: 04
subsystem: auth
tags: [nestjs, throttler, rate-limiting, security, testing]

requires:
  - phase: 01-authentication-multi-tenant-foundation (plan 01-03)
    provides: "POST /auth/login, POST /auth/register, GET /auth/me, POST /auth/refresh, POST /auth/logout endpoints to apply throttling to"

provides:
  - "Global ThrottlerModule.forRoot({ttl: seconds(60), limit: 100}) + APP_GUARD ThrottlerGuard in AppModule — covers every current and future endpoint in every later phase by default"
  - "@Throttle({limit: 5, ttl: seconds(60)}) on POST /auth/login (T-01-11)"
  - "@Throttle({limit: 3, ttl: seconds(60)}) on POST /auth/register (T-01-12)"
  - "ThrottlerGuard registered as a normal provider + useExisting alias onto APP_GUARD (not a bare useClass) so it's addressable by TestingModuleBuilder.overrideProvider() in e2e tests — the pattern every later phase's e2e suite will need if it wants to exempt itself from global throttling"

affects:
  - "Phase 2+ (Accounts, Categories, Transactions, Budgets, Reports) — every new endpoint is automatically covered by the 100/60s global default unless it declares its own @Throttle() override; any e2e suite for those phases making many rapid calls from one shared app instance will need the same overrideProvider(ThrottlerGuard) isolation pattern established here"

actuals:
  tokens: 2574   # chars/4 over git diff fedfbc4..HEAD, excluding .planning/ and package-lock.json
  tasks: 2
  commits: 3
plan_head_before: fedfbc4bfe061260f31862e24fd99b3dab142840

tech-stack:
  added: ["@nestjs/throttler 6.5.0"]
  patterns:
    - "Global rate-limit default (100/60s via ThrottlerModule.forRoot + APP_GUARD) with tighter per-route @Throttle() overrides on sensitive endpoints — the pattern for every future endpoint needing custom limits"
    - "Register globally-bound enhancers (APP_GUARD/APP_INTERCEPTOR/APP_PIPE/APP_FILTER) as a normal provider + useExisting alias, not a bare useClass, whenever the enhancer needs to be overridable in e2e tests — Nest stores bare useClass global-enhancer providers under an internal randomly-generated DI token every compile(), which TestingModuleBuilder.overrideGuard()/overrideProvider() cannot address"
    - "e2e suites needing to prove real throttling behavior build a second, separate, un-overridden TestingModule/app instance dedicated to that describe block, rather than sharing the main app's throttler storage with the rest of the file"

key-files:
  created: []
  modified:
    - package.json
    - src/app.module.ts
    - src/auth/auth.controller.ts
    - test/auth.e2e-spec.ts

key-decisions:
  - "ThrottlerGuard registered as `ThrottlerGuard` (plain provider) + `{ provide: APP_GUARD, useExisting: ThrottlerGuard }` instead of the more common `{ provide: APP_GUARD, useClass: ThrottlerGuard }` shorthand — required to make the global guard addressable by TestingModuleBuilder.overrideProvider() in e2e tests; behaviorally identical in production (same singleton instance, still applied globally)"
  - "Rate-limiting e2e tests run against a dedicated, separately-compiled app instance (real ThrottlerGuard, no override) rather than the main shared `app` instance, which gets a no-op ThrottlerGuard override so ~20 pre-existing register/login calls elsewhere in the file don't trip the new 3/5-per-60s limits"
  - "Login throttle counts failed attempts too (ThrottlerGuard runs before the route handler as a global guard) — the RED test deliberately uses a wrong password on every attempt, matching a real credential-stuffing scenario"

patterns-established:
  - "Any later phase's e2e suite that needs to prove real @Throttle() behavior should follow this plan's two-app pattern: main shared app gets ThrottlerGuard overridden to a no-op; a small, dedicated second TestingModule (unmodified AppModule) is compiled just for the throttling-specific describe block"

requirements-completed: [AUTH-01, AUTH-02]

coverage:
  - id: D1
    description: "POST /auth/login returns 429 after 5 attempts within 60 seconds from the same client (6th attempt), including failed-credential attempts"
    requirement: "AUTH-02"
    verification:
      - kind: e2e
        ref: "test/auth.e2e-spec.ts#rate limiting (throttler) > returns 429 on the 6th POST /auth/login within the window (limit: 5/60s)"
        status: pass
    human_judgment: false
  - id: D2
    description: "POST /auth/register returns 429 after 3 registrations within 60 seconds from the same client (4th attempt) — not deferred or forgotten relative to login, per 01-RESEARCH.md Pitfall 3"
    requirement: "AUTH-01"
    verification:
      - kind: e2e
        ref: "test/auth.e2e-spec.ts#rate limiting (throttler) > returns 429 on the 4th POST /auth/register within the window (limit: 3/60s)"
        status: pass
    human_judgment: false
  - id: D3
    description: "An unrelated endpoint (GET /auth/me) is governed by the global 100/60s default, not the tighter login/register limits — 10 rapid calls never return 429"
    verification:
      - kind: e2e
        ref: "test/auth.e2e-spec.ts#rate limiting (throttler) > an unrelated endpoint (GET /auth/me) is governed by the global default limit, not the tighter login/register limits"
        status: pass
    human_judgment: false
  - id: D4
    description: "Adding rate limiting does not regress any of the ~20 pre-existing register/login e2e calls elsewhere in the file (response envelope, refresh rotation, reuse detection, logout, etc.) — full suite passes twice consecutively, no order-dependent flakiness"
    verification:
      - kind: e2e
        ref: "npm run test:e2e -- auth.e2e-spec.ts (full file, run twice consecutively: 20/20 both times)"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-09-12
status: complete
---

# Phase 1 Plan 4: Auth Rate Limiting Summary

**Global 100/60s default + tighter 5/60s (login) and 3/60s (register) `@nestjs/throttler` limits on both public auth endpoints, proven via dedicated 429 e2e tests isolated from the rest of the suite.**

## Performance
- **Duration:** ~35 min
- **Started:** 2026-09-12T10:40:00-03:00 (approx, first RED test written)
- **Completed:** 2026-09-12T10:51:09-03:00
- **Tasks:** 2 completed
- **Files modified:** 4 (package.json, src/app.module.ts, src/auth/auth.controller.ts, test/auth.e2e-spec.ts)

## Accomplishments
- Installed `@nestjs/throttler@^6.5.0` (verified legitimate and peer-compatible against `@nestjs/core@^11.2.3` via npm registry before installing)
- Global `ThrottlerModule.forRoot({ttl: seconds(60), limit: 100})` + `APP_GUARD` registered in `AppModule` — every current and future endpoint in every later phase is covered by a sane default unless it opts into a tighter override, using the `seconds()` helper throughout to avoid the documented v6 ttl-unit (ms vs s) trap
- `@Throttle({limit: 5, ttl: seconds(60)})` on `POST /auth/login` and `@Throttle({limit: 3, ttl: seconds(60)})` on `POST /auth/register`, added in the same task/commit per `01-RESEARCH.md` Pitfall 3's explicit warning against forgetting the registration endpoint
- Both limits proven via dedicated e2e tests against a separate, un-overridden app instance (6th login attempt → 429; 4th register attempt → 429; `GET /auth/me` stays governed by the looser 100/60s global default across 10 rapid calls)
- Full `auth.e2e-spec.ts` suite (20 tests: 17 pre-existing + 3 new) passes twice consecutively with no flakiness, after isolating the pre-existing tests' shared app instance from real throttling

## Task Commits
1. **Task 1: Global ThrottlerModule + per-route limits on login/register** - `ff57638` (test — RED) + `679a4bb` (feat — GREEN)
2. **Task 2: Full regression pass — confirm rate limiting doesn't break the existing suite** - `d03d1ca` (test)

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `package.json` — added `@nestjs/throttler@^6.5.0`
- `src/app.module.ts` — `ThrottlerModule.forRoot()` global default; `ThrottlerGuard` registered as a plain provider + `useExisting` alias onto `APP_GUARD` (not a bare `useClass`) so it's addressable by e2e test overrides
- `src/auth/auth.controller.ts` — `@Throttle()` overrides on `login()` (5/60s) and `register()` (3/60s)
- `test/auth.e2e-spec.ts` — new `rate limiting (throttler)` describe block (dedicated app instance, real guard); main shared `app`'s `beforeAll` now overrides `ThrottlerGuard` to a no-op via `overrideProvider()` so the ~20 pre-existing register/login calls elsewhere in the file are unaffected

## Decisions Made
- `ThrottlerGuard` registered as `ThrottlerGuard` (plain provider) + `{ provide: APP_GUARD, useExisting: ThrottlerGuard }`, not the more common bare `{ provide: APP_GUARD, useClass: ThrottlerGuard }` — required so the guard is addressable by `TestingModuleBuilder.overrideProvider()` in e2e tests. Production behavior is unchanged: same singleton instance, still applied globally via the same guard chain.
- Rate-limiting tests run against a second, separately-compiled `TestingModule`/app (real `AppModule`, unmodified `ThrottlerGuard`) instead of the shared `app` instance the rest of the file uses — keeps its throttler storage fully isolated from the ~20 other register/login calls in the file.
- The login-throttle test deliberately sends a wrong password on every attempt — `ThrottlerGuard` runs as a global guard before the route handler, so failed-credential attempts count toward the throttle bucket exactly like a real credential-stuffing attempt would.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `TestingModuleBuilder.overrideGuard()`/`overrideProvider()` cannot target a bare `{ provide: APP_GUARD, useClass: ThrottlerGuard }` registration**
- **Found during:** Task 2 (isolating the pre-existing tests from real throttling)
- **Issue:** Task 1's straightforward `{ provide: APP_GUARD, useClass: ThrottlerGuard }` (matching `01-RESEARCH.md`'s own code example) is exactly what NestJS's own docs show — but it made the global guard impossible to override in tests. Traced into `@nestjs/core`'s scanner source: providers whose `provide` token is `APP_GUARD`/`APP_INTERCEPTOR`/`APP_PIPE`/`APP_FILTER` are re-registered under an internal token of the shape `` `${APP_GUARD} (UUID: ${uuid})` ``, and that UUID is generated via `UuidFactory.get()` in **Random** mode by default (only `Deterministic` when `compile({snapshot: true})` is passed, which this project doesn't use) — so the actual DI token is unknowable in advance from userland. Both `overrideGuard(ThrottlerGuard)` and `overrideGuard(APP_GUARD)` were tried first and silently no-op (no error, override recorded but never matches a real provider — confirmed by re-running the full suite and seeing identical 429 failures both times).
- **Fix:** Changed `app.module.ts` to register `ThrottlerGuard` as a normal provider (stored under its own stable class token) plus `{ provide: APP_GUARD, useExisting: ThrottlerGuard }` (an alias, not a new instance) — functionally identical in production, but now `overrideProvider(ThrottlerGuard)` in the test file correctly replaces the instance the alias resolves to.
- **Files modified:** `src/app.module.ts`, `test/auth.e2e-spec.ts`
- **Verification:** Full `auth.e2e-spec.ts` suite went from 13 failed/7 passed (with the bare `useClass` registration) to 20/20 passed, confirmed twice consecutively
- **Commit:** `d03d1ca`

**Total deviations:** 1 auto-fixed (Rule 3 — blocking issue, discovered mid-Task-2, required to complete Task 2's stated goal at all).
**Impact:** Necessary for correctness of the test isolation strategy; no scope creep beyond making the already-planned global guard testable. No production runtime behavior changed (same singleton, same global application).

## Issues Encountered
- Docker Desktop was not running at session start; started it and polled until the daemon was ready (same pattern as prior plans in this phase) before running any e2e tests. The project's Postgres container (`financialcontrol-db-1`, port 5433) was already present from a prior session and came up healthy.
- `npm audit` still reports the same 5 high-severity advisories from `multer` (transitive via `@nestjs/platform-express`), unchanged from `01-01-SUMMARY.md`'s prior documentation — not actionable without either an upstream fix or downgrading `@nestjs/core` below the project's pinned `^11.2.3`, neither of which is this plan's call to make.

## Security Review Checklist (security-review skill)

✅ Applied:
- Rate limiting configurado em endpoints públicos (login, cadastro) — `@Throttle()` on both `POST /auth/login` (5/60s) and `POST /auth/register` (3/60s), plus a global 100/60s default covering every other endpoint
- Nenhum segredo, connection string ou chave de API hardcoded — no new secrets introduced this plan
- Toda query usa TypeORM parametrizado — no new queries introduced this plan

⚠️ Attention: none — this plan's scope is limited to rate limiting; the rest of the checklist (DTO validation, IDOR checks, CORS, error messages, password hashing, JWT expiration) was already addressed in Plans 01-01 through 01-03 and is unaffected here.

## User Setup Required
None — no external service configuration required. Local dev requires `docker compose up -d db` (already validated) before running `npm run test:e2e`.

## Next Phase Readiness
- Phase 1 (Authentication & Multi-Tenant Foundation) is now complete: all four plans (01-01 walking skeleton, 01-02 transport hardening, 01-03 refresh token rotation, 01-04 rate limiting) delivered AUTH-01..04 in full, including D-06's rate-limiting requirement on both public auth endpoints.
- The global `ThrottlerModule`/`APP_GUARD` registration is now in place for every future phase's endpoints to inherit automatically — Phase 2's domain modules (Accounts, Categories) need no additional wiring to get the 100/60s default, and can add their own `@Throttle()` overrides the same way if a specific endpoint needs tighter limits.
- The `ThrottlerGuard` plain-provider + `useExisting` alias pattern, and the "dedicated second app instance for throttling-specific e2e tests" pattern, are both reusable templates for any later phase's e2e suite that needs to prove real rate-limiting behavior without breaking its own pre-existing tests.
- No blockers for Phase 2.

---
*Phase: 01-authentication-multi-tenant-foundation*
*Completed: 2026-09-12*

## Self-Check: PASSED

All 5 key files confirmed present on disk; all 3 task commits (`ff57638`, `679a4bb`, `d03d1ca`) confirmed present in `git log --oneline --all`.
