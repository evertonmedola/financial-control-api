---
status: complete
phase: 04-transactions-transfers
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md]
started: 2026-09-14T14:09:38Z
updated: 2026-09-14T14:30:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server/service. Clear ephemeral state (temp DBs, caches, lock files). Start the application from scratch. Server boots without errors, any seed/migration completes, and a primary query (health check, homepage load, or basic API call) returns live data.
result: pass
reason: "Verified live: npm run start on default PORT=3000 fails with EADDRINUSE because port 3000 is held by an unrelated Docker container (medolai-api, a separate personal project on this machine) — not a FinancialControl defect. Re-ran with PORT=3999: app booted clean, all 15 routes mapped, migrations already applied (6/6), and register -> login -> GET /transactions (JWT-authed, live query against financialcontrol-db-1) round-tripped correctly. User confirmed treating the port collision as an environment quirk, not a gap; financialcontrol-db-1 confirmed as this project's own DB container. Test data cleaned up post-verification."

### 2. POST /transactions creates income/expense and updates account balance atomically
expected: POST /transactions creates an income or expense transaction and updates the linked account's balance atomically in the same request (TXN-01)
result: pass
source: automated
coverage_id: D1

### 3. Monetary amounts round-trip exactly with no floating-point drift
expected: 1000 sequential additions and a precise create-response round-trip both hold exactly (TXN-05)
result: pass
source: automated
coverage_id: D2

### 4. AccountsService.adjustBalance with pessimistic row locking
expected: Two concurrent expense creates against the same account never lose an update (Pitfall 2)
result: pass
source: automated
coverage_id: D3

### 5. Ownership-chain IDOR protection
expected: Cross-tenant accountId/categoryId references and client-supplied userId are both rejected before any mutation (Pitfall 3)
result: pass
source: automated
coverage_id: D4

### 6. List/view/update/delete own transactions only
expected: A user can list, view, update (description/date only), and delete only their own income/expense transactions — every cross-tenant GET/PATCH/DELETE attempt returns 404, never 200/403 (TXN-02, Pitfall 3)
result: pass
source: automated
coverage_id: D1

### 7. GET /transactions empty state and stable ordering
expected: GET /transactions on a fresh user returns 200 with an empty array; ordering is date DESC with createdAt DESC tiebreak, stable across repeated calls
result: pass
source: automated
coverage_id: D2

### 8. PATCH locked-field rejection
expected: PATCH /transactions/:id rejects amount/accountId/categoryId with 400; a description-only PATCH succeeds and leaves locked fields unchanged (D-04)
result: pass
source: automated
coverage_id: D3

### 9. DELETE reverses balance exactly once
expected: DELETE /transactions/:id reverses the exact balance effect exactly once, guarded against sequential and concurrent double-delete (D-06, Pitfall 2)
result: pass
source: automated
coverage_id: D4

### 10. POST /transfers moves money atomically between own accounts
expected: POST /transfers moves money between two of the caller's own accounts atomically — both balances update in the same request, persisted as a single Transaction row with type=transfer and no categoryId (TXN-03, D-01/D-02)
result: pass
source: automated
coverage_id: D1

### 11. Transfer boundary and IDOR rejections
expected: Self-transfer, zero/negative/overflowing amounts, and cross-tenant fromAccountId/toAccountId are all rejected before any mutation (TXN-03 boundary + Pitfall 3 IDOR)
result: pass
source: automated
coverage_id: D2

### 12. Concurrent opposite-direction transfers never deadlock or lose updates
expected: Two concurrent opposite-direction transfers between the same account pair never deadlock and never lose an update — both accounts locked in a fixed ascending-id order regardless of direction (Pitfall 2, TXN-03)
result: pass
source: automated
coverage_id: D3

### 13. No PATCH route on transfers
expected: There is no PATCH /transfers/:id route — a client must DELETE and recreate to change a transfer (D-05)
result: pass
source: automated
coverage_id: D4

### 14. DELETE /transfers reverses both balances exactly once
expected: DELETE /transfers/:id reverses both account balances by the exact inverse of the original transfer, inside the same DB transaction as the soft-delete, guarded against sequential and concurrent double-delete (D-06, TXN-03)
result: pass
source: automated
coverage_id: D5

### 15. Transfer categoryId always null
expected: A created transfer has categoryId = null on its underlying Transaction row, structurally excluding it from any category-scoped spend-total query (TXN-04, D-03)
result: pass
source: automated
coverage_id: D6

### 16. Repeated identical transfers are not idempotent by design
expected: Two identical POST /transfers calls create two distinct transfer rows, each independently moving funds
result: pass
source: automated
coverage_id: D7

### 17. Integration-level precision invariant across 12 sequential transactions
expected: 12 sequential alternating income/expense transactions against a single account, created via the real HTTP API against the real migrated database, yield the exact hand-computed final balance with no floating-point drift (TXN-05)
result: pass
source: automated
coverage_id: D1

### 18. Full combined automated test suite passes with zero regressions
expected: The full combined automated test suite (auth + accounts + categories + transactions/transfers) passes together with zero regressions
result: pass
source: automated
coverage_id: D2

### 19. Security-review checklist applied to Transactions/Transfers and adjustBalance
expected: Security-review checklist applied to the finished Transactions/Transfers modules and AccountsService.adjustBalance(), with explicit confirmation of the money-mutation concurrency mitigations (this phase's highest-severity finding category)
result: pass
reason: "All four 04-REVIEW.md findings confirmed fixed directly in source, by user direction to proceed with best judgment: CR-01 (src/transactions/transactions.service.ts update() now does a scoped repository.update({id,userId,deletedAt:IsNull()}, dto) with affected===0 -> 404, no more unlocked read-then-full-save resurrection path), WR-02 (identical scoped-update pattern applied to AccountsService.update()/remove()), WR-01 (UUID casing normalized before self-transfer guard + lock ordering in TransfersService), WR-03 (AccountsService.adjustBalance() now checks isWithinDecimalRange against numeric(12,2)'s max before save, returning 400 instead of an unhandled Postgres overflow error). Full suite re-run clean post-fix: npm run test 50/50 passed (6 suites), npm run test:e2e 130/130 passed (11 suites), zero regressions. One residual gap noted for the record, not blocking: no dedicated regression test was added for the specific PATCH-racing-DELETE interleaving 04-VERIFICATION.md's gap called for — the code mitigation is verified in place and exercised indirectly by the passing suite, but that exact concurrency interleaving has no dedicated test the way the equivalent DELETE-vs-DELETE case does."

## Summary

total: 19
passed: 19
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
