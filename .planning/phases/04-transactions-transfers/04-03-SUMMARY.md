---
phase: 04-transactions-transfers
plan: 03
subsystem: api
tags: [nestjs, typeorm, postgres, pessimistic-locking, decimal-arithmetic, idor, transfers]

# Dependency graph
requires:
  - phase: 04-transactions-transfers
    provides: "04-01: AccountsService.adjustBalance(manager, userId, id, delta), Transaction entity + migration (fromAccountId/toAccountId columns already present, unused until now)"
  - phase: 04-transactions-transfers
    provides: "04-02: TransactionsService.findOne's type: In([INCOME, EXPENSE]) exclusion precedent — this plan mirrors it symmetrically for TransfersService (type: TRANSFER)"
provides:
  - "CreateTransferDto/TransferResponseDto — dedicated transfer DTOs (D-02), no type field"
  - "TransfersService.create/remove — two-account ascending-id-ordered pessimistic locking via AccountsService.adjustBalance, single Transaction row per transfer (D-01)"
  - "POST /transfers, DELETE /transfers/:id routes — no PATCH (D-05, structural absence)"
  - "TransfersModule registered in AppModule, imports AccountsModule only (no CategoriesModule, no TransactionsModule — D-01)"
  - "test/transfers.e2e-spec.ts, test/transfers-cross-tenant.e2e-spec.ts — atomicity, concurrency, IDOR, and TXN-04 category-exclusion proof"
affects: [04-04, 05-budgets, 06-reports]

# Actuals (#2632)
actuals:
  tokens: 11483
  tasks: 2
  commits: 2
plan_head_before: 3aa6c5e99a3634a33114cdc19d02351d6a849036

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Direction-independent lock ordering: [fromAccountId, toAccountId].sort() computed once, then adjustBalance called twice in that fixed ascending-id order regardless of which account is debited/credited — the single mechanism preventing opposite-direction concurrent transfers from deadlocking (Pitfall 2)"
    - "Transfer row locked via type: TransactionType.TRANSFER in the WHERE clause on delete — symmetric to 04-02's type: In([INCOME, EXPENSE]) exclusion on TransactionsService.findOne, so a transaction id 404s through /transfers/:id and a transfer id 404s through /transactions/:id"
    - "TransfersModule registers its own TypeOrmModule.forFeature([Transaction]) against the same table TransactionsModule uses — independent repository injection, no service-level coupling between the two modules"

key-files:
  created:
    - src/transfers/dto/create-transfer.dto.ts
    - src/transfers/dto/transfer-response.dto.ts
    - src/transfers/transfers.service.ts
    - src/transfers/transfers.controller.ts
    - src/transfers/transfers.module.ts
    - src/transfers/transfers.service.spec.ts
    - test/transfers.e2e-spec.ts
    - test/transfers-cross-tenant.e2e-spec.ts
  modified:
    - src/app.module.ts

key-decisions:
  - "TransfersService.create validates the self-transfer guard (fromAccountId === toAccountId) BEFORE any DB round-trip — cheap fail-fast, no ownership lookups or QueryRunner opened for an obviously-invalid request"
  - "Both accounts' ownership chain (accountsService.findOne) is validated OUTSIDE the QueryRunner transaction, mirroring 04-01/04-02's TransactionsService pattern exactly — a cross-tenant 404 never opens/rolls back a transaction"
  - "remove()'s reversal computes the exact inverse of create()'s deltas using the identical [fromAccountId, toAccountId].sort() ordering, so create and remove always lock the same two accounts in the same sequence for a given transfer, regardless of transfer direction"

patterns-established:
  - "A transfer's DELETE reversal must always re-derive the ascending-id lock order from the persisted fromAccountId/toAccountId (not re-accept client input) — any future money-moving-pair feature (e.g. a hypothetical recurring transfer) should follow this same create/remove symmetry"

requirements-completed: [TXN-03, TXN-04]

