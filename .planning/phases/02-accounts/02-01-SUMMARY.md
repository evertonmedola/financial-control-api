---
phase: 02-accounts
plan: 01
subsystem: api
tags: [nestjs, typeorm, postgres, accounts, decimal-money, e2e-testing]

requires:
  - phase: 01-authentication-multi-tenant-foundation
    provides: JwtAuthGuard, @CurrentUser() decorator, global ValidationPipe/ResponseInterceptor/ClassSerializerInterceptor, users table + migration convention
provides:
  - "POST /accounts — authenticated account creation for any of the four supported types (corrente, poupanca, carteira, cartao_credito)"
  - "Account entity + accounts table (decimal(12,2) balance, soft-delete deletedAt column, userId FK+index)"
  - "AccountsService.create() as the module's write path; AccountsService.adjustBalance() reserved stub for Phase 4's transaction-driven balance mutation"
  - "AccountsModule exporting AccountsService for future TransactionsModule injection"
  - "test/accounts.e2e-spec.ts — 13 e2e cases covering all types, decimal precision, idempotency, concurrency, invalid-type rejection, and IDOR-on-create"
affects: [02-accounts (02-02, 02-03), 04-transactions-transfers]

actuals:
  tokens: 4900
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Money as PostgreSQL numeric(12,2), validated as a decimal-string regex (never @IsNumber()), typed string end-to-end through entity/DTO — never parseFloat'd"
    - "Credit card balance = positive 'amount owed' (D-01), no sign-flip anywhere in the write path"
    - "Guard applied at controller level (@UseGuards(JwtAuthGuard) above @Controller) rather than per-route, since every Accounts route requires auth"
    - "Reserved single write-path method (adjustBalance) declared but unrouted, to be called only by a future module — establishes the module-boundary rule ahead of the code that will need it"

key-files:
  created:
    - src/accounts/entities/account.entity.ts
    - src/database/migrations/1789300000000-CreateAccounts.ts
    - src/accounts/dto/create-account.dto.ts
    - src/accounts/dto/account-response.dto.ts
    - src/accounts/accounts.service.ts
    - src/accounts/accounts.controller.ts
    - src/accounts/accounts.module.ts
    - src/accounts/accounts.service.spec.ts
    - test/accounts.e2e-spec.ts
  modified:
    - src/app.module.ts

key-decisions:
  - "AccountsService.adjustBalance() is intentionally unrouted this phase (throws 'not implemented until Phase 4') — establishes the single write-path signature ARCHITECTURE.md requires before Phase 4's TransactionsService exists to call it"
  - "Guard placement moved to controller level (@UseGuards(JwtAuthGuard) on the class) rather than per-route as in AuthController, since every Accounts route requires auth and there is no public register/login-equivalent in this module"

patterns-established:
  - "Domain module layout mirrors src/auth/ exactly: entities/, dto/, <domain>.service.ts, <domain>.controller.ts, <domain>.module.ts"
  - "e2e specs bootstrap via Test.createTestingModule({imports:[AppModule]}).overrideProvider(ThrottlerGuard).useValue(noopThrottlerGuard), mirroring auth.e2e-spec.ts/cross-tenant.e2e-spec.ts"

requirements-completed: []  # ACCT-01/ACCT-03 shared with 02-02/02-03; not yet ready per requirements.ready-ids (0/2 ready)

