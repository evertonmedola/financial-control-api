---
phase: 01-authentication-multi-tenant-foundation
reviewed: 2026-09-12T14:13:30Z
depth: standard
files_reviewed: 36
files_reviewed_list:
  - .env.example
  - .gitignore
  - .prettierrc
  - README.md
  - docker-compose.yml
  - eslint.config.mjs
  - nest-cli.json
  - package.json
  - src/app.module.ts
  - src/auth/auth.controller.ts
  - src/auth/auth.module.ts
  - src/auth/auth.service.spec.ts
  - src/auth/auth.service.ts
  - src/auth/decorators/current-user.decorator.ts
  - src/auth/dto/login.dto.ts
  - src/auth/dto/refresh.dto.ts
  - src/auth/dto/register.dto.ts
  - src/auth/dto/user-response.dto.ts
  - src/auth/entities/refresh-token.entity.ts
  - src/auth/entities/user.entity.ts
  - src/auth/guards/jwt-auth.guard.ts
  - src/auth/guards/local-auth.guard.ts
  - src/auth/strategies/jwt.strategy.ts
  - src/auth/strategies/local.strategy.ts
  - src/common/dto/response.dto.ts
  - src/common/filters/http-exception.filter.ts
  - src/common/interceptors/response.interceptor.ts
  - src/config/env.validation.ts
  - src/database/data-source.ts
  - src/database/migrations/1789166140074-InitUsers.ts
  - src/database/migrations/1789169156391-CreateRefreshTokens.ts
  - src/main.ts
  - test/auth.e2e-spec.ts
  - test/cross-tenant.e2e-spec.ts
  - test/jest-e2e.json
  - test/security.e2e-spec.ts
  - tsconfig.build.json
  - tsconfig.json
findings:
  critical: 3
  warning: 5
  info: 4
  total: 12
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-09-12T14:13:30Z
**Depth:** standard
**Files Reviewed:** 36
**Status:** issues_found

## Summary

The auth/multi-tenant-foundation phase is well-designed in the places the author clearly focused effort on: timing-safe login (dummy-hash argon2 verify), generic error messages, refresh-token rotation with reuse-family revocation, a global sanitizing exception filter, whitelist-strict DTO validation, and a genuinely thorough e2e/cross-tenant regression suite. That said, three defects would break or undermine the implementation in ways the existing tests do not catch, because the tests all run against an already-provisioned, long-lived local database and never exercise concurrent refresh calls: (1) the migrations will fail outright against a genuinely fresh Postgres instance, (2) a transitive npm package is imported directly by two source files without being declared as a project dependency, and (3) the refresh-token rotation endpoint has a TOCTOU race that lets two concurrent uses of the same token both succeed, defeating the reuse-detection security guarantee the code explicitly documents as a design requirement (D-04). Several further warnings (missing FK constraint, case-sensitive email uniqueness, unbounded password length, validation-order quirk, dead required env var) round out the report.

## Critical Issues

### CR-01: Migrations use `uuid_generate_v4()` without ever enabling the `uuid-ossp` extension — fails on any fresh database

**File:** `src/database/migrations/1789166140074-InitUsers.ts:8`, `src/database/migrations/1789169156391-CreateRefreshTokens.ts:8`

**Issue:** Both migrations create `uuid` primary-key columns with `DEFAULT uuid_generate_v4()`. That function is provided by the `uuid-ossp` Postgres extension, which is **not** enabled by default and is never created anywhere in this repo (no `CREATE EXTENSION "uuid-ossp"` statement in either migration, no init script referenced by `docker-compose.yml`). This was verified empirically: the local `financialcontrol-db-1` container that these migrations already ran against happens to have `uuid-ossp` installed (likely enabled manually once, out of band), but spinning up a brand-new `postgres:16` container (exactly the image `docker-compose.yml` uses) and running the migration's own SQL reproduces:
```
ERROR:  function uuid_generate_v4() does not exist
LINE 1: CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_genera...
HINT:  No function matches the given name and argument types.
```
Any new developer clone, CI pipeline, or `docker-compose down -v && up` will fail `npm run migration:run` on the very first migration. This blocks local setup and — more importantly for this project's stated goal — will also break RDS provisioning in the AWS phase unless someone remembers to run `CREATE EXTENSION` by hand on every new database.

