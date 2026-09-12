---
phase: 01-authentication-multi-tenant-foundation
plan: 05
subsystem: testing
tags: [jest, e2e, cross-tenant, idor, security-review]

requires:
  - phase: 01-authentication-multi-tenant-foundation (Plans 01-04)
    provides: "The full auth module surface — register/login/me/refresh/logout, argon2id hashing, DB-backed refresh-token rotation + reuse detection, rate limiting, CORS/helmet/error-sanitization — this plan exercises all of it together from a two-user perspective"

provides:
  - "test/cross-tenant.e2e-spec.ts — a dedicated two-user IDOR/cross-tenant regression suite exercising every Plan 01-04 endpoint together, the pattern Phase 2+'s equivalent suites will mirror"
  - "A confirmed-green full suite (unit + e2e, all three e2e spec files) proving all four ROADMAP.md Phase 1 Success Criteria hold in combination, not just per-plan"
  - "An explicit, item-by-item security-review checklist report against the finished src/auth module (this SUMMARY's Security Review Checklist section)"

affects:
  - "Phase 2+ (Accounts, Categories, Transactions, Budgets, Reports) — inherits the userId-scoping pattern now proven under a real two-tenant adversarial sweep, and the two-user cross-tenant e2e suite structure as a template"

actuals:
  tokens: 3416   # chars/4 over test/cross-tenant.e2e-spec.ts (13664 chars) — the only code file this plan added; Task 2 added no new code, only ran the existing suite and produced this report
  tasks: 2
  commits: 2     # test(01-05) code commit + this docs(01-05) commit
plan_head_before: bd94c1b0873a4b6f14f3a0c465e71f8ae4d7228e

tech-stack:
  added: []
  patterns:
    - "Two-user cross-tenant e2e suite structure: a shared registerAndLogin(label) helper produces two independent Session objects (A, B), then every describe block proves an action taken with A's credentials/tokens never leaks into or affects B's, including a deliberate sweep of client-supplied userId/email overrides across query string, request body, and custom headers"
    - "Global ValidationPipe({whitelist:true, forbidNonWhitelisted:true}) doubles as an identity-override defense: any DTO extended with an unexpected userId/id/email field is rejected with 400 before the handler ever runs, proven directly rather than assumed"

key-files:
  created:
    - test/cross-tenant.e2e-spec.ts
  modified: []

key-decisions:
  - "Client-supplied-override sweep tests assert 400 (not a silently-ignored 200) for POST endpoints, because this codebase's global ValidationPipe uses forbidNonWhitelisted:true — an unexpected userId/id field in a register/login/refresh/logout body is rejected at the validation layer before the handler runs, which is a stronger and more directly-verifiable proof of no override than asserting the field was merely ignored"
  - "GET /auth/me override sweep (query string + custom header) asserts 200 with the caller's own data returned, since that endpoint has no query/header DTO to reject unknown parameters — the ownership guarantee there comes entirely from @CurrentUser() sourcing its value from the verified JWT payload, never from any other part of the request"
  - "Reuse-detection test additionally queries refreshTokensRepository directly to assert A's full token family (both original and rotated) is revoked while B's sibling row remains unrevoked — asserting the underlying DB state directly, not just observable 401/200 behavior"

requirements-completed: [AUTH-01, AUTH-02, AUTH-03, AUTH-04]

