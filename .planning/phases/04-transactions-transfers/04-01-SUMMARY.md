---
phase: 04-transactions-transfers
plan: 01
subsystem: api
tags: [nestjs, typeorm, postgres, decimal-arithmetic, pessimistic-locking, transactions]

# Dependency graph
requires:
  - phase: 02-accounts
    provides: "AccountsService (findOne, reserved adjustBalance stub), Account entity with decimal balance column"
  - phase: 03-categories
    provides: "CategoriesService.findOne for ownership-chain validation"
provides:
  - "src/common/decimal.util.ts — addDecimalStrings/negateDecimalString, BigInt-cents exact decimal arithmetic"
  - "AccountsService.adjustBalance(manager, userId, id, delta) — real implementation, pessimistic_write row lock inside a caller-supplied EntityManager transaction"
  - "Transaction entity + CreateTransactions1789500000000 migration (income/expense/transfer discriminator, CHK_transactions_type_shape defense-in-depth constraint)"
  - "TransactionsService.create — ownership-chain validation + QueryRunner transaction + adjustBalance call"
  - "POST /transactions (income/expense only, D-02) — TransactionsController/Module registered in AppModule"
affects: [04-02-transactions-crud, 04-03-transfers, 05-budgets, 06-reports]

# Actuals (#2632)
actuals:
  tokens: 11532
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Decimal-safe money arithmetic via BigInt cents (no decimal.js/big.js dependency) — addDecimalStrings/negateDecimalString"
    - "Single write-path for balance mutation: AccountsService.adjustBalance is the ONLY method that ever changes Account.balance, always called with a caller-owned QueryRunner EntityManager"
    - "Nullable UUID columns require explicit @Column({ type: 'uuid' }) — a `string | null` union reflects as design:type Object, which TypeORM/Postgres rejects with DataTypeNotSupportedError if no explicit column type is given"

key-files:
  created:
    - src/common/decimal.util.ts
    - src/common/decimal.util.spec.ts
    - src/transactions/entities/transaction.entity.ts
    - src/database/migrations/1789500000000-CreateTransactions.ts
    - src/transactions/dto/create-transaction.dto.ts
    - src/transactions/dto/transaction-response.dto.ts
    - src/transactions/transactions.service.ts
    - src/transactions/transactions.service.spec.ts
    - src/transactions/transactions.controller.ts
    - src/transactions/transactions.module.ts
    - test/transactions.e2e-spec.ts
  modified:
    - src/accounts/accounts.service.ts
    - src/accounts/accounts.service.spec.ts
    - src/app.module.ts

key-decisions:
  - "AccountsService.adjustBalance signature changed to accept a caller-supplied EntityManager as its first parameter (not userId-first) so TransactionsService's QueryRunner transaction and 04-03's TransfersService (two calls in one transaction) share the identical commit/rollback boundary"
  - "Nullable UUID entity columns (accountId, fromAccountId, toAccountId, categoryId) require an explicit type: 'uuid' — TypeORM's reflect-metadata inference returns Object for a `string | null` TS union, which Postgres cannot map"

patterns-established:
  - "Every future balance-mutating service (04-03 TransfersService) must call adjustBalance with its own QueryRunner's EntityManager — never call it outside an open transaction"
  - "Decimal money DTOs use @Matches with a precision- and overflow-aware regex (10-digit integer cap matching numeric(12,2), negative lookahead excluding all-zero) rather than @IsNumber — no float ever touches a money field"

requirements-completed: [TXN-01, TXN-05]

coverage:
  - id: D1
    description: "POST /transactions creates an income or expense transaction and updates the linked account's balance atomically in the same request (TXN-01)"
    requirement: "TXN-01"
    verification:
      - kind: e2e
        ref: "test/transactions.e2e-spec.ts#POST /transactions creates an expense and updates the linked account balance in the same request"
        status: pass
      - kind: e2e
        ref: "test/transactions.e2e-spec.ts#POST /transactions creates an income and increases the linked account balance by the exact amount"
        status: pass
    human_judgment: false
  - id: D2
    description: "Monetary amounts round-trip exactly with no floating-point drift — 1000 sequential additions and a precise create-response round-trip both hold exactly (TXN-05)"
    requirement: "TXN-05"
    verification:
      - kind: unit
        ref: "src/common/decimal.util.spec.ts#accumulates 1000 sequential additions of 0.10 to exactly 100.00 (precision stress test)"
        status: pass
      - kind: e2e
        ref: "test/transactions.e2e-spec.ts#round-trips a precise amount exactly — 1234.56 returns data.amount === 1234.56 (TXN-05)"
        status: pass
    human_judgment: false
  - id: D3
    description: "AccountsService.adjustBalance implemented for real with pessimistic row locking — two concurrent expense creates against the same account never lose an update (Pitfall 2)"
    verification:
      - kind: unit
        ref: "src/accounts/accounts.service.spec.ts#adjustBalance locks the account row via pessimistic_write and applies the delta (happy path)"
        status: pass
      - kind: e2e
        ref: "test/transactions.e2e-spec.ts#two concurrent expense creations against the same account never lose an update (edge-probe: concurrency, Pitfall 2)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Ownership-chain IDOR protection — cross-tenant accountId/categoryId references and client-supplied userId are both rejected before any mutation (Pitfall 3)"
    verification:
      - kind: e2e
        ref: "test/transactions.e2e-spec.ts#an accountId or categoryId belonging to another user returns 404, never 403/201 (Pitfall 3, IDOR)"
        status: pass
      - kind: e2e
        ref: "test/transactions.e2e-spec.ts#rejects a client-supplied userId field with 400 instead of honoring it (Pitfall 3 / IDOR)"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-09-13
