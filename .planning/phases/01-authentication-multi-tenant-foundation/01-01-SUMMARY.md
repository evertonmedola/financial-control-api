---
phase: 01-authentication-multi-tenant-foundation
plan: 01
subsystem: auth
tags: [nestjs, typeorm, postgres, jwt, passport, argon2, zod, docker-compose]

requires: []

provides:
  - "Full NestJS v11.2.3 project scaffold (TS 6.0.3, Node 24) — package.json, tsconfig, eslint flat config, Jest unit + e2e config"
  - "Dockerized local Postgres 16 (docker-compose.yml) + first TypeORM migration (users table)"
  - "Zod-validated env contract (src/config/env.validation.ts) covering the FULL env surface this phase will ever need (DB_*, JWT_ACCESS_*, JWT_REFRESH_*, ALLOWED_ORIGINS, PORT) — Plans 02/03 read via ConfigService only, never re-declare"
  - "User entity + AuthService (register/validateUser/login/findById) with argon2id hashing (D-01) and generic-error timing mitigation (D-05)"
  - "LocalStrategy/JwtStrategy + LocalAuthGuard/JwtAuthGuard + @CurrentUser() decorator — the userId-scoping primitive every later domain module reuses unchanged"
  - "POST /auth/register, POST /auth/login, GET /auth/me — fully covered by test/auth.e2e-spec.ts (11 cases) and src/auth/auth.service.spec.ts (5 cases)"
  - "Global {data, timestamp} response envelope + strict ValidationPipe (whitelist, forbidNonWhitelisted) + ClassSerializerInterceptor, wired as APP_PIPE/APP_INTERCEPTOR DI providers so behavior is identical in production and in e2e tests"

affects:
  - "01-02 (transport hardening / CORS via ALLOWED_ORIGINS)"
  - "01-03 (refresh-token rotation via JWT_REFRESH_SECRET/JWT_REFRESH_EXPIRES_IN, already declared in the env schema)"
  - "Phase 2+ (Accounts, Categories, Transactions, Budgets, Reports) — all reuse @CurrentUser()/JwtAuthGuard/response envelope unchanged"

actuals:
  tokens: 113801   # chars/4 over full realized diff (git diff 5798ddb..HEAD, excluding .planning/); ~12000 tokens if package-lock.json's generated bulk is excluded
  tasks: 2         # Task 0 was a verification-only checkpoint (no code); Task 1 + Task 2 are the implementation tasks
  commits: 2
plan_head_before: 5798ddbc6e193aa7b7f380195e716d403ebd07b7

tech-stack:
  added: [NestJS 11.2.3, TypeScript 6.0.3, TypeORM 1.1.1, PostgreSQL 16, "@nestjs/config 4.0.4", "zod 4.6.2", "@nestjs/jwt 11.0.2", "@nestjs/passport 11.0.5", "passport-jwt 4.0.1", "passport-local 1.0.0", "argon2 0.45.1", "class-validator 0.15.1", "class-transformer 0.5.1", "docker-compose"]
  patterns:
    - "userId-scoping via JwtStrategy.validate() -> request.user.userId -> @CurrentUser() -> service method param — never trust a client-supplied id"
    - "Generic auth error + dummy-hash timing mitigation: argon2.verify() always runs, against a real hash or a fixed dummy hash, so 'email not found' and 'wrong password' are timing-indistinguishable"
    - "Global cross-cutting concerns (ValidationPipe, ClassSerializerInterceptor, ResponseInterceptor) registered as APP_PIPE/APP_INTERCEPTOR DI providers in AppModule, not imperatively in main.ts, so e2e tests built via Test.createTestingModule() get identical behavior to production bootstrap"
    - "{data, timestamp} response envelope wraps every SUCCESS response; thrown exceptions bypass interceptors and keep Nest's default {message, statusCode} shape"

