---
phase: 04-transactions-transfers
fixed_at: 2026-09-14T13:38:55Z
review_path: .planning/phases/04-transactions-transfers/04-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 04: Transactions & Transfers Code Review Fix Report

**Fixed at:** 2026-09-14T13:38:55Z
**Source review:** .planning/phases/04-transactions-transfers/04-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (fix_scope: critical_warning — 1 Critical + 3 Warning; the 3 Info findings were out of scope and not attempted)
- Fixed: 4
- Skipped: 0

**Verification environment:** All fixes were made and verified inside an isolated git worktree (`.claude/worktrees/rf-04-*`, attached to a temp branch `gsd-reviewfix/04-*`, fast-forwarded into `master` on cleanup). `tsc --noEmit` and the affected Jest spec files were run directly from that worktree, resolving `node_modules` via Node's directory-walk-up to the main checkout (no separate install was performed). Results are reproducible from `master` after this run's cleanup tail completes, since the worktree's commits are fast-forwarded onto the branch you are reading this from.

## Fixed Issues

### CR-01: `TransactionsService.update()` can resurrect a concurrently soft-deleted transaction, decoupling the row from its already-reversed balance effect

**Files modified:** `src/transactions/transactions.service.ts`
**Commit:** e018b1a
**Applied fix:** Replaced the load-full-entity-then-`save()` pattern with a scoped partial `transactionsRepository.update({ id, userId, deletedAt: IsNull(), type: In([INCOME, EXPENSE]) }, dto)`. This never touches `deletedAt`, so it cannot resurrect a row a concurrent `DELETE` already soft-deleted; if the row was concurrently deleted between the ownership check and the write, `result.affected === 0` and the method throws `NotFoundException` instead of corrupting state. Verified with `tsc --noEmit` (no new errors vs. pre-fix baseline) and Tier 1 re-read; no existing unit test exercised `update()` so none needed adaptation.

### WR-01: Transfer self-reference guard and ascending-id lock order use case-sensitive string comparison of UUIDs

**Files modified:** `src/transfers/transfers.service.ts`
**Commit:** a96d57e
**Applied fix:** Normalized `dto.fromAccountId`/`dto.toAccountId` to lowercase at the top of `TransfersService.create()`, before the self-transfer `===` guard, the ownership `findOne()` calls, the ascending-id sort/lock order, and the persisted `fromAccountId`/`toAccountId` values. `remove()` was left unchanged — the values it sorts/compares come back from a DB round-trip, and Postgres's `uuid` column always renders its canonical text form in lowercase, so those values are already normalized. Verified with `tsc --noEmit` (no new errors) and by running `transfers.service.spec.ts` (all passing, no test relied on the un-normalized values).

### WR-02: `AccountsService.update()`/`remove()` share the same unlocked read-then-full-save pattern as CR-01

**Files modified:** `src/accounts/accounts.service.ts`, `src/accounts/accounts.service.spec.ts`
**Commit:** c73fcee
**Applied fix:** Same pattern as CR-01, applied to both `AccountsService.update()` and `remove()`: replaced the load-then-full-`save()` calls with scoped partial `accountsRepository.update({ id, userId, deletedAt: IsNull() }, ...)` calls, each checking `result.affected === 0` and throwing `NotFoundException` on a concurrent-delete race instead of silently resurrecting the account. The pre-existing `remove()` unit test asserted the old `.save()`-based implementation directly (`accountsRepository.save.mock.calls[0]` equal to the mutated entity), so it would have failed against the new behavior — this test was rewritten to assert the new `update()` call shape and result handling, and a new `update()` describe block (previously untested) plus two concurrent-delete-race tests were added for both methods. Verified with `tsc --noEmit` (no new errors) and `jest src/accounts/accounts.service.spec.ts` (9/9 passing).

### WR-03: No upper-bound check on cumulative account balance vs. `numeric(12,2)` capacity

**Files modified:** `src/accounts/accounts.service.ts`, `src/common/decimal.util.ts`
**Commit:** defdbf1
**Applied fix:** Added an exported `isWithinDecimalRange(value, maxAbsolute)` helper to `decimal.util.ts` (exact BigInt-cents comparison, no float drift, consistent with the file's existing exact-arithmetic approach). `AccountsService.adjustBalance()` now computes the new balance first, checks it against the `numeric(12,2)` column's representable range (`+/-9999999999.99`, matching `1789300000000-CreateAccounts.ts`), and throws a `BadRequestException` before calling `save()` if it would overflow — turning an unhandled Postgres `numeric field overflow` (potential raw-error leak, unhandled 500) into a controlled 400. Verified with `tsc --noEmit` (no new errors) and `jest` across `accounts.service.spec.ts`, `decimal.util.spec.ts`, `transactions.service.spec.ts`, `transfers.service.spec.ts` (32/32 passing).

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-09-14T13:38:55Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
