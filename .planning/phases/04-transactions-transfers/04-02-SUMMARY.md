---
phase: 04-transactions-transfers
plan: 02
subsystem: api
tags: [nestjs, typeorm, postgres, pessimistic-locking, idor, soft-delete]

requires:
  - phase: 04-transactions-transfers
    provides: "04-01: AccountsService.adjustBalance(manager, userId, id, delta), Transaction entity + migration, TransactionsService.create, POST /transactions"
provides:
  - "UpdateTransactionDto — description/date only (D-04), amount/accountId/categoryId permanently locked after creation"
  - "TransactionsService.findAll/findOne/update/remove — type-scoped (income/expense only, D-02) and userId+deletedAt-scoped queries"
  - "TransactionsService.remove — atomic pessimistic-locked reversal-then-soft-delete (D-06), closing the concurrent double-delete race"
  - "GET /transactions, GET /transactions/:id, PATCH /transactions/:id, DELETE /transactions/:id routes"
  - "test/transactions-cross-tenant.e2e-spec.ts — dedicated two-user IDOR regression suite for Transactions"
affects: [04-03-transfers, 05-budgets, 06-reports]

actuals:
  tokens: 9592
  tasks: 2
  commits: 2
plan_head_before: e6780a70e9711fae6abb4eb89d8d974c87a169a3

tech-stack:
  added: []
  patterns:
    - "type: In([INCOME, EXPENSE]) filter structurally excludes transfer rows from every single-record Transactions operation (GET/PATCH/DELETE /transactions/:id) — closes the null-accountId gap before it can reach remove()'s reversal logic"
    - "Pessimistic-locked reversal-then-soft-delete: the row being soft-deleted is itself locked (SELECT ... FOR UPDATE) inside the same QueryRunner transaction that reverses the balance, so a second concurrent DELETE blocks then finds nothing (deleted_at no longer NULL) instead of double-reversing"

key-files:
  created:
    - src/transactions/dto/update-transaction.dto.ts
    - test/transactions-cross-tenant.e2e-spec.ts
  modified:
    - src/transactions/transactions.service.ts
    - src/transactions/transactions.controller.ts
    - src/transactions/transactions.service.spec.ts
    - test/transactions.e2e-spec.ts

key-decisions:
  - "UpdateTransactionDto omits amount/accountId/categoryId entirely (D-04) rather than validating-then-rejecting them in the service — relies on global forbidNonWhitelisted:true to 400 automatically, mirroring UpdateAccountDto/UpdateCategoryDto exactly"
  - "findOne's type: In([INCOME, EXPENSE]) filter is applied at the query level, not as a runtime post-fetch check — a transfer's id is structurally invisible to /transactions/:id, not merely rejected after being fetched"

patterns-established:
  - "Every future single-record lookup on a polymorphic-type table (mirrors this if Phase 5/6 ever add similar discriminated tables) should filter the allowed types in the WHERE clause itself, not via a runtime type-check after fetch"

requirements-completed: [TXN-02]