key-files:
  created:
    - src/auth/auth.service.ts
    - src/auth/auth.controller.ts
    - src/auth/auth.module.ts
    - src/auth/entities/user.entity.ts
    - src/auth/dto/register.dto.ts
    - src/auth/dto/login.dto.ts
    - src/auth/dto/user-response.dto.ts
    - src/auth/strategies/local.strategy.ts
    - src/auth/strategies/jwt.strategy.ts
    - src/auth/guards/local-auth.guard.ts
    - src/auth/guards/jwt-auth.guard.ts
    - src/auth/decorators/current-user.decorator.ts
    - src/config/env.validation.ts
    - src/database/data-source.ts
    - src/database/migrations/1789166140074-InitUsers.ts
    - src/common/dto/response.dto.ts
    - src/common/interceptors/response.interceptor.ts
    - test/auth.e2e-spec.ts
    - src/auth/auth.service.spec.ts
    - docker-compose.yml
    - .env.example
  modified:
    - src/app.module.ts
    - src/main.ts

key-decisions:
  - "Discrete DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME env vars (not a single DATABASE_URL) — matches docker-compose.yml's service vars directly, one less parsing step"
  - "Global ValidationPipe/ClassSerializerInterceptor/ResponseInterceptor moved from imperative main.ts calls to APP_PIPE/APP_INTERCEPTOR providers in AppModule after discovering e2e tests (Test.createTestingModule) never execute main.ts's bootstrap() — this is now the only way to guarantee prod/test parity for global enhancers"
  - "login() no longer passes an explicit {expiresIn: '15m'} at the call site — relies solely on JwtModule's registerAsync default sign options (sourced from JWT_ACCESS_EXPIRES_IN), so the 15-minute value (D-03) has exactly one source of truth"
  - "Removed the NestJS CLI's default Hello-World scaffold (app.controller.ts/app.service.ts/app.controller.spec.ts/test/app.e2e-spec.ts) — not in this plan's file list and this phase's only module is AuthModule"

requirements-completed: [AUTH-01, AUTH-02, AUTH-03, AUTH-04]

coverage:
  - id: D1
    description: "POST /auth/register hashes the password with argon2id and never returns/stores plaintext"
    requirement: "AUTH-01"
    verification:
      - kind: unit
        ref: "src/auth/auth.service.spec.ts#register hashes the password with argon2 and persists the user (happy path)"
        status: pass
      - kind: e2e
        ref: "test/auth.e2e-spec.ts#registers a new user and never returns passwordHash"
        status: pass
    human_judgment: false
  - id: D2
    description: "Concurrent duplicate registration with the identical email results in exactly one 2xx and one 4xx, never two rows"
    requirement: "AUTH-01"
    verification:
      - kind: e2e
        ref: "test/auth.e2e-spec.ts#creates exactly one user row when two concurrent registrations use the identical email"
        status: pass
    human_judgment: false
  - id: D3
    description: "POST /auth/login issues a JWT on correct credentials; wrong password and non-existent email return the byte-identical generic 401"
    requirement: "AUTH-02"
    verification:
      - kind: unit
        ref: "src/auth/auth.service.spec.ts#validateUser (happy path + error case), login (JWT payload contains only sub)"
        status: pass
      - kind: e2e
        ref: "test/auth.e2e-spec.ts#POST /auth/login (3 cases: correct creds, wrong password, non-existent email)"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /auth/me requires a valid Bearer token (stateless verification, no DB lookup in JwtStrategy.validate) and always returns only the caller's own data, ignoring any client-supplied userId"
    requirement: "AUTH-03, AUTH-04"
    verification:
      - kind: e2e
        ref: "test/auth.e2e-spec.ts#GET /auth/me (3 cases: no header 401, valid token returns own data, client-supplied userId ignored)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every successful response is wrapped in a {data, timestamp} envelope; an unexpected extra DTO field returns 400 instead of being silently dropped"
    verification:
      - kind: e2e
        ref: "test/auth.e2e-spec.ts#response envelope (2 cases)"
        status: pass
    human_judgment: false
  - id: D6
    description: "App refuses to boot when a required env var is missing or malformed (Zod validate() throws)"
    requirement: "AUTH-01, AUTH-02, AUTH-03, AUTH-04"
    verification:
      - kind: manual_procedural
        ref: "node -e require('./dist/src/config/env.validation.js').validate({...missing JWT_ACCESS_SECRET}) — threw 'Invalid environment configuration'; full app boot manually confirmed via `docker compose up -d db && node dist/src/main.js` + curl against /auth/register, /auth/login, /auth/me"
        status: pass
    human_judgment: false