**Fix:** Add the extension creation to the first migration (or a dedicated `0-EnableExtensions` migration run before it), and mirror it in `down()` only if you actually want it reversible:
```ts
public async up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await queryRunner.query(`CREATE TABLE "users" (...)`);
  ...
}
```
Alternatively, switch both migrations (and any future ones) to Postgres 13+'s built-in `gen_random_uuid()` (from `pgcrypto`, also not enabled by default — same fix needed) or `uuid_generate_v4()`-free `gen_random_uuid()` via `CREATE EXTENSION IF NOT EXISTS pgcrypto`, whichever the team standardizes on.

### CR-02: `ms` / `@types/ms` are imported directly but are not declared dependencies — phantom dependency

**File:** `src/auth/auth.service.ts:11`, `src/auth/auth.module.ts:6`

**Issue:** Both files do `import ms, { type StringValue } from 'ms'`, but `package.json` declares neither `ms` nor `@types/ms` (checked `dependencies`/`devDependencies` directly). Verified in `package-lock.json` that the currently-resolved `ms@2.1.3` is a **transitive** dependency of `jsonwebtoken` (pulled in via `@nestjs/jwt`), and `@types/ms` is a transitive dev-type dependency pulled in by something else's `@types/ms: "*"` peer requirement. This only works today because of npm's flat `node_modules` hoisting. It is fragile:
- A lockfile regeneration, a different package manager (pnpm/yarn in non-hoisted mode), or an upgrade/removal of `@nestjs/jwt`'s internals could silently remove `ms` from the tree and break both files (build-time type error and runtime `Cannot find module 'ms'`).
- `package-lock.json` shows two other transitively-resolved `ms` versions (`^2.1.3` via `send`, `^2.1.1` via `debug`) in the tree — nothing pins which one this code actually gets at resolution time.

**Fix:** Declare both explicitly:
```bash
npm install ms
npm install -D @types/ms
```
and re-verify `npm ci` from a clean `node_modules` still builds.

### CR-03: TOCTOU race condition in refresh-token rotation defeats reuse-detection under concurrent requests

**File:** `src/auth/auth.service.ts:101-132`

**Issue:** `refresh()` does a plain `findOne` read of the presented token's row, checks `revokedAt`/`expiresAt` in application code, and only then issues a separate `update(stored.id, { revokedAt: new Date() })` call — with no transaction, row lock (`SELECT ... FOR UPDATE`), or atomic conditional update (`UPDATE ... WHERE id = $1 AND revoked_at IS NULL`). If the same still-valid refresh token is presented twice concurrently (a legitimate client retry racing a slow response, or — more importantly — an attacker who has intercepted the token racing the legitimate holder), both requests can read `revokedAt: null` before either write commits, and both proceed to rotate and issue a brand-new, fully valid token pair. The code's own comments describe reuse detection as the core anti-theft mechanism (D-04): "if the presented token was already rotated ... treats the replay as a signal the token was stolen." That guarantee only holds for strictly sequential requests; under concurrency it silently fails open instead of revoking the family. Note the author was clearly aware of this class of bug — `register()`'s concurrent-duplicate-email case is explicitly regression-tested (`test/auth.e2e-spec.ts:114-132`) and relies on the DB's own unique constraint for atomicity — but the equivalent protection was not applied to `refresh()`.

**Fix:** Make the rotation atomic, e.g. via a single conditional UPDATE that only succeeds if the row is still unrevoked and unexpired, and branch on the affected-row count:
```ts
const result = await this.refreshTokenRepository
  .createQueryBuilder()
  .update(RefreshToken)
  .set({ revokedAt: new Date() })
  .where('id = :id AND revokedAt IS NULL AND expiresAt > :now', {
    id: stored.id,
    now: new Date(),
  })
  .returning('*')
  .execute();

if (result.affected === 0) {
  // Either already revoked (reuse) or expired — re-fetch to disambiguate
  // and, if reuse, revoke the family — then throw the generic 401.
}
```
or wrap the read+update in a single `SERIALIZABLE`/`SELECT ... FOR UPDATE` transaction.

