---
phase: 01-authentication-multi-tenant-foundation
plan: 03
subsystem: auth
tags: [nestjs, typeorm, postgres, jwt, refresh-token, crypto, sha256, rotation]

requires:
  - phase: 01-authentication-multi-tenant-foundation (Plan 01)
    provides: "AuthService/AuthController shape, User entity, JwtAuthGuard/@CurrentUser() stateless access-token verification, {data, timestamp} response envelope"

provides:
  - "RefreshToken entity + CreateRefreshTokens migration (userId indexed, tokenHash unique, expiresAt, revokedAt nullable, createdAt)"
  - "AuthService.issueTokenPair(userId) — the single shared implementation login() and refresh() both use to sign the access token and generate/hash/persist a new refresh token"
  - "AuthService.refresh(rawToken) — hash-lookup, rotate-and-invalidate-the-used-token on success, full-family revocation on reuse (replay of an already-rotated token), 401 on unknown/expired"
  - "AuthService.logout(rawToken) — idempotent revoke-by-hash, identical response whether the token was unknown or already revoked"
  - "POST /auth/refresh, POST /auth/logout — both intentionally unauthenticated by JwtAuthGuard (the refresh token itself is the credential)"
  - "POST /auth/login now returns {accessToken, refreshToken}"

affects:
  - "Any future client integration expecting the full auth lifecycle (login -> refresh -> logout) per D-02/D-04"
  - "Phase 2+ domain modules — unaffected; JwtAuthGuard/@CurrentUser()/access-token verification (AUTH-03's stateless mechanism) is untouched by this plan"

actuals:
  tokens: 7484   # chars/4 over full realized diff (git diff 99438bc..HEAD, excluding .planning); ~6864 if package-lock.json's generated bulk is excluded
  tasks: 2
  commits: 2
plan_head_before: 99438bca92ddd1d32e9c8ce72566a513b09cb555

tech-stack:
  added: []   # no new npm packages — `ms` was already a resolvable transitive dependency of @nestjs/jwt (previously used only as a type import), now also used at runtime to compute the refresh token's expiresAt from JWT_REFRESH_EXPIRES_IN
  patterns:
    - "issueTokenPair(userId) — single shared private method for token issuance, called by both login() and refresh(), so access+refresh signing/hashing/persisting logic exists exactly once"
    - "Refresh token rotation with reuse detection (01-RESEARCH.md Pattern 3): every /auth/refresh call either rotates the presented token into a brand-new pair, or — if the presented token was already rotated (revokedAt set) — revokes every still-valid token for that userId, forcing full re-login everywhere"
    - "SHA-256 (not argon2) for refresh-token-at-rest hashing — deliberate choice for a high-entropy random secret with no dictionary to defend against, documented inline at the hashing call site"
    - "Generic UnauthorizedException(GENERIC_AUTH_ERROR) reused for every refresh() failure branch (unknown/revoked/expired) and logout()'s always-success response — extends D-05's user-enumeration philosophy to the refresh-token surface"

key-files:
  created:
    - src/auth/entities/refresh-token.entity.ts
    - src/database/migrations/1789169156391-CreateRefreshTokens.ts
    - src/auth/dto/refresh.dto.ts
  modified:
    - src/auth/auth.service.ts
    - src/auth/auth.controller.ts
    - src/auth/auth.module.ts
    - src/auth/auth.service.spec.ts
    - test/auth.e2e-spec.ts
    - package-lock.json

key-decisions:
  - "issueTokenPair(userId) was extracted as a shared private helper already in Task 1 (login() calls it), not deferred to Task 2 — this is the plan's own eventual design (Task 2 explicitly calls for this extraction) and avoids writing login()'s token logic twice"
  - "RefreshDto adds @MaxLength(256) alongside @IsString() — raw tokens are always exactly 128 hex chars; bounding accepted length is a cheap defense-in-depth addition against oversized/malformed input reaching the SHA-256 hash call, found during the security-review checklist pass (Rule 2)"
  - "POST /auth/logout responds 200 with an empty {} envelope body rather than 204 No Content — avoids interaction ambiguity with the global ResponseInterceptor, which unconditionally wraps whatever the handler returns; 200/{} is what the plan's own done-criteria wording ('200/204') allows and keeps the response shape consistent with every other endpoint in this module"
  - "A local .env was created in this worktree (gitignored, not committed) pointing at the already-running shared docker-compose Postgres container (financialcontrol-db-1, host port 5433) — a fresh git worktree does not inherit the main checkout's local .env, and the container's actual POSTGRES_USER/PASSWORD/DB were read via `docker inspect` rather than guessed"