coverage:
  - id: D1
    description: "Two independent users' data, tokens, and refresh-token families never cross-contaminate across register/login/me/refresh/logout, including under a deliberate client-supplied userId/email override sweep in query, body, and header"
    requirement: "AUTH-01, AUTH-02, AUTH-03, AUTH-04"
    verification:
      - kind: e2e
        ref: "test/cross-tenant.e2e-spec.ts (10 cases, all passing) — GET /auth/me isolation, refresh-token family scoping/rotation, logout non-interference, reuse-detection family-scoped revocation, and the full register/login/me/refresh/logout override sweep"
        status: pass
    human_judgment: false
  - id: D2
    description: "The complete automated suite (unit + all three e2e spec files: auth.e2e-spec.ts, cross-tenant.e2e-spec.ts, security.e2e-spec.ts) is green in one run, confirmed twice consecutively with no flakiness"
    verification:
      - kind: unit
        ref: "npm run test — 12/12 passing"
        status: pass
      - kind: e2e
        ref: "npm run test:e2e — 34/34 passing (3 suites), run twice consecutively"
        status: pass
    human_judgment: false
  - id: D3
    description: "security-review skill checklist walked item-by-item against the finished src/auth module, reported in ✅ Aplicado / ⚠️ Atenção format with no item silently marked done"
    verification: []
    human_judgment: true
    rationale: "The checklist narrative itself (this SUMMARY's Security Review Checklist section) is a human-readable judgment report citing specific files/lines/tests per item — the underlying claims are each backed by an automated test or a direct code citation, but the completeness of the walkthrough as a whole is reasonably a human sign-off point, consistent with how 01-03/01-04's SUMMARYs treated the same checklist."

duration: ~15min
completed: 2026-09-12
status: complete
---

# Phase 1 Plan 5: Cross-Tenant Regression Suite & Security Review Close-Out Summary

**Two-user IDOR/cross-tenant e2e suite (10 cases) proving every Plan 01-04 auth endpoint holds isolation together, plus a full 46-test green suite and an explicit security-review checklist close-out for the finished `src/auth` module.**

## Performance
- **Duration:** ~15 min
- **Tasks:** 2 completed
- **Files modified:** 1 (test/cross-tenant.e2e-spec.ts, new)

## Accomplishments
- `test/cross-tenant.e2e-spec.ts` (10 passing cases): two independent users (A, B) registered and logged in via a shared helper, then every endpoint from Plans 01-04 exercised together — `GET /auth/me` identity isolation, refresh-token family scoping and rotation independence, logout non-interference, reuse-detection revoking only the offending user's token family (proven against `refresh_tokens` directly, not just HTTP status codes), and a full override sweep proving no endpoint honors a client-supplied `userId`/`email`/`id` for register, login, me (query + header), refresh, or logout
- Confirmed the full automated suite green: `npm run test` (12/12 unit) and `npm run test:e2e` (34/34 across `auth.e2e-spec.ts`, `cross-tenant.e2e-spec.ts`, `security.e2e-spec.ts`), the latter run twice consecutively with identical results
- Walked the `security-review` skill's "Aplicação (NestJS)" checklist item-by-item against the finished `src/auth` module (see Security Review Checklist below)

## Task Commits
1. **Task 1: Comprehensive two-user cross-tenant regression suite** - `120a5d0` (test)
2. **Task 2: Full-suite regression + security-review checklist report** - no code changes (existing suite already green); reported in this SUMMARY

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `test/cross-tenant.e2e-spec.ts` - two-user cross-tenant/IDOR regression suite (10 cases): identity isolation, refresh-token family scoping, reuse-detection scoping, and a full client-supplied-identity-override sweep across register/login/me/refresh/logout

## Security Review Checklist

Applied directly against the finished `src/auth` module (register, login, me, refresh, logout, plus the global `AppModule`/`main.ts` cross-cutting concerns all of it runs under). The `security-review` Skill's own script could not run (no `origin` remote in this local-only repo, same limitation noted in 01-03-SUMMARY.md), so the checklist from `.claude/skills/security-review/SKILLS.md` was applied manually, item by item.

### Aplicação (NestJS)