coverage:
  - id: D1
    description: "POST /accounts creates an account of any of the four types with a decimal-safe initial balance and returns 201 with the created account"
    requirement: "ACCT-01"
    verification:
      - kind: e2e
        ref: "test/accounts.e2e-spec.ts#create account"
        status: pass
    human_judgment: false
  - id: D2
    description: "Credit card balance is stored/returned as a positive 'amount owed', never sign-flipped (D-01/ACCT-03)"
    requirement: "ACCT-03"
    verification:
      - kind: e2e
        ref: "test/accounts.e2e-spec.ts#POST /accounts creates a cartao_credito account and returns the balance unchanged"
        status: pass
    human_judgment: false
  - id: D3
    description: "Decimal balance round-trips as an exact string (no float rounding); >2 decimal places rejected 400, exactly 2 accepted"
    verification:
      - kind: e2e
        ref: "test/accounts.e2e-spec.ts#round-trips a decimal balance exactly / decimal-place boundary tests"
        status: pass
    human_judgment: false
  - id: D4
    description: "Account creation is not idempotent and is concurrency-safe — two identical/simultaneous POSTs both succeed with distinct ids"
    verification:
      - kind: e2e
        ref: "test/accounts.e2e-spec.ts#idempotency / concurrency tests"
        status: pass
    human_judgment: false
  - id: D5
    description: "Invalid account type and spoofed userId are both rejected with 400 (prohibition P1, Pitfall 3/IDOR)"
    verification:
      - kind: e2e
        ref: "test/accounts.e2e-spec.ts#rejects an invalid/unrecognized type / rejects a client-supplied userId field"
        status: pass
    human_judgment: false
  - id: D6
    description: "AccountsService.adjustBalance() reserved stub exists as the module's single future write-path for balance mutation, not yet routed"
    verification:
      - kind: unit
        ref: "src/accounts/accounts.service.spec.ts#adjustBalance throws — reserved stub not yet callable"
        status: pass
    human_judgment: false

duration: ~30min
completed: 2026-09-12
status: complete
---

# Phase 2 Plan 01: Create-Account Vertical Slice Summary

**POST /accounts end-to-end for all four account types, with decimal-safe `numeric(12,2)` balances, the D-01 credit-card-as-positive-liability convention, and a reserved single write-path stub for Phase 4's balance mutation.**

## Performance
- **Duration:** ~30min (includes an unplanned Docker Desktop cold-start to bring the local dev Postgres container online)
- **Tasks:** 2
- **Files modified:** 10 (9 created, 1 modified)

## Accomplishments
- Delivered the first working vertical slice of the Accounts module: entity, migration, DTOs, service, controller, module, wired into `AppModule`, and proven against the real migrated database via 13 e2e assertions plus 2 unit tests.
- Established `AccountsService.adjustBalance()` as the reserved, unrouted single write-path for balance mutation ahead of Phase 4, per `ARCHITECTURE.md`'s module-boundary rule.
- Proved the money-as-decimal-string contract (Pitfall 1) and the credit-card liability sign convention (D-01) end-to-end, including the exact `'1234.56'` round-trip and the 2-decimal-place validation boundary.
- Proved creation is intentionally non-idempotent and safe under concurrency (`Promise.all` of two simultaneous `POST /accounts` calls both succeed with distinct ids), and that invalid `type` values and a spoofed `userId` field are both rejected with 400.

## Task Commits
1. **Task 1: End-to-end "create account" — one type, one path (tracer)** - `6e6c86b` (feat)
2. **Task 2: Validation, decimal, idempotency, concurrency, and IDOR hardening for account creation** - `7cc8d24` (test)

## Files Created/Modified
- `src/accounts/entities/account.entity.ts` - `AccountType` enum + `Account` entity (decimal-safe balance, soft-delete `deletedAt`, `userId` index)
- `src/database/migrations/1789300000000-CreateAccounts.ts` - `accounts` table DDL, `accounts_type_enum`, `IDX_accounts_user_id`, FK to `users`
- `src/accounts/dto/create-account.dto.ts` - `CreateAccountDto` with decimal-string `balance` validation
- `src/accounts/dto/account-response.dto.ts` - `AccountResponseDto` explicit-construction response shape
- `src/accounts/accounts.service.ts` - `AccountsService.create()` + `adjustBalance()` reserved stub
- `src/accounts/accounts.controller.ts` - `POST /accounts` route, guard at controller level
- `src/accounts/accounts.module.ts` - module wiring, exports `AccountsService`
- `src/accounts/accounts.service.spec.ts` - unit tests (create happy path, adjustBalance error case)
- `test/accounts.e2e-spec.ts` - 13 e2e cases (all 4 types, decimal precision, idempotency, concurrency, invalid-type, IDOR-on-create)
- `src/app.module.ts` - `AccountsModule` added to imports