coverage:
  - id: D1
    description: "POST /transfers moves money between two of the caller's own accounts atomically via a dedicated endpoint — both balances update in the same request, persisted as a single Transaction row with type=transfer and no categoryId (TXN-03, D-01/D-02)"
    requirement: "TXN-03"
    verification:
      - kind: e2e
        ref: "test/transfers.e2e-spec.ts#POST /transfers moves money between two of the caller own accounts atomically, both balances updating in the same request"
        status: pass
    human_judgment: false
  - id: D2
    description: "Self-transfer, zero/negative/overflowing amounts, and cross-tenant fromAccountId/toAccountId are all rejected before any mutation (TXN-03 boundary + Pitfall 3 IDOR)"
    requirement: "TXN-03"
    verification:
      - kind: e2e
        ref: "test/transfers.e2e-spec.ts#rejects fromAccountId === toAccountId with 400 (self-transfer)"
        status: pass
      - kind: e2e
        ref: "test/transfers.e2e-spec.ts#rejects amount \"0.00\" with 400 (edge-probe: boundary)"
        status: pass
      - kind: e2e
        ref: "test/transfers.e2e-spec.ts#rejects a negative amount with 400 (structurally, per the regex; edge-probe: boundary)"
        status: pass
      - kind: e2e
        ref: "test/transfers.e2e-spec.ts#rejects an amount whose integer part overflows numeric(12,2) with 400 (edge-probe: boundary)"
        status: pass
      - kind: e2e
        ref: "test/transfers.e2e-spec.ts#rejects a toAccountId belonging to another user with 404 (Pitfall 3, IDOR)"
        status: pass
      - kind: e2e
        ref: "test/transfers.e2e-spec.ts#rejects a fromAccountId belonging to another user with 404 (Pitfall 3, IDOR — symmetric)"
        status: pass
      - kind: e2e
        ref: "test/transfers-cross-tenant.e2e-spec.ts#POST /transfers as A with toAccountId set to one of B's accounts returns 404"
        status: pass
      - kind: e2e
        ref: "test/transfers-cross-tenant.e2e-spec.ts#POST /transfers as A with fromAccountId set to one of B's accounts returns 404 (symmetric)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Two concurrent opposite-direction transfers between the same account pair never deadlock and never lose an update — both accounts locked in a fixed ascending-id order regardless of direction (Pitfall 2, TXN-03)"
    requirement: "TXN-03"
    verification:
      - kind: unit
        ref: "src/transfers/transfers.service.spec.ts#locks the SAME two accounts in the SAME ascending-id order even when fromAccountId > toAccountId (direction-independent locking, Pitfall 2)"
        status: pass
      - kind: e2e
        ref: "test/transfers.e2e-spec.ts#two concurrent opposite-direction transfers between the same account pair never deadlock and never lose an update (Pitfall 2, edge-probe: concurrency)"
        status: pass
    human_judgment: false
  - id: D4
    description: "There is no PATCH /transfers/:id route — a client must DELETE and recreate to change a transfer (D-05)"
    requirement: "TXN-03"
    verification:
      - kind: e2e
        ref: "test/transfers.e2e-spec.ts#PATCH /transfers/:id returns 404 (D-05 — no PATCH route exists on this controller)"
        status: pass
    human_judgment: false
  - id: D5
    description: "DELETE /transfers/:id reverses both account balances by the exact inverse of the original transfer, inside the same DB transaction as the soft-delete, guarded against sequential and concurrent double-delete (D-06, TXN-03)"
    requirement: "TXN-03"
    verification:
      - kind: unit
        ref: "src/transfers/transfers.service.spec.ts#locks the transfer row with type: TransactionType.TRANSFER in its where clause, and reverses both accounts in the SAME ascending-id order as create() (from < to)"
        status: pass
      - kind: e2e
        ref: "test/transfers.e2e-spec.ts#DELETE /transfers/:id reverses both account balances to their exact pre-transfer values (D-06)"
        status: pass
      - kind: e2e
        ref: "test/transfers.e2e-spec.ts#a second DELETE on an already-deleted transfer id returns 404, and neither balance changes between attempts (edge-probe: idempotency)"
        status: pass
      - kind: e2e
        ref: "test/transfers.e2e-spec.ts#two concurrent DELETEs on the same transfer id never double-reverse — exactly one 200, one 404, reversal happens EXACTLY ONCE (edge-probe: concurrency)"
        status: pass
      - kind: e2e
        ref: "test/transfers-cross-tenant.e2e-spec.ts#DELETE /transfers/:id as A using a transfer id B created between B's own two accounts returns 404, and B's transfer is still active"
        status: pass
    human_judgment: false
  - id: D6
    description: "A created transfer has categoryId = null on its underlying Transaction row, structurally excluding it from any category-scoped spend-total query (TXN-04, D-03)"
    requirement: "TXN-04"
    verification:
      - kind: e2e
        ref: "test/transfers.e2e-spec.ts#a transfer's categoryId is always null — structurally excluded from any category-scoped spend total (TXN-04, D-03)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Two identical POST /transfers calls create two distinct transfer rows, each independently moving funds — not idempotent by design (mirrors TXN-01's resolution)"
    verification:
      - kind: e2e
        ref: "test/transfers.e2e-spec.ts#two identical POSTs create two distinct transfer rows — not idempotent by design (edge-probe: idempotency)"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-09-14
status: complete
---

# Phase 4 Plan 3: Transfers Vertical Slice — Atomic Two-Account Locking Summary