✅ Aplicado:
- **Todo endpoint tem DTO com validação (class-validator)** — `RegisterDto`/`LoginDto`/`RefreshDto` all use `@IsEmail()`/`@IsString()`/`@MinLength()`/`@MaxLength()`; global `ValidationPipe({whitelist:true, forbidNonWhitelisted:true, transform:true})` in `src/app.module.ts` rejects any payload with an undeclared field. Verified this plan by `test/cross-tenant.e2e-spec.ts`'s override sweep: register/login/refresh/logout with an extra `userId`/`id` field all return 400, never silently accepted.
- **Toda query usa TypeORM parametrizado** — every DB access in `src/auth/auth.service.ts` goes through `Repository` methods (`findOne`, `find`, `update`, `save`, `count`); zero raw SQL or string concatenation anywhere in the module.
- **Nenhum segredo hardcoded** — `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`/`DB_*` are all sourced via `ConfigService.getOrThrow()`, validated at boot by `src/config/env.validation.ts` (Zod); `.env` is gitignored (`.gitignore` line `.env`); `.env.example` contains only placeholder values.
- **Endpoint com dados protegidos verifica ownership (evitar IDOR)** — `GET /auth/me`'s `@CurrentUser()` decorator sources its value exclusively from `JwtStrategy.validate()`'s verified payload (`request.user.userId`), never from any client-supplied query/body/header value. Proven this plan by `test/cross-tenant.e2e-spec.ts`'s full sweep (query-string override, `X-User-Id` header override — both ignored, own data returned). No other financial-data endpoint exists yet in Phase 1; this check re-applies to each new resource type starting Phase 2.
- **Rate limiting em endpoints públicos (login, cadastro)** — `@Throttle({limit:5, ttl:seconds(60)})` on `POST /auth/login`, `@Throttle({limit:3, ttl:seconds(60)})` on `POST /auth/register`, global `100/60s` default for everything else (Plan 01-04). Verified by `test/auth.e2e-spec.ts`'s `rate limiting (throttler)` describe block.
- **CORS configurado com origem explícita, nunca \*** — `configureApp()` in `src/main.ts` calls `app.enableCors({origin: allowedOrigins, credentials: true})`, where `allowedOrigins` is parsed from `ALLOWED_ORIGINS` (never `'*'`, never `origin: true`). Verified by `test/security.e2e-spec.ts`'s CORS tests (allowlisted origin echoed, disallowed origin gets no `Access-Control-Allow-Origin` header).
- **Mensagens de erro não vazam stack trace, nome de tabela ou versão de dependência** — global `HttpExceptionFilter` (`src/common/filters/http-exception.filter.ts`) forwards already-sanitized `HttpException`s as-is, and for any unexpected/unhandled error logs the real stack server-side only and returns a fixed `{statusCode:500, message:"Internal server error"}` body — verified by `test/security.e2e-spec.ts`'s "never leaks a stack trace" test, which asserts the response body contains no file path, `at ...` frame, or the underlying error message.
- **Senhas com hash (argon2), nunca texto plano ou hash fraco** — `argon2.hash()` with `argon2id`, `memoryCost:19456` (OWASP minimum), `timeCost:2`; `passwordHash` is `@Exclude()`-decorated on the `User` entity and `UserResponseDto` never spreads the entity, so it's structurally impossible for a hash to leak into any response.
- **JWT com expiração curta; refresh token tratado separadamente** — access token: 15 minutes (D-03, `JWT_ACCESS_EXPIRES_IN`), stateless, payload carries only `sub`. Refresh token: 7 days, DB-backed (`refresh_tokens` table), SHA-256-hashed at rest, rotated on every use with full-family reuse-detection revocation (D-04, Plan 01-03) — entirely separate lifecycle and storage from the access token.

⚠️ Atenção (carried forward, not newly discovered by this plan):
- `POST /auth/refresh` and `POST /auth/logout` remain unauthenticated-by-design (the refresh token itself is the credential) and are governed only by the global `100/60s` default, not a tighter per-route limit — flagged already in 01-03-SUMMARY.md; still an open decision for whichever future pass wants tighter defense-in-depth on those two routes.
- `npm audit` still reports 5 high-severity advisories, all transitively from `multer` via `@nestjs/platform-express` (unrelated to file uploads, which this project never uses). The only fix (`npm audit fix --force`) downgrades `@nestjs/core` below CLAUDE.md's pinned `^11.2.3` — not actionable without either an upstream fix or violating the pinned stack, consistent with 01-01/01-04's prior documentation of the same issue.

### Infraestrutura AWS

⚠️ Atenção — not applicable to Phase 1's scope. No AWS infrastructure exists yet (ECS/RDS/Secrets Manager/ALB arrive in Phases 7-9 per ROADMAP.md); this section's items (IAM least-privilege, Secrets Manager for DB credentials, `publicly_accessible=false`, ALB HTTPS enforcement, no sensitive data in CloudWatch logs) will be verified when Phase 8 (AWS Infrastructure) is planned and built.

