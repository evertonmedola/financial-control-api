---
phase: 01-authentication-multi-tenant-foundation
fixed_at: 2026-09-12T14:32:40Z
review_path: .planning/phases/01-authentication-multi-tenant-foundation/01-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-09-12T14:32:40Z
**Source review:** .planning/phases/01-authentication-multi-tenant-foundation/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (3 Critical, 5 Warning — `fix_scope: critical_warning`; the 4 Info findings were out of scope and left untouched)
- Fixed: 8
- Skipped: 0

All fixes were applied inside an isolated git worktree, verified against a series of throwaway, freshly-provisioned `postgres:16` Docker containers (never the developer's persistent local DB), and confirmed with a final combined run: `tsc --noEmit` (0 errors), `npm run migration:run` on a brand-new database, `npm run test` (13/13 unit tests), and `npm run test:e2e` (36/36 e2e tests, up from 34 pre-existing — 2 new regression tests were added as part of the CR-03 and WR-04 fixes).

## Fixed Issues

### CR-01: Migrations use `uuid_generate_v4()` without ever enabling the `uuid-ossp` extension

**Files modified:** `src/database/migrations/1789166140074-InitUsers.ts`, `src/database/migrations/1789169156391-CreateRefreshTokens.ts`
**Commit:** `d4df59a`
**Applied fix:** Switched both migrations' `DEFAULT uuid_generate_v4()` to `DEFAULT gen_random_uuid()` — native to Postgres core since version 13, requiring zero extensions. Verified by running the exact fixed `CREATE TABLE` SQL directly against a brand-new, unmodified `postgres:16` container (no extensions installed): both tables and their UUID defaults worked immediately, and an `INSERT ... RETURNING id` produced a real UUID. Also verified end-to-end via `npm run migration:run` against a fresh container.

### CR-02: `ms` / `@types/ms` are imported directly but not declared as dependencies

**Files modified:** `package.json`, `package-lock.json`
**Commit:** `1f85e78`
**Applied fix:** Added `"ms": "^2.1.3"` to `dependencies` and `"@types/ms": "^2.1.0"` to `devDependencies`, matching the versions already resolved transitively in `package-lock.json`. Ran `npm install` in the isolated worktree and confirmed the lockfile diff was minimal — only the two new direct-dependency declarations were added (`git diff package-lock.json` showed exactly 2 insertions), no unrelated package version churn.

### CR-03: TOCTOU race condition in refresh-token rotation defeats reuse-detection under concurrent requests

**Files modified:** `src/auth/auth.service.ts`, `src/auth/auth.service.spec.ts`, `test/auth.e2e-spec.ts`
**Commit:** `6388d76`
**Applied fix:** Replaced the read-then-write `findOne()` + `update()` pair in `refresh()` with a single atomic conditional `UPDATE ... WHERE token_hash = :tokenHash AND revoked_at IS NULL AND expires_at > :now RETURNING *`, using TypeORM's query builder with `.execute()`'s `affected` count to decide success. Postgres re-evaluates the `WHERE` clause against the row's current, locked version at `UPDATE` time, so only one of two concurrent requests presenting the same still-valid token can ever match and rotate; the loser sees `affected: 0` and falls through to the (side-effect-only) reuse-detection re-fetch. Updated the mocked-repository unit tests (`auth.service.spec.ts`) to model the new `createQueryBuilder()` chain, and added a new unit test simulating two concurrent `refresh()` calls (exactly one fulfills, one rejects with `UnauthorizedException`). Added a new e2e test (`test/auth.e2e-spec.ts`) that fires two genuinely concurrent HTTP requests with the same valid refresh token against a real Postgres instance and asserts exactly one returns 200 and the other 401 — repeated 5x with no flakiness observed.

### WR-01: No foreign key from `refresh_tokens.user_id` to `users.id` (and a type mismatch: `uuid` vs `varchar`)

**Files modified:** `src/database/migrations/1789223051154-AddRefreshTokensUserFk.ts` (new), `src/auth/entities/refresh-token.entity.ts`
**Commit:** `5b19c11`
**Applied fix:** Added a new migration that alters `refresh_tokens.user_id` from `character varying` to `uuid` (`USING "user_id"::uuid`) and adds `FK_refresh_tokens_user_id` referencing `users(id)` with `ON DELETE CASCADE`, so deleting a user cleans up their refresh tokens instead of leaving orphans. Updated the `RefreshToken` entity's `userId` column to declare `type: 'uuid'` explicitly, matching the new physical schema. Verified no existing test relies on non-UUID `userId` values (all test fixtures use real registered users' IDs).

### WR-02: Email uniqueness/lookup is case-sensitive — no normalization

**Files modified:** `src/auth/auth.service.ts`
**Commit:** `7431ac9`
**Applied fix:** Added a private `normalizeEmail()` helper (`.trim().toLowerCase()`) and applied it in both `register()` (before create/save) and `validateUser()` (before the `findOne` lookup) — the two places that touch the DB with an email value.

### WR-03: `password` fields have a minimum length but no maximum

**Files modified:** `src/auth/dto/register.dto.ts`, `src/auth/dto/login.dto.ts`
**Commit:** `ecf7129`
**Applied fix:** Added `@MaxLength(128)` alongside the existing `@MinLength(8)` on both DTOs' `password` field, bounding the argon2 hashing/verification cost per request.

### WR-04: `LocalAuthGuard` fully authenticates before `ValidationPipe` gets a chance to reject the request

**Files modified:** `src/auth/guards/local-auth.guard.ts`, `test/cross-tenant.e2e-spec.ts`
**Commit:** `9612bef`
**Applied fix:** `LocalAuthGuard` now overrides `canActivate()` to run the same `ValidationPipe` configuration used globally (`whitelist`, `forbidNonWhitelisted`, `transform`) against `LoginDto` *before* delegating to `super.canActivate()` (which triggers the DB lookup + argon2 verify). This makes malformed login payloads fail fast with zero DB/argon2 work, and — as a side effect — makes the rejection status code consistent regardless of credential validity (previously: wrong-creds-plus-extra-field → 401 from the guard; right-creds-plus-extra-field → 400 from the pipe; now both → 400). Added a new e2e test in `test/cross-tenant.e2e-spec.ts` asserting wrong-credentials-plus-extra-field also returns 400.

### WR-05: `JWT_REFRESH_SECRET` is required at boot but never used anywhere

**Files modified:** `src/config/env.validation.ts`, `.env.example`
**Commit:** `d4061d9`
**Applied fix:** Removed `JWT_REFRESH_SECRET` from `envSchema` and `.env.example`, with a comment in `env.validation.ts` explaining why (opaque, DB-backed refresh tokens — nothing to sign/verify). Verified by running the full unit + e2e suite with `JWT_REFRESH_SECRET` completely absent from the environment: the app booted and all 49 tests (13 unit + 36 e2e) passed.

## Skipped Issues

None — all 8 in-scope findings (3 Critical, 5 Warning) were fixed and verified.

---

_Fixed: 2026-09-12T14:32:40Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