## Warnings

### WR-01: No foreign key from `refresh_tokens.user_id` to `users.id` (and a type mismatch: `uuid` vs `varchar`)

**File:** `src/database/migrations/1789169156391-CreateRefreshTokens.ts:8`, `src/auth/entities/refresh-token.entity.ts:21-22`

**Issue:** `refresh_tokens.user_id` is created as plain `character varying NOT NULL` with an index but no `REFERENCES "users"("id")` constraint, while `users.id` is `uuid`. There is no referential integrity: deleting a user (a near-certain future requirement) leaves orphaned `refresh_tokens` rows behind silently, and nothing at the DB layer prevents a `user_id` value that never corresponds to a real user.

**Fix:**
```ts
await queryRunner.query(
  `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_refresh_tokens_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
);
```
and consider changing the column type to `uuid` to match `users.id` exactly.

### WR-02: Email uniqueness/lookup is case-sensitive — no normalization

**File:** `src/auth/auth.service.ts:46-59, 61-74`, `src/auth/entities/user.entity.ts:16-18`

**Issue:** `register()` and `validateUser()` both use the raw `email` string as-is; there is no `.toLowerCase()`/`.trim()` normalization before the unique-constraint insert or the `findOne({ where: { email } })` lookup, and the column isn't `citext`. `User@Example.com` and `user@example.com` are treated as two different accounts — a user can accidentally (or maliciously) register the "same" address twice, and login requires remembering the exact casing originally used.

**Fix:** Normalize once, centrally, e.g. in a `@BeforeInsert()`/`@BeforeUpdate()` hook on the entity or explicitly in `AuthService` before every DB touch:
```ts
const normalizedEmail = email.trim().toLowerCase();
```

### WR-03: `password` fields have a minimum length but no maximum — unbounded input into argon2

**File:** `src/auth/dto/register.dto.ts:1-10`, `src/auth/dto/login.dto.ts:1-10`

**Issue:** `@MinLength(8)` is enforced but there is no `@MaxLength()`. Argon2 hashing/verification cost scales with input size; combined with the per-route throttle (3/60s register, 5/60s login) and Express's default JSON body-size limit this is only partially mitigated, not eliminated — an attacker can still send a request per throttle window with a large (up to the default body-parser limit) password string, forcing extra CPU/memory cost per attempt across many source IPs.

**Fix:**
```ts
@IsString()
@MinLength(8)
@MaxLength(128)
password!: string;
```

### WR-04: `LocalAuthGuard` fully authenticates (DB lookup + argon2 verify) before `ValidationPipe` gets a chance to reject the request

**File:** `src/auth/auth.controller.ts:36-46`

**Issue:** NestJS's request lifecycle runs Guards before Pipes. `LocalAuthGuard` (passport `AuthGuard('local')`) reads `email`/`password` straight off the raw, unvalidated `req.body` and calls `LocalStrategy.validate()` → `AuthService.validateUser()` (a full DB round-trip + argon2 verify) *before* the `@Body() _dto: LoginDto` parameter's `whitelist`/`forbidNonWhitelisted` `ValidationPipe` ever runs. Concretely: `POST /auth/login` with correct credentials plus an unexpected extra field (e.g. `{ email, password, userId }`) still performs the full authentication work, succeeds at the guard layer, and only then gets rejected with 400 by the pipe — while the same request with *incorrect* credentials never reaches the pipe at all and is rejected 401 by the guard. The two rejection paths use different mechanisms and produce different status codes/wasted work depending on credential validity, which is confusing and wastes an argon2 computation on every malformed login payload regardless of outcome. `test/cross-tenant.e2e-spec.ts:287-296` only asserts the "valid creds + extra field → 400" side, so this ordering quirk is currently undetected by the suite.

**Fix:** Either validate the DTO shape before the guard runs (e.g., a dedicated pipe/guard ordering, or manually validating `LoginDto` inside a custom guard prior to calling `super.canActivate()`), or accept the current behavior but document it explicitly and add a test asserting invalid-credentials-plus-extra-field also behaves consistently (401, not 400) so the discrepancy is at least intentional and covered.

### WR-05: `JWT_REFRESH_SECRET` is required at boot but never used anywhere

**File:** `src/config/env.validation.ts:25`, `.env.example:17`

**Issue:** The env schema requires `JWT_REFRESH_SECRET` (min 32 chars) and the app refuses to boot without it, but grep across `src/` shows it is never read via `ConfigService` anywhere — refresh tokens are opaque `crypto.randomBytes(64)` values, not signed JWTs, so this secret is structurally unused. This is dead required configuration: it forces every environment (local, CI, RDS/Secrets Manager) to provision and store a secret that does nothing, and misleads readers into thinking refresh tokens are JWT-based.

**Fix:** Remove `JWT_REFRESH_SECRET` from `envSchema`/`.env.example` (and wherever it may be referenced in future AWS Secrets Manager provisioning docs), or, if refresh tokens are intended to move to signed JWTs in a later plan, add a comment in `env.validation.ts` itself (not just `.env.example`) clarifying it's provisioned ahead of that future plan.

## Info

### IN-01: Timestamp columns use `TIMESTAMP` instead of `TIMESTAMPTZ`

**File:** `src/database/migrations/1789166140074-InitUsers.ts:8`, `src/database/migrations/1789169156391-CreateRefreshTokens.ts:8`, `src/auth/entities/user.entity.ts:24,27`, `src/auth/entities/refresh-token.entity.ts:27,30,33`

**Issue:** All date/time columns (`created_at`, `updated_at`, `expires_at`, `revoked_at`) are plain `TIMESTAMP` (no time zone), a well-known source of subtle bugs if the DB server's session timezone ever diverges from the app server's assumption (both currently default to UTC, so this is latent, not active).

**Fix:** Prefer `timestamptz` (`@Column({ type: 'timestamptz', ... })` / `@CreateDateColumn({ type: 'timestamptz' })`) for all new timestamp columns going forward.

### IN-02: `JWT_*_EXPIRES_IN` env vars are validated only as non-empty strings, not as parseable durations

**File:** `src/config/env.validation.ts:23,26`

**Issue:** `z.string().min(1)` accepts any non-empty string, including a value `ms()` can't parse (e.g. `"15"` with no unit). Such a value passes boot-time validation and only fails later, at the first sign/refresh call (`ms(refreshExpiresIn)` returning `undefined`, or `jsonwebtoken` throwing on `expiresIn`), defeating the project's own "fail-fast, refuse to boot on malformed config" goal stated in the same file's comment.

**Fix:** Validate with a regex matching `ms`-parseable formats, e.g. `z.string().regex(/^\d+(ms|s|m|h|d|w|y)$/)`, or call `ms()` inside a `.refine()`.

### IN-03: README.md is still the unmodified NestJS starter template

**File:** `README.md:1-99`

**Issue:** The README is 100% generic `@nestjs/schematics` boilerplate (NestJS logos/badges, generic "Compile and run the project" instructions) despite the project already having a real docker-compose Postgres setup, env-var contract, and migration workflow. For a project explicitly described as a portfolio piece, this is a missed opportunity and a maintenance gap for anyone cloning the repo.

**Fix:** Replace with project-specific setup instructions: `.env` setup from `.env.example`, `docker-compose up -d`, `npm run migration:run`, `npm run start:dev`, and a summary of the auth endpoints.

### IN-04: TypeScript strictness is loosened (`noImplicitAny: false`, `strictBindCallApply: false`) for a security-first project

**File:** `tsconfig.json:19-24`

**Issue:** `strictNullChecks` is on, but `noImplicitAny`, `strictBindCallApply`, and `noFallthroughCasesInSwitch` are explicitly disabled. Given the project's own `CLAUDE.md` treats security/correctness as a "core requirement, not an extra," a fuller `strict: true` posture would catch a wider class of bugs at compile time (implicit `any` in particular hides real type errors) with generally low migration cost this early in the project.

**Fix:** Consider `"strict": true` (superset that enables `noImplicitAny`, `strictBindCallApply`, etc.) once the codebase is small, rather than retrofitting it later across a larger surface.

---

_Reviewed: 2026-09-12T14:13:30Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