requirements-completed: [AUTH-02, AUTH-03]

coverage:
  - id: D1
    description: "POST /auth/login returns both accessToken and refreshToken; only a SHA-256 hash of the raw refresh token is ever persisted, with a 7-day expiresAt"
    requirement: "AUTH-03"
    verification:
      - kind: unit
        ref: "src/auth/auth.service.spec.ts#login > issues a refresh token and persists only its SHA-256 hash, never the raw value"
        status: pass
      - kind: e2e
        ref: "test/auth.e2e-spec.ts#POST /auth/login > login issues refresh token: response has both tokens, and the raw value is never persisted"
        status: pass
    human_judgment: false
  - id: D2
    description: "POST /auth/refresh with a valid, unused, unexpired token rotates it into a brand-new access+refresh pair and revokes the old row; unknown or expired tokens are rejected with 401"
    requirement: "AUTH-02"
    verification:
      - kind: unit
        ref: "src/auth/auth.service.spec.ts#refresh (happy path, unknown-token error case, expired-token error case)"
        status: pass
      - kind: e2e
        ref: "test/auth.e2e-spec.ts#POST /auth/refresh (rotation, unknown/garbage token, expired-but-never-used token)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Replaying an already-rotated refresh token (reuse) is rejected with 401 AND revokes every other refresh token belonging to that user, including a still-valid sibling session, forcing full re-login everywhere"
    requirement: "AUTH-02"
    verification:
      - kind: unit
        ref: "src/auth/auth.service.spec.ts#refresh > reuse detection: an already-revoked token throws and revokes every still-valid token for that user"
        status: pass
      - kind: e2e
        ref: "test/auth.e2e-spec.ts#POST /auth/refresh > refresh token reuse detection: replaying an already-rotated token is rejected and revokes every sibling token for that user"
        status: pass
    human_judgment: false
  - id: D4
    description: "POST /auth/logout revokes the presented refresh token; using it afterward for /auth/refresh behaves identically to any other revoked/unknown token (401)"
    requirement: "AUTH-02"
    verification:
      - kind: unit
        ref: "src/auth/auth.service.spec.ts#logout (happy path + idempotent-on-unknown-token case)"
        status: pass
      - kind: e2e
        ref: "test/auth.e2e-spec.ts#POST /auth/logout > revokes the presented refresh token; using it afterward behaves identically to any other revoked token (401)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The access token's validity check (JwtAuthGuard/JwtStrategy) never queries the database, even after this plan added the DB-backed refresh-token surface — the one documented, scoped exception to AUTH-03's statelessness remains exactly refresh_tokens, nothing broader"
    requirement: "AUTH-03"
    verification:
      - kind: manual_procedural
        ref: "src/auth/strategies/jwt.strategy.ts left byte-for-byte unmodified by this plan (git diff confirms zero changes to this file); validate() still only decodes/verifies the signed payload"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-09-11
status: complete
---

# Phase 1 Plan 3: Refresh Token Rotation & Reuse Detection Summary

**DB-backed refresh tokens with rotate-and-invalidate-the-used-token semantics; replaying an already-rotated token revokes the caller's entire token family (SHA-256-hashed at rest, never the raw value).**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-11T23:22:26Z
- **Completed:** 2026-09-11T23:38:38Z
- **Tasks:** 2 completed
- **Files modified:** 8 (3 new + 5 modified)