status: complete
---

# Phase 4 Plan 1: Transaction Creation with Decimal-Safe Balance Mutation Summary

**BigInt-cents decimal arithmetic + AccountsService.adjustBalance made real (pessimistic_write locking) power a fully working POST /transactions endpoint, proven exact under precision, boundary, idempotency, concurrency, and IDOR adversarial testing.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-13 (session start)
- **Completed:** 2026-09-13T23:33:07Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments
- Exact decimal-string arithmetic (`addDecimalStrings`/`negateDecimalString`) via BigInt cents — no `parseFloat`/`Number()`/unary `+` anywhere, no new npm dependency
- `AccountsService.adjustBalance()` implemented for real, closing the Phase 2 reserved stub — pessimistic-locked, `EntityManager`-scoped, the single write-path for `Account.balance`
- `Transaction` entity + hand-written migration with a DB-level `CHK_transactions_type_shape` defense-in-depth constraint enforcing D-01's mutual-exclusivity rule
- `POST /transactions` end-to-end: DTO validation (income/expense only, D-02; zero/negative/overflow/over-precision rejection) → ownership-chain validation → single-account `QueryRunner` transaction → balance mutation → response
- Adversarial test coverage: 1000-addition precision stress test, boundary probes, idempotency-by-duplication, concurrent-expense lost-update proof, cross-tenant IDOR, client-supplied-userId rejection — all passing with zero production-code changes needed in Task 2

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end "create expense transaction updates account balance" (tracer)** - `401614f` (feat)
2. **Task 2: Boundary, precision, idempotency, concurrency, and IDOR hardening** - `bd31b00` (test)

**Plan metadata:** commit pending (this SUMMARY + STATE/ROADMAP are the orchestrator's responsibility after merge per this plan's parallel-execution contract)

## Files Created/Modified
- `src/common/decimal.util.ts` - BigInt-cents `addDecimalStrings`/`negateDecimalString`, no float anywhere
- `src/common/decimal.util.spec.ts` - happy-path + 1000-addition precision stress test
- `src/accounts/accounts.service.ts` - real `adjustBalance(manager, userId, id, delta)` replacing the Phase 2 stub
- `src/accounts/accounts.service.spec.ts` - `adjustBalance` happy-path (pessimistic_write lock, delta applied) + 404 error-case tests
- `src/transactions/entities/transaction.entity.ts` - `TransactionType` enum + `Transaction` entity (D-01 shape)
- `src/database/migrations/1789500000000-CreateTransactions.ts` - `transactions` table, enum, FKs, userId index, `CHK_transactions_type_shape`
- `src/transactions/dto/create-transaction.dto.ts` - `@IsIn` (not `@IsEnum`) type restriction, overflow/precision-aware amount regex
- `src/transactions/dto/transaction-response.dto.ts` - explicit-construction response DTO, never spreads the entity
- `src/transactions/transactions.service.ts` - `create()`: ownership-chain validation + `QueryRunner` transaction calling `adjustBalance`
- `src/transactions/transactions.service.spec.ts` - mocked-repository unit tests (ownership order, delta sign, rollback-on-error)
- `src/transactions/transactions.controller.ts` - `POST /transactions`
- `src/transactions/transactions.module.ts` - imports `AccountsModule`/`CategoriesModule`, exports `TransactionsService`
- `src/app.module.ts` - `TransactionsModule` added to imports
- `test/transactions.e2e-spec.ts` - full create-transaction adversarial suite (12 tests)