duration: ~50min (continuation session — Task 0 checkpoint had already been resolved before this session started)
completed: 2026-09-11
status: complete
---

# Phase 1 Plan 1: Authentication Walking Skeleton Summary

**NestJS 11.2.3 auth module: argon2id register/login, stateless 15-min JWT via `@CurrentUser()`, global `{data, timestamp}` response envelope — the userId-scoping pattern every later phase reuses.**

## Performance

- **Duration:** ~50 min (this continuation session; Task 0's checkpoint verification happened in a prior session)
- **Tasks:** 2 completed (Task 0 was a non-code verification checkpoint, already resolved before this session)
- **Files modified:** 33 (31 new + 2 modified across both commits)

## Accomplishments
- Bootstrapped the entire NestJS project from nothing: package.json pinned to CLAUDE.md's exact versions (NestJS 11.2.3, TypeScript 6.0.3, TypeORM 1.1.1, Node 24), Dockerized local Postgres 16, first migration creating the `users` table
- `POST /auth/register` → `POST /auth/login` → `GET /auth/me` works end-to-end against a real Postgres database, argon2id-hashed passwords, 15-minute stateless JWTs carrying only `sub`
- Established the `@CurrentUser()` / `JwtAuthGuard` / `userId`-scoping primitive every later domain module (Phase 2+) will import unchanged
- Global response envelope, strict validation (`whitelist` + `forbidNonWhitelisted`), and `ClassSerializerInterceptor` wired as DI providers so e2e tests and production share identical behavior
- 16 automated tests (5 unit + 11 e2e), all green; `npm run build` compiles clean

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end "register -> login -> protected route" — Walking Skeleton** - `5c7a960` (feat)
2. **Task 2: Global response consistency, validation, and password-exposure hardening** - `edcbd35` (feat)

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `src/auth/auth.service.ts` - register/validateUser/login/findById, argon2id hashing, dummy-hash timing mitigation
- `src/auth/auth.controller.ts` - POST /auth/register, POST /auth/login, GET /auth/me
- `src/auth/entities/user.entity.ts` - User TypeORM entity (id uuid, email unique+indexed, passwordHash @Exclude, timestamps)
- `src/auth/strategies/local.strategy.ts`, `src/auth/strategies/jwt.strategy.ts` - Passport strategies
- `src/auth/guards/local-auth.guard.ts`, `src/auth/guards/jwt-auth.guard.ts` - thin AuthGuard() subclasses
- `src/auth/decorators/current-user.decorator.ts` - @CurrentUser() ownership-scoping primitive
- `src/config/env.validation.ts` - Zod schema for the full env contract (DB_*, JWT_ACCESS_*, JWT_REFRESH_*, ALLOWED_ORIGINS, PORT)
- `src/database/data-source.ts`, `src/database/migrations/1789166140074-InitUsers.ts` - TypeORM CLI data source + initial migration
- `src/common/dto/response.dto.ts`, `src/common/interceptors/response.interceptor.ts` - {data, timestamp} envelope
- `src/app.module.ts` - ConfigModule/TypeOrmModule wiring + APP_PIPE/APP_INTERCEPTOR global providers
- `src/main.ts` - minimal bootstrap (global enhancers moved to AppModule providers)
- `test/auth.e2e-spec.ts` - 11 e2e cases covering every must_haves.truth in the plan
- `src/auth/auth.service.spec.ts` - 5 unit cases (register/validateUser/login, happy + error paths)
- `docker-compose.yml`, `.env.example`, `.gitignore` - local dev scaffolding

## Decisions Made
- Discrete `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` env vars rather than a single `DATABASE_URL`, matching docker-compose.yml's service variables one-to-one
- Global `ValidationPipe`/`ClassSerializerInterceptor`/`ResponseInterceptor` registered as `APP_PIPE`/`APP_INTERCEPTOR` DI providers in `AppModule`, not imperatively in `main.ts` — required so e2e tests (which never call `bootstrap()`) actually exercise the same global behavior as production
- `login()` relies solely on `JwtModule`'s configured default `signOptions.expiresIn` (from `JWT_ACCESS_EXPIRES_IN`) rather than also passing an explicit `'15m'` at the call site — one source of truth for D-03's 15-minute value
- Removed the NestJS CLI's default Hello-World scaffold files (`app.controller.ts`, `app.service.ts`, their spec, and the default `test/app.e2e-spec.ts`) since they aren't part of this plan's file list and this phase's only module is `AuthModule`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Global enhancers invisible to e2e tests**
- **Found during:** Task 2 (verifying the response-envelope e2e assertions)
- **Issue:** `ValidationPipe`/`ClassSerializerInterceptor`/`ResponseInterceptor` were registered imperatively in `main.ts`'s `bootstrap()`. NestJS e2e tests built via `Test.createTestingModule({imports:[AppModule]}).compile()` + `createNestApplication()` never call `bootstrap()`, so all three enhancers were silently absent in every e2e test — the suite would have been asserting against unwrapped, unvalidated responses despite the code appearing correct.
- **Fix:** Moved all three to `APP_PIPE`/`APP_INTERCEPTOR` DI providers in `AppModule`, which apply to every `INestApplication` built from that module regardless of how it's bootstrapped.
- **Files modified:** `src/app.module.ts`, `src/main.ts`
- **Verification:** `test/auth.e2e-spec.ts`'s "response envelope" cases now genuinely fail without the fix and pass with it (confirmed both ways during the session)
- **Committed in:** `edcbd35` (Task 2 commit)

**2. [Rule 3 - Blocking] TypeScript 6.0.3 / typescript-eslint program lost ambient Jest globals**
- **Found during:** Task 1 (running `npm run lint` for the first time)
- **Issue:** `describe`/`it`/`expect`/`jest.*` resolved as unresolvable types across every spec file under both plain `tsc --noEmit` and `typescript-eslint`'s type-aware linting, producing ~170 cascading "unsafe" errors — root cause was `@types/jest`'s ambient globals not being picked up by TypeScript's automatic `@types` inclusion under this project's `tsconfig.json` (module: nodenext / TS 6.0.3).
- **Fix:** Added an explicit `"types": ["jest", "node"]` to `tsconfig.json`'s `compilerOptions`, which restored ambient global resolution project-wide.
- **Files modified:** `tsconfig.json`
- **Verification:** `npx tsc --noEmit -p tsconfig.json` went from ~170 errors to 0; `npm run lint` dropped from 190 problems to 22 (all pre-existing, accepted `no-unsafe-argument` warnings on `app.getHttpServer()`, a known NestJS testing limitation)
- **Committed in:** `5c7a960` (Task 1 commit)

**3. [Rule 1 - Bug] TypeScript strict property initialization on entity/DTO fields**
- **Found during:** Task 1 (first `npm run build` and first migration generation)
- **Issue:** `User` entity and DTO classes (`RegisterDto`, `LoginDto`, `UserResponseDto`) declared properties without initializers, which TypeScript 6.0.3 flags (`TS2564`) even though `strict`/`strictPropertyInitialization` aren't explicitly set in this project's `tsconfig.json` — these classes are populated by TypeORM/class-validator reflection, never a constructor.
- **Fix:** Added definite-assignment assertions (`id!: string`, etc.) — the standard, idiomatic pattern for TypeORM entities and validator-hydrated DTOs.
- **Files modified:** `src/auth/entities/user.entity.ts`, `src/auth/dto/register.dto.ts`, `src/auth/dto/login.dto.ts`, `src/auth/dto/user-response.dto.ts`
- **Verification:** `npm run build` / migration generation compiled cleanly afterward
- **Committed in:** `5c7a960` (Task 1 commit)

**4. [Rule 3 - Blocking] Type-correctness fixes required for `npm run build` to pass**
- **Found during:** Task 1 (first `npm run build`)
- **Issue:** Three unrelated type errors blocked compilation: (a) `argon2.hash()`'s options object needed an explicit `argon2.HashOptions` annotation (not `Options`, which doesn't exist) so `type: argon2.argon2id` narrowed correctly instead of widening to `number`; (b) `@nestjs/jwt`'s `signOptions.expiresIn` expects the branded `ms` package's `StringValue` type, not a plain `string` from `ConfigService`; (c) `Reflector` is exported from `@nestjs/core`, not `@nestjs/common`.
- **Fix:** Typed the argon2 options constant as `argon2.HashOptions`; cast the env-sourced `expiresIn` value `as StringValue` (imported `type { StringValue } from 'ms'`); switched to `ConfigService.getOrThrow()` throughout (compile-time non-undefined, plus a clearer runtime failure than a silent `undefined`) and corrected the `Reflector` import path.
- **Files modified:** `src/auth/auth.service.ts`, `src/auth/auth.module.ts`, `src/auth/strategies/jwt.strategy.ts`, `src/app.module.ts`, `src/main.ts`
- **Verification:** `npm run build` compiles with zero errors
- **Committed in:** `5c7a960` (Task 1 commit)