## Accomplishments
- `RefreshToken` entity + migration; `POST /auth/login` now issues and persists a hashed, 7-day-expiring refresh token alongside the existing 15-minute access token
- `AuthService.issueTokenPair(userId)` — one shared implementation for token issuance, used by both `login()` and `refresh()`
- `POST /auth/refresh`: valid token → rotation (new pair, old row revoked); already-rotated token replayed → reuse detected, entire token family revoked, 401; unknown/expired → 401
- `POST /auth/logout`: idempotent revoke-by-hash, indistinguishable response for unknown vs. already-revoked tokens
- 17 e2e tests (was 12) + 12 unit tests (was 6) all green; a direct SQL check against `refresh_tokens` confirms every `token_hash` is a 64-char SHA-256 digest — no raw 128-char token value ever appears in the table

## Task Commits

Each task was committed atomically:

1. **Task 1: RefreshToken entity + migration + issuance at login** - `38ec1df` (feat)
2. **Task 2: Rotation + reuse detection (/auth/refresh) and revocation (/auth/logout)** - `6dd1354` (feat)

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `src/auth/entities/refresh-token.entity.ts` - RefreshToken TypeORM entity (id uuid, userId indexed, tokenHash unique, expiresAt, revokedAt nullable, createdAt)
- `src/database/migrations/1789169156391-CreateRefreshTokens.ts` - generated migration creating the `refresh_tokens` table
- `src/auth/dto/refresh.dto.ts` - `RefreshDto` (`refreshToken: string`, `@IsString() @MaxLength(256)`)
- `src/auth/auth.service.ts` - `issueTokenPair()`, `hashToken()`, `refresh()`, `logout()`; `login()` now delegates to `issueTokenPair()`
- `src/auth/auth.controller.ts` - `POST /auth/refresh`, `POST /auth/logout` (both unguarded by `JwtAuthGuard`); login's return type widened to include `refreshToken`
- `src/auth/auth.module.ts` - registers `RefreshToken` in `TypeOrmModule.forFeature()`
- `src/auth/auth.service.spec.ts` - unit coverage for `login()`'s refresh-token issuance, `refresh()` (rotation/unknown/reuse/expired), `logout()` (happy path + idempotency)
- `test/auth.e2e-spec.ts` - e2e coverage for all of the above against a real Postgres database
- `package-lock.json` - synced via `npm install` (lockfile had drifted from `package.json` before this session; `npm ci` failed and required a sync — no new packages added, see Issues Encountered)

## Decisions Made
- `issueTokenPair(userId)` extracted as a shared private helper in Task 1 already, since Task 2's own action explicitly calls for `login()`/`refresh()` to share exactly one issuance implementation — writing it twice and refactoring later would have been pure rework
- `RefreshDto` bounds `refreshToken` to `@MaxLength(256)` (raw tokens are always 128 hex chars) — a defense-in-depth addition surfaced by the `security-review` skill checklist pass (Rule 2: missing input-validation completeness), not called out explicitly in the plan
- `POST /auth/logout` returns `200 {}` rather than `204 No Content`, sidestepping any ambiguity with the global `ResponseInterceptor`'s unconditional envelope-wrapping of the handler's return value
- Reuse-detection's family-revocation query is scoped by `stored.userId` (read from the DB row itself, never a client-supplied value) — matches the plan's own `threat_model` mitigation for T-01-10 (Tampering)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree had no installed dependencies or local `.env`**
- **Found during:** Pre-Task 1 setup, before any code changes
- **Issue:** This git worktree was created fresh and had no `node_modules/` and no `.env` file. `npm ci` additionally failed because `package-lock.json` had drifted from `package.json` (missing/mismatched `@emnapi/*` optional entries) — a pre-existing lockfile-generation artifact, not something introduced by this plan.
- **Fix:** Ran `npm install` (not `npm ci`) to sync the lockfile and install all already-declared dependencies — no new packages were added, this only resolved existing declared-but-un-synced entries. Created a local, gitignored `.env` pointing at the already-running shared `financialcontrol-db-1` Postgres container (read its actual `POSTGRES_USER`/`PASSWORD`/`DB` via `docker inspect` rather than guessing), matching the pattern the 01-01 plan's own session used (port 5433, since 5432 is bound by an unrelated container on this machine).
- **Files modified:** `package-lock.json` (committed, part of Task 1); `.env` (local only, gitignored, not committed)
- **Verification:** `npm run build`, `npm run test`, and `npm run test:e2e` all ran successfully afterward
- **Committed in:** `38ec1df` (Task 1 commit, package-lock.json only — `.env` is gitignored)