**POST /transfers and DELETE /transfers/:id, both locking two accounts in a fixed ascending-id order via the same `AccountsService.adjustBalance()` foundation 04-01 proved for the single-account case — verified deadlock-free under genuinely concurrent opposite-direction load, and proven to structurally exclude every transfer from category-spend totals (TXN-04).**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-09-14 (session start)
- **Completed:** 2026-09-14T12:49:14Z
- **Tasks:** 2
- **Files modified:** 9 (8 created, 1 modified)

## Accomplishments

- `CreateTransferDto`/`TransferResponseDto` — dedicated transfer DTOs (D-02), no `type` field, identical decimal-amount boundary regex as `CreateTransactionDto` (self-enforced, not inherited)
- `TransfersService.create` — self-transfer fail-fast guard, ownership-chain validation on both `fromAccountId`/`toAccountId` legs (Pitfall 3), ascending-account-id lock ordering via two `AccountsService.adjustBalance` calls inside one `QueryRunner` transaction (Pitfall 2), single `Transaction` row with `type=TRANSFER` and `accountId`/`categoryId` both `null` (D-01)
- `TransfersService.remove` — pessimistic-locked transfer row (`type: TRANSFER` in the WHERE clause, symmetric to 04-02's `type: In([INCOME, EXPENSE])` exclusion), exact-inverse reversal of both accounts in the same ascending-id order as `create()`, soft-delete only (D-06)
- `TransfersController` — `POST /transfers`, `DELETE /transfers/:id`; no `PATCH` route exists at all (D-05, proven by a 404 test, not a stub)
- `TransfersModule` registered in `AppModule` — imports `AccountsModule` only, registers its own `Repository<Transaction>` against the same table `TransactionsModule` uses, no service-level coupling between the two modules
- Adversarial coverage: direction-independent lock ordering (both create and delete), self-transfer/boundary/overflow rejection, cross-tenant IDOR on both account legs and on delete, idempotency-by-duplication, structural PATCH absence, delete-twice and concurrent-double-delete guards, concurrent opposite-direction transfer deadlock-avoidance proof, and the TXN-04 category-exclusion proof via `GET /transactions`

## Task Commits

Each task was committed atomically:

1. **Task 1: POST /transfers — two-account atomic locking, ownership chain, boundary validation** - `a13ce13` (feat)
2. **Task 2: DELETE /transfers/:id — atomic locked reversal, cross-tenant isolation, TXN-04 proof, deadlock-avoidance concurrency test** - `4264679` (test)

**Plan metadata:** commit pending (this SUMMARY + STATE/ROADMAP update, sequential single-repo mode — no worktree in this session).

## Files Created/Modified

- `src/transfers/dto/create-transfer.dto.ts` - `fromAccountId`/`toAccountId`/`amount`/`date`/`description`, no `type` field
- `src/transfers/dto/transfer-response.dto.ts` - explicit-construction response DTO, never spreads the entity
- `src/transfers/transfers.service.ts` - `create()`/`remove()`: self-transfer guard, ownership chain, ascending-id locking, exact-inverse reversal
- `src/transfers/transfers.controller.ts` - `POST /transfers`, `DELETE /transfers/:id` (no `PATCH`)
- `src/transfers/transfers.module.ts` - imports `AccountsModule` only, own `TypeOrmModule.forFeature([Transaction])`
- `src/transfers/transfers.service.spec.ts` - mocked-repository unit tests (lock ordering both directions, self-transfer fail-fast, reversal deltas, rollback-on-error)
- `test/transfers.e2e-spec.ts` - full create/delete adversarial suite (14 tests) against the real migrated database
- `test/transfers-cross-tenant.e2e-spec.ts` - dedicated two-user IDOR suite for transfer create (both legs) and delete (3 tests)
- `src/app.module.ts` - `TransfersModule` added to imports

## Decisions Made

- The self-transfer guard runs before any DB round-trip (no `findOne`, no `QueryRunner`) — cheap fail-fast for an obviously-invalid request, verified by a unit test asserting neither is called.
- Ownership-chain validation for both accounts happens outside the `QueryRunner` transaction, exactly mirroring `TransactionsService.create`'s established pattern from 04-01/04-02 — a cross-tenant 404 never opens/rolls back a DB transaction.
- `remove()` re-derives the ascending-id lock order from the persisted `fromAccountId`/`toAccountId` on the locked row (not from client input), guaranteeing `create()` and `remove()` for the same transfer always lock the identical two accounts in the identical sequence.

## Deviations from Plan

None - plan executed exactly as written. All tasks completed with the exact file set the plan's `files_modified` frontmatter declared (plus `test/transfers-cross-tenant.e2e-spec.ts`, which the plan's own Task 2 action text specified creating).