---

**Total deviations:** 4 auto-fixed (2 Rule 1 bug fixes, 2 Rule 3 blocking-issue fixes)
**Impact on plan:** All four were necessary for correctness (deviation #1 in particular — without it, the e2e suite would have given false confidence that global validation/serialization/envelope behavior was active). No scope creep; no architectural changes.

## Issues Encountered
- Docker Desktop's daemon was not running at session start on this machine; started it and polled until ready before `docker compose up -d db` — no code impact, environment-only.
- Local ports 5432 and 3000 are already bound by an unrelated pre-existing Docker container from a different project on this machine (`medolai-postgres`, `medolai-api`). Used `DB_PORT=5433` in the local (gitignored) `.env` and port 3001 for the one-off manual boot verification — `.env.example` still documents the standard default (5432), and `docker-compose.yml` itself is unaffected (it maps whatever `DB_PORT` resolves to). Purely a local-machine detail; does not affect a clean machine or CI.
- `npm audit` reports 4 high-severity advisories, all transitively from `multer` (a dependency of `@nestjs/platform-express`, unrelated to file uploads which this phase never touches). The only available fix (`npm audit fix --force`) would downgrade `@nestjs/core` to a pre-v7 release, directly violating CLAUDE.md's pinned `@nestjs/core@^11.2.3`. Left as-is and flagged here — not actionable without either an upstream `@nestjs/platform-express` fix or accepting the downgrade, neither of which is this plan's call to make.

## User Setup Required

None - no external service configuration required. Local dev requires `docker compose up -d db` and a `.env` file (see `.env.example`) before `npm run start:dev`; both already validated end-to-end this session.

## Next Phase Readiness
- The `@CurrentUser()` / `JwtAuthGuard` / response-envelope pattern is proven end-to-end and ready for Phase 2's domain modules to reuse unchanged
- `.env`'s full contract (including `JWT_REFRESH_SECRET`/`JWT_REFRESH_EXPIRES_IN` and `ALLOWED_ORIGINS`) is already declared — Plans 01-02 and 01-03 read it via `ConfigService` without touching the schema
- Rate limiting (D-06) and CORS (`ALLOWED_ORIGINS` enforcement) are intentionally NOT implemented in this plan — per the plan's own objective, both are scoped to Plans 02-05 ("before layering refresh-token rotation, transport hardening, and rate limiting on top of it")
- No blockers for Plan 01-02

---
*Phase: 01-authentication-multi-tenant-foundation*
*Completed: 2026-09-11*

## Self-Check: PASSED

All 16 key files confirmed present on disk; both task commits (`5c7a960`, `edcbd35`) confirmed present in `git log --oneline --all`.