## Decisions Made
- `AccountsService.adjustBalance`'s new real signature places the caller-supplied `EntityManager` first (`manager, userId, id, delta`), matching 04-PATTERNS.md's prescribed shape exactly, so 04-03's `TransfersService` can call it twice inside one shared transaction without any signature friction.
- Nullable UUID entity columns require an explicit `type: 'uuid'` in the `@Column` decorator — discovered via a real `DataTypeNotSupportedError` during `migration:run` (see Deviations below), not merely inferred from the plan text.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Nullable UUID columns needed explicit `type: 'uuid'`**
- **Found during:** Task 1 (first `npm run migration:run` against the entity as originally written per the plan/pattern-map text)
- **Issue:** `accountId`/`fromAccountId`/`toAccountId`/`categoryId` were declared as `@Column({ name: '...', nullable: true }) field!: string | null;` (matching the plan's literal action text and 04-PATTERNS.md's draft). TypeORM's reflect-metadata-based type inference resolves a `string | null` TS union to `Object`, which Postgres rejects: `DataTypeNotSupportedError: Data type "Object" in "Transaction.accountId" is not supported by "postgres" database.`
- **Fix:** Added explicit `type: 'uuid'` to all four nullable UUID columns' `@Column` options.
- **Files modified:** `src/transactions/entities/transaction.entity.ts`
- **Verification:** `npm run migration:run` completes cleanly; all e2e/unit tests pass.
- **Committed in:** `401614f` (Task 1 commit — the entity was fixed before its first commit, so no separate fix commit was needed)

**2. [Rule 1 - Bug] Lint fixes: unbound-method references and unnecessary type assertions in new unit tests**
- **Found during:** Task 1 (post-implementation lint pass)
- **Issue:** `expect(mockManager.findOne).toHaveBeenCalledWith(...)` triggered `@typescript-eslint/unbound-method` (property-access to a typed `EntityManager` method); `queryRunner.manager.create.mockReturnValue({} as Transaction)` triggered `@typescript-eslint/no-unnecessary-type-assertion` on an untyped `jest.fn()`.
- **Fix:** Extracted local `jest.fn()` references (`findOneMock`, `saveMock`) instead of accessing `mockManager.findOne` directly in assertions, mirroring the existing `.mock.calls[0]` equality-check convention already used elsewhere in `accounts.service.spec.ts`; removed the unnecessary casts in `transactions.service.spec.ts`.
- **Files modified:** `src/accounts/accounts.service.spec.ts`, `src/transactions/transactions.service.spec.ts`
- **Verification:** `npx eslint` clean (0 errors) on both files; tests still pass.
- **Committed in:** `401614f` (Task 1 commit)

**3. [Rule 1 - Bug] Prettier formatting in `test/transactions.e2e-spec.ts`**
- **Found during:** Task 2 (post-write lint pass)
- **Issue:** Several multi-line `as EnvelopeBody<...>` expressions didn't match Prettier's preferred wrapping.
- **Fix:** Ran `npx eslint --fix` to auto-apply Prettier formatting.
- **Files modified:** `test/transactions.e2e-spec.ts`
- **Verification:** `npx eslint` clean; full e2e suite re-run and still green (12/12).
- **Committed in:** `bd31b00` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 bugs found via actual tool failures — migration run, lint pass; 1 formatting)
**Impact on plan:** All three were necessary for correctness (migration would not run at all without #1) or code quality consistency with the existing codebase (#2, #3). No scope creep — no files touched outside this plan's declared `files_modified` list.

## Issues Encountered
- The git worktree had no `node_modules` (gitignored, not copied on worktree creation) and no `.env`/running local Postgres of its own. Resolved by symlinking `node_modules` from the main checkout (read-only reuse, no risk to the main checkout) and spinning up a fully separate, isolated `docker-compose` project (`wt-a514175486`, port 5434, worktree-local credentials I generated myself — never read or reused the main checkout's `.env` secret) so migrations and e2e tests could run without touching the shared dev database. Torn down (`docker compose down -v`) after verification completed, since the orchestrator will delete this worktree.

## User Setup Required

None - no external service configuration required. (The worktree-local Postgres instance used for verification was already torn down; it was never part of the committed changes.)

## Next Phase Readiness
- `AccountsService.adjustBalance` is now real and battle-tested under concurrency — 04-03's `TransfersService` can call it twice inside one `QueryRunner` transaction with no further changes to its signature or locking behavior.
- `Transaction` entity/migration already carries `fromAccountId`/`toAccountId` columns (unused by this plan, D-01) — 04-03 needs no schema migration of its own for the transfer shape.
- `TransactionsService`/`TransactionsController` cover only `POST /transactions` (TXN-01) — list/view/update/delete (TXN-02) is 04-02-PLAN.md's scope, already sequenced next in this phase's wave plan.
- No blockers identified for 04-02 or 04-03.

---
*Phase: 04-transactions-transfers*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 11 created files verified present on disk; both task commits (`401614f`, `bd31b00`) verified present in git history.