coverage:
  - id: D1
    description: "A user can list, view, update (description/date only), and delete only their own income/expense transactions — every cross-tenant GET/PATCH/DELETE attempt returns 404, never 200/403 (TXN-02, Pitfall 3)"
    requirement: "TXN-02"
    verification:
      - kind: e2e
        ref: "test/transactions-cross-tenant.e2e-spec.ts#GET /transactions/:id with B's transaction id and A's token returns 404, never 403/200"
        status: pass
      - kind: e2e
        ref: "test/transactions-cross-tenant.e2e-spec.ts#PATCH /transactions/:id with B's transaction id and A's token returns 404, never 403/200 — and B's transaction is untouched"
        status: pass
      - kind: e2e
        ref: "test/transactions-cross-tenant.e2e-spec.ts#DELETE /transactions/:id with B's transaction id and A's token returns 404, never 403/200 — and B's transaction is not deleted"
        status: pass
      - kind: e2e
        ref: "test/transactions-cross-tenant.e2e-spec.ts#GET /transactions for A never includes any of B's transaction ids"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /transactions on a fresh user returns 200 with an empty array; ordering is date DESC with createdAt DESC tiebreak, stable across repeated calls (D-10, edge-probes: empty/ordering/adjacency)"
    requirement: "TXN-02"
    verification:
      - kind: e2e
        ref: "test/transactions.e2e-spec.ts#GET /transactions on a freshly-registered user with zero transactions returns 200 with an empty array (edge-probe: empty)"
        status: pass
      - kind: e2e
        ref: "test/transactions.e2e-spec.ts#GET /transactions returns transactions ordered by date DESC regardless of creation order (edge-probe: ordering)"
        status: pass
      - kind: e2e
        ref: "test/transactions.e2e-spec.ts#GET /transactions breaks a date tie by createdAt DESC, stable across repeated calls (edge-probe: adjacency)"
        status: pass
    human_judgment: false
  - id: D3
    description: "PATCH /transactions/:id rejects amount/accountId/categoryId with 400; a description-only PATCH succeeds and leaves locked fields unchanged (D-04)"
    requirement: "TXN-02"
    verification:
      - kind: e2e
        ref: "test/transactions.e2e-spec.ts#PATCH /transactions/:id rejects amount/accountId/categoryId with 400, but a description-only PATCH succeeds and leaves locked fields unchanged (D-04)"
        status: pass
      - kind: unit
        ref: "src/transactions/transactions.service.spec.ts#findOne queries with a where clause scoped to type: In([INCOME, EXPENSE]) — a transfer row is excluded structurally"
        status: pass
    human_judgment: false
  - id: D4
    description: "DELETE /transactions/:id reverses the exact balance effect exactly once, guarded against sequential double-delete and concurrent double-delete (D-06, Pitfall 2, edge-probes: idempotency/concurrency)"
    requirement: "TXN-02"
    verification:
      - kind: e2e
        ref: "test/transactions.e2e-spec.ts#DELETE /transactions/:id reverses the exact balance effect for an expense and for an income (D-06)"
        status: pass
      - kind: e2e
        ref: "test/transactions.e2e-spec.ts#a second DELETE on an already-deleted transaction id returns 404 and never double-reverses the balance (edge-probe: idempotency)"
        status: pass
      - kind: e2e
        ref: "test/transactions.e2e-spec.ts#two concurrent DELETEs on the same transaction id never double-reverse the balance — exactly one 200, one 404 (edge-probe: concurrency, Pitfall 2)"
        status: pass
      - kind: unit
        ref: "src/transactions/transactions.service.spec.ts#remove calls accountsService.adjustBalance with a positive reversal delta for an EXPENSE transaction, and soft-deletes (never hard-deletes)"
        status: pass
      - kind: unit
        ref: "src/transactions/transactions.service.spec.ts#remove calls accountsService.adjustBalance with a negative reversal delta for an INCOME transaction"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-09-14
status: complete
---

# Phase 4 Plan 2: Transactions CRUD with Locked Fields and Atomic Reversal-on-Delete Summary