### Pipeline

⚠️ Atenção — not applicable to Phase 1's scope. No CI/CD pipeline exists yet (Phase 9 per ROADMAP.md); `npm audit` is run manually today (see the multer finding above) rather than as a CI gate, and there is no Dockerfile/`.dockerignore` yet since containerization is Phase 7. This section's items will be verified when Phase 9 (CI/CD) is planned and built.

## Decisions Made
- Client-supplied-override tests for POST endpoints (register/login/refresh/logout) assert HTTP 400, not a silently-ignored 200 — this codebase's `forbidNonWhitelisted:true` global pipe rejects any DTO with an unexpected field, which is a stronger, more directly-verifiable proof of "no override accepted" than checking the override was merely ignored.
- `GET /auth/me`'s override sweep asserts 200-with-own-data (not a rejection), since that route has no query/header-bound DTO — its ownership guarantee is structural (`@CurrentUser()` sourced only from the verified JWT), not validation-layer rejection, so the test proves the actual mechanism rather than a coincidental side effect of unrelated validation.
- Reuse-detection's cross-tenant test additionally asserts against `refresh_tokens` table state directly (every row for A revoked, at least one row for B still unrevoked) rather than relying solely on HTTP response codes, for a stronger proof of family-scoped (not global) revocation.

## Deviations from Plan

None - plan executed exactly as written. The full suite (`npm run test`, `npm run test:e2e`) was already green using only the code that existed at the start of this plan plus the one new test file; no bugs, missing functionality, or blocking issues were discovered while writing or running `test/cross-tenant.e2e-spec.ts`.

## Issues Encountered
None. Docker Desktop and the shared `financialcontrol-db-1` Postgres container (port 5433) were already running from the prior session; no environment setup was required.

## Flagged Assumptions Carried Forward

From this plan's Task 2 (recorded here per plan instruction, not resolved by this plan — carried forward for future phases' visibility):
- AUTH-01 and AUTH-03 each had one edge-probe category the deterministic classifier could not resolve ("unclassified") during planning — reviewed manually; no additional edge case was identified beyond what Plans 01-04 already cover, but this is a judgment call recorded here for visibility, not a mechanically-verified closure.
- AUTH-04's "ordering" edge-probe category (stable sort order when elements compare equal) has no applicable surface in Phase 1 — no list/collection endpoint exists yet (only `/auth/me`, a single-resource lookup). Revisit when Phase 2 (Accounts) introduces the first `userId`-scoped list endpoint.
- Three prohibition-probe candidates were canon-referred (not minted as bespoke prohibitions, per the canon-referral rule): JWT algorithm-confusion/weak-secret handling (canon OWASP crypto guidance — already covered by `@nestjs/jwt`'s built-in alg pinning, breadcrumb to `/gsd-secure-phase`), IDOR differential 403-vs-404 response-shape disclosure (canon OWASP IDOR guidance — no `:id`-parameterized resource endpoint exists in Phase 1 to apply it to; breadcrumb to `/gsd-secure-phase` and Phase 2's first `:id` routes), and user enumeration via `/auth/register`'s "email already taken" response (canon OWASP enumeration guidance, standard UX tradeoff; breadcrumb to `/gsd-secure-phase`).

## User Setup Required
None - no external service configuration required. Local dev requires `docker compose up -d db` (already validated) before running `npm run test:e2e`.

## Next Phase Readiness
Phase 1 complete, ready for Phase 2 (Accounts). All four ROADMAP.md Phase 1 Success Criteria are now demonstrably true in combination (not just per-plan): signup hashes correctly, login issues a working JWT pair with generic-error protection, protected routes require a valid stateless-verified token, and no user's data is ever reachable through another user's session — including under a deliberate cross-tenant adversarial sweep. The `userId`-scoping pattern (`@CurrentUser()` sourced strictly from the verified JWT, never client input) and the two-user cross-tenant e2e suite structure are both ready for Phase 2's domain modules to reuse and mirror unchanged. No blockers for Phase 2.

---
*Phase: 01-authentication-multi-tenant-foundation*
*Completed: 2026-09-12*