**2. [Rule 2 - Missing Critical] Bounded `RefreshDto.refreshToken` length**
- **Found during:** Task 2 (security-review checklist pass before finalizing)
- **Issue:** `RefreshDto` validated only `@IsString()` with no upper bound — an unbounded string reaching `crypto.createHash('sha256')` on every `/auth/refresh`/`/auth/logout` call is a minor but avoidable input-validation gap (raw tokens are always exactly 128 hex chars).
- **Fix:** Added `@MaxLength(256)`.
- **Files modified:** `src/auth/dto/refresh.dto.ts`
- **Verification:** Full e2e suite re-run green after the change; no behavior change for legitimate 128-char tokens
- **Committed in:** `6dd1354` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking/environment-setup, 1 missing-critical/input-validation)
**Impact on plan:** Neither changed the plan's design. No scope creep, no architectural changes.

## Issues Encountered
- `npm ci` failed on first attempt in this fresh worktree (`package-lock.json` lockfile drift — pre-existing, unrelated to this plan's own file list) — resolved via `npm install`, documented above as a deviation since it was necessary to unblock any work at all.
- This worktree's Docker Desktop/container state was inherited from a prior session (`financialcontrol-db-1` already running, healthy, on host port 5433) — no new container was started; `.env` was pointed at it directly rather than spinning up a duplicate.

## User Setup Required

None - no external service configuration required. The `security-review` checklist was applied manually (the `security-review` Skill's own script errored on `git diff origin/HEAD...` — no `origin` remote exists in this local-only repo — so the checklist from `.claude/skills/security-review/SKILLS.md` was read and applied directly):

✅ Aplicado: DTO com validação (`RefreshDto` + `@MaxLength`), queries parametrizadas (TypeORM repository methods only, no raw SQL), nenhum segredo hardcoded, isolamento IDOR (family-revocation scoped by server-derived `stored.userId`, never client input), mensagens de erro genéricas sem vazamento (`GENERIC_AUTH_ERROR` reused across every `refresh()`/`logout()` branch), JWT com expiração curta + refresh tratado separadamente (D-02/D-03/D-04)

⚠️ Atenção: `POST /auth/refresh` and `POST /auth/logout` are public, unauthenticated endpoints with no rate limiting yet — D-06 (`@nestjs/throttler` on login/register) is explicitly scoped to those two endpoints only in this phase's `CONTEXT.md`/`RESEARCH.md`, and `@nestjs/throttler` is not yet installed in this codebase at all. Flagging for whichever later plan wires up rate limiting to decide whether `/auth/refresh`/`/auth/logout` should also be covered (they are lower-value brute-force targets than login/register since the token is a 512-bit secret, not a guessable credential, but a global default limiter would still be reasonable defense-in-depth).

## Next Phase Readiness
- The full auth lifecycle (register → login → refresh → logout) is proven end-to-end against a real Postgres database
- `AuthModule` now exports/uses both `User` and `RefreshToken` repositories; Phase 2+ domain modules are unaffected (they only ever depended on `JwtAuthGuard`/`@CurrentUser()`, both untouched by this plan)
- Rate limiting (D-06) for `/auth/login` and `/auth/register` remains unimplemented — flagged as a known gap for whichever plan is scoped to add `@nestjs/throttler` (per 01-CONTEXT.md this was intentionally deferred past Plan 01, not this plan's file list)
- No blockers for subsequent plans in this phase

---
*Phase: 01-authentication-multi-tenant-foundation*
*Completed: 2026-09-11*

## Self-Check: PASSED

All 8 key files confirmed present on disk; both task commits (`38ec1df`, `6dd1354`) confirmed present in `git log --oneline --all`.