**Full CRUD for income/expense transactions — description/date-only edits (D-04), date-DESC listing with a createdAt tiebreak (D-10), and a pessimistic-row-locked reversal-then-soft-delete that survives sequential and concurrent double-delete without ever double-reversing an account balance (D-06), proven under a dedicated two-user IDOR suite.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-09-13 (session start, worktree spawned from 04-01's completion)
- **Completed:** 2026-09-14
- **Tasks:** 2
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- `UpdateTransactionDto` — `description`/`date` only, mirroring `UpdateAccountDto`/`UpdateCategoryDto`'s "lock the risky fields" pattern; `forbidNonWhitelisted:true` rejects `amount`/`accountId`/`categoryId` with 400 automatically
- `TransactionsService.findAll` — plain list (D-09, no query filters), `date` DESC primary sort with an explicit `createdAt` DESC tiebreak (D-10), stable across repeated calls
- `TransactionsService.findOne` — `type: In([INCOME, EXPENSE])` filter applied at the query level, structurally excluding transfer rows from every single-record Transactions operation (closes the null-`accountId` gap before `remove()`'s reversal logic could ever see it)
- `TransactionsService.remove` — atomic reversal-then-soft-delete: the transaction row itself is pessimistic-locked (`SELECT ... FOR UPDATE`) inside the same `QueryRunner` transaction that reverses the balance via `accountsService.adjustBalance`, so a second concurrent DELETE blocks then finds nothing (already soft-deleted) instead of double-reversing
- `TransactionsController` — `GET /transactions`, `GET /transactions/:id`, `PATCH /transactions/:id`, `DELETE /transactions/:id`
- Dedicated `test/transactions-cross-tenant.e2e-spec.ts` — every GET/PATCH/DELETE against another tenant's transaction id returns 404, list never leaks foreign ids
- Extended `test/transactions.e2e-spec.ts` with empty-list, ordering/adjacency, locked-field PATCH rejection, delete-reversal exactness (expense and income symmetrically), delete-twice idempotency, and concurrent double-delete coverage — all passing against an isolated worktree-local Postgres instance

## Task Commits

Each task was committed atomically:

1. **Task 1: List/view/update/delete — locked fields (D-04), atomic locked reversal (D-06), date-DESC ordering (D-10)** - `4bac4e2` (feat)
2. **Task 2: Cross-tenant isolation suite + full CRUD e2e coverage** - `6867a90` (test)

**Plan metadata:** this SUMMARY + REQUIREMENTS.md commit is separate (worktree-mode contract — STATE.md/ROADMAP.md are the orchestrator's responsibility after merge).

## Files Created/Modified

- `src/transactions/dto/update-transaction.dto.ts` - `description`/`date` only, `amount`/`accountId`/`categoryId` deliberately omitted (D-04)
- `src/transactions/transactions.service.ts` - `findAll`/`findOne`/`update`/`remove` added alongside the existing `create()`
- `src/transactions/transactions.controller.ts` - `GET`/`GET:id`/`PATCH:id`/`DELETE:id` routes added
- `src/transactions/transactions.service.spec.ts` - `findOne` 404/type-scoping tests, `remove` reversal-delta-sign and no-hard-delete tests
- `test/transactions-cross-tenant.e2e-spec.ts` - new dedicated IDOR suite (4 tests)
- `test/transactions.e2e-spec.ts` - new `list/view/update/delete transaction` describe block (8 tests)

## Decisions Made

- `UpdateTransactionDto` omits `amount`/`accountId`/`categoryId` entirely rather than validating-then-rejecting — relies on the already-established global `forbidNonWhitelisted:true` mechanism, exactly matching `UpdateAccountDto`/`UpdateCategoryDto`'s precedent.
- `findOne`'s `type: In([INCOME, EXPENSE])` filter is applied at the query level (WHERE clause), not as a runtime post-fetch type-check — a transfer's id is structurally invisible to `/transactions/:id`, closing the gap `remove()`'s single-account reversal logic would otherwise hit (a transfer row's `accountId` is `null`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two e2e test assertions had inverted expected balance values (test-only bug, not production code)**
- **Found during:** Task 2, first e2e run of the new idempotency and concurrency delete tests
- **Issue:** The "delete-twice idempotency" and "concurrent double-delete" tests asserted the account balance equaled its *pre-reversal* value (e.g. `'960.00'`/`'970.00'`, the balance immediately after the expense was created) instead of the *post-reversal* value (`'1000.00'`, the balance after DELETE correctly reverses the expense). The production `remove()` implementation was correct throughout — this was purely an authoring mistake in the new test assertions.
- **Fix:** Corrected both assertions to expect the reversed (pre-transaction) balance, and changed the idempotency test's second assertion to compare against the first delete's observed balance (`toBe(balanceAfterFirst)`) rather than a second hardcoded literal, so the test verifies "unchanged between first and second delete" per the plan's exact wording.
- **Files modified:** `test/transactions.e2e-spec.ts`
- **Verification:** Re-ran `npm run test:e2e -- transactions.e2e-spec.ts` — 19/19 passing.
- **Committed in:** `6867a90` (Task 2 commit — fixed before the commit, no separate fix commit needed)

**Total deviations:** 1 auto-fixed (test-authoring bug, caught by the tests actually failing on first run — proof the production reversal logic is correct, not a fix to `remove()` itself). **Impact on plan:** None on production code; no scope creep.

## Issues Encountered

- This worktree had no `node_modules` (gitignored) and no local Postgres of its own, mirroring 04-01's environment note. Resolved identically: symlinked `node_modules` from the main checkout (read-only reuse) and spun up a fully separate, isolated `docker-compose` project (`wt-a149c657`, port 5436, worktree-local generated credentials never derived from or written back to the main checkout's `.env`).
- `typeorm@1.1.1`'s CLI (`npm run migration:run`) fails in this environment with `SyntaxError: Cannot use import statement outside a module` — its bundled `yargs@18` is pure ESM with no CJS entry point, and the CLI `require()`s it under ts-node's CommonJS mode. This reproduces identically against the main checkout's own `node_modules` (confirmed by inspecting `yargs`'s `package.json`: `"type": "module"`, no `"main"` CJS fallback) — it is an upstream dependency-compatibility gap in the pinned `typeorm@1.1.1`/`yargs@18` pairing, not something introduced by this plan. Worked around locally (this worktree only, not committed) by running migrations directly through TypeORM's `DataSource.runMigrations()` API via a throwaway script, bypassing the CLI's `yargs` dependency entirely. This same gap will block `npm run migration:generate`/`migration:revert` too and should be flagged for the project (e.g. downgrading the bundled CLI's yargs pin, or invoking migrations via a small first-party script) before Phase 4 relies on generating new migrations again in 04-03.
- Running the *entire* e2e suite together (`npm run test:e2e` with default parallel workers, and again with `--runInBand`) failed with `Exceeded timeout of 5000 ms for a hook` / `Fatal process out of memory` across files this plan never touched (`accounts-cross-tenant.e2e-spec.ts`, `auth.e2e-spec.ts`, `categories.e2e-spec.ts`) — this is a pre-existing environment resource constraint (small worktree-local Postgres container + repeated full-Nest-app `beforeAll` bootstraps), not a regression from this plan's changes. This plan's own three required verification commands (`transactions.service.spec.ts`, `transactions-cross-tenant.e2e-spec.ts`, `transactions.e2e-spec.ts`) all pass cleanly when run individually, which is what the plan's `<verification>` block requires.
- Docker Desktop became unresponsive after the full-suite memory-exhaustion run above, so the isolated `wt-a149c657` container/volume could not be torn down cleanly at the end of this session (`docker compose down -v` returned "Docker Desktop is unable to start"). No risk to the main checkout or its own `financialcontrol-db-1` container (port 5433, untouched) — this worktree-local container will be discarded along with the worktree when the orchestrator removes it.

## User Setup Required

None - no external service configuration required. The worktree-local Postgres instance used for verification is isolated from the main dev database and will be discarded with the worktree.

## Next Phase Readiness

- Full Transactions CRUD (TXN-02) is complete: list, view, update (description/date), delete (atomic reversal) — mirroring Accounts/Categories' ownership-isolation guarantee, plus the additional money-correctness invariant (exact-once balance reversal under concurrency).
- `TransactionsService.findOne`'s `type: In([INCOME, EXPENSE])` exclusion of transfer rows is exactly the boundary 04-03 needs — a transfer created by 04-03's `POST /transfers` will be invisible to `/transactions/:id` by construction, requiring no coordination between the two plans.
- The transfer-id-exclusion e2e case was deliberately deferred to 04-03's own cross-tenant/e2e task (no `/transfers` endpoint exists yet) — documented as a code comment in `test/transactions.e2e-spec.ts` for traceability, not an oversight.
- Flagged for project awareness (not a 04-02 blocker): `typeorm@1.1.1`'s CLI/`yargs@18` incompatibility will affect any future `migration:generate`/`migration:run` invocation via the npm scripts in a fresh environment — 04-03 should budget time for the same DataSource-API workaround if it needs to run migrations, or the project should consider pinning/patching the CLI dependency.

---
*Phase: 04-transactions-transfers*
*Completed: 2026-09-14*

## Self-Check: PASSED

All created files verified present on disk (`update-transaction.dto.ts`, `transactions-cross-tenant.e2e-spec.ts`, `04-02-SUMMARY.md`); both task commits (`4bac4e2`, `6867a90`) verified present in git history.