## Decisions Made
See `key-decisions` in frontmatter — `adjustBalance()` left intentionally unrouted this phase; `JwtAuthGuard` moved to controller level (small deliberate deviation from `AuthController`'s per-route placement, per `02-PATTERNS.md`'s explicit guidance).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Local dev Postgres was unreachable (Docker Desktop not running)**
- **Found during:** Task 1, before running `npm run migration:run`
- **Issue:** `docker ps` failed to connect to the Docker Desktop engine (`npipe` not found); the app's configured `DB_PORT` (5433, per `.env`) had nothing listening.
- **Fix:** Started Docker Desktop, waited for the engine to come up, then ran `docker compose up -d` to bring the `db` service to a healthy state before proceeding.
- **Files modified:** None (environment-only).
- **Verification:** `npm run migration:run` connected successfully and applied both the pending `AddRefreshTokensUserFk` migration (left over from Phase 1, not yet run in this dev DB) and this plan's new `CreateAccounts` migration.
- **Commit:** N/A (no file change).

**2. [Rule 3 - Blocking issue] ESLint errors introduced by Task 1/2's own new code**
- **Found during:** Task 2, running `npx eslint` on the new/modified files as part of pre-commit hygiene (this project's pre-commit hook runs lint).
- **Issue:** `accounts.service.ts`'s `adjustBalance()` stub tripped `require-await` (async with no await) and `no-unused-vars` (unused reserved parameters); `accounts.service.spec.ts` tripped `unbound-method` and `no-unnecessary-type-assertion` from `expect(mock).toHaveBeenCalledWith(...)`-style assertions; `create-account.dto.ts` had a prettier import-wrap violation; `test/accounts.e2e-spec.ts` had one unnecessary type assertion.
- **Fix:** Kept `adjustBalance()` `async` (needed so the stub's error surfaces as a promise rejection, matching the real Phase 4 signature) with a scoped `eslint-disable-next-line @typescript-eslint/require-await`, and prefixed its reserved parameters with `_` per the project's `argsIgnorePattern: '^_'`. Rewrote the unit test's assertions using the `.mock.calls[]` pattern already established in `auth.service.spec.ts` instead of `toHaveBeenCalledWith` on a raw method reference. Ran `prettier --write` on the DTO. Simplified the e2e spec's optional-chaining expression to remove the redundant assertion.
- **Files modified:** `src/accounts/accounts.service.ts`, `src/accounts/accounts.service.spec.ts`, `src/accounts/dto/create-account.dto.ts`, `test/accounts.e2e-spec.ts`.
- **Verification:** `npx eslint` on all touched files now reports 0 errors (only the same pre-existing `no-unsafe-argument` warnings on `app.getHttpServer()` that already exist in `auth.e2e-spec.ts`/`cross-tenant.e2e-spec.ts`); full `npm run test`, `npm run test:e2e`, and `npm run build` all still pass.
- **Commit:** `7cc8d24`.

**Total deviations:** 2 auto-fixed (1 environment/blocking, 1 lint/blocking). **Impact on plan:** None on scope or acceptance criteria — both were incidental to getting the plan's own verification commands to run cleanly; no production behavior changed as a result of either fix.

## Issues Encountered
None beyond the two deviations above.

## User Setup Required
None — Docker Desktop and the local Postgres container were started by this session; no external service configuration required. (Docker Desktop must be running for local development going forward, same as before this plan.)

## Next Phase Readiness
`AccountsService`/`AccountsModule` are in place and exported, ready for 02-02 (list/view/update/delete) and 02-03 to build on directly. `adjustBalance()`'s reserved signature is ready for Phase 4's `TransactionsService` to call once transactions exist. `ACCT-01`/`ACCT-03` are not yet marked complete in `REQUIREMENTS.md` — both are shared with sibling plans 02-02/02-03 still in progress; `requirements.ready-ids` correctly reported 0/2 ready this run.

---
*Phase: 02-accounts*
*Completed: 2026-09-12*

## Self-Check: PASSED

All 9 created/modified source files and this SUMMARY.md confirmed present on disk; all 3 commits (`6e6c86b`, `7cc8d24`, `49392ee`) confirmed present in `git log --all`.