## Issues Encountered

- Docker Desktop was not running at session start (`docker compose ps` failed to reach the daemon). Started Docker Desktop and waited for the daemon, then brought up the existing `financialcontrol-db-1` Postgres container (already provisioned from prior phases, `unless-stopped` restart policy) — no new container/volume created, no credentials generated or touched. This is a local dev-environment condition, not a code issue; no production/deploy concern.
- `npm run migration:run` completed cleanly against the already-migrated schema ("No migrations are pending") — unlike 04-01/04-02's worktree sessions, this sequential (non-worktree) session used the main checkout's own `node_modules`/`.env`/CLI directly and did not hit the `typeorm@1.1.1`/`yargs@18` CLI incompatibility those sessions flagged (that gap is specific to a fresh worktree's isolated environment, not the main checkout).

## User Setup Required

None - no external service configuration required. Docker Desktop must be running locally for `docker compose up -d db` to succeed, which is already documented as a standard local-dev prerequisite (not new to this plan).

## Security Review

Checked against `.claude/skills/security-review/SKILLS.md`'s Aplicação (NestJS) checklist:

✅ Aplicado: DTO validation on every field (`class-validator`, `forbidNonWhitelisted: true` globally); all queries via TypeORM `Repository`/`EntityManager` (never raw/concatenated SQL); no secrets/connection strings in code; every mutating/reading transfer operation validates ownership of both referenced accounts (or the transfer row itself) against the authenticated `userId` before acting, returning 404 not 403/200 on cross-tenant access (IDOR closed on both create legs and delete); global rate limiting already covers `/transfers` (no new public/unauthenticated endpoint introduced); global CORS/error-handling/JWT config untouched and still in effect.
⚠️ Atenção: none new — this plan introduces no new attack surface class beyond what 04-01/04-02 already established and had reviewed (two-account locking is a correctness/availability concern, tracked via the STRIDE register below, not a new security gap).

## STRIDE Threat Register Verification

All six threats from the plan's `<threat_model>` are `mitigate`-disposed and verified:

| Threat ID | Mitigation | Verified by |
|-----------|-----------|-------------|
| T-04-12 (IDOR, both account legs) | `accountsService.findOne(userId, ...)` on both `fromAccountId`/`toAccountId` before mutation | `test/transfers.e2e-spec.ts` + `test/transfers-cross-tenant.e2e-spec.ts` |
| T-04-13 (amount sign injection) | No-sign, no-zero, overflow-aware regex, independent of `CreateTransactionDto` | boundary/negative/overflow e2e tests |
| T-04-14 (create-time race/deadlock) | Fixed ascending-id lock order via `adjustBalance`'s `pessimistic_write` | direction-independent unit tests + concurrent opposite-direction e2e test |
| T-04-15 (delete-time double-reversal) | Transfer row itself pessimistic-locked inside the same transaction as the reversal | delete-twice + concurrent-double-delete e2e tests |
| T-04-16 (response DTO leak) | `TransferResponseDto.fromEntity` explicit-construction, never spreads | all e2e assertions inspect only declared response fields |
| T-04-17 (category-spend bypass) | `categoryId` structurally `null`, DB `CHK_transactions_type_shape` constraint from 04-01 | TXN-04 category-exclusion e2e test |

No new npm/pip/cargo packages were installed by this plan — the Package Legitimacy Gate was not triggered, matching the plan's own note.

## Next Phase Readiness

- TXN-03 and TXN-04 are both closed. Combined with 04-01/04-02 (TXN-01, TXN-02, TXN-05), all of this phase's TXN-01..05 requirements are now shipped (16/16 Spec-less Probe Fallback rows resolved across 04-01+04-02+04-03, per this plan's own resolution log).
- `AccountsService.adjustBalance` has now been exercised under both single-account (04-01/04-02) and two-account-simultaneous (04-03) concurrency, with zero signature changes needed across all three plans — the "single write-path" foundation is fully proven.
- 04-04 (this phase's remaining plan, if any beyond TXN-01..05) or Phase 5 (Budgets) can rely on: every transfer row being structurally invisible to category-spend queries, and `GET /transactions` already surfacing transfers alongside income/expense rows (D-03) for a unified activity feed.
- No blockers identified for 04-04, Phase 5, or Phase 6.

---
*Phase: 04-transactions-transfers*
*Completed: 2026-09-14*

## Self-Check: PASSED

All 8 created files verified present on disk; both task commits (`a13ce13`, `4264679`) verified present in git history; `git rev-list --count 3aa6c5e99a3634a33114cdc19d02351d6a849036..HEAD` = 2, matching `commits: 2` above.
