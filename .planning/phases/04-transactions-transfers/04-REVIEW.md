---
phase: 04-transactions-transfers
reviewed: 2026-09-14T00:00:00Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - src/accounts/accounts.service.spec.ts
  - src/accounts/accounts.service.ts
  - src/app.module.ts
  - src/common/decimal.util.spec.ts
  - src/common/decimal.util.ts
  - src/database/migrations/1789500000000-CreateTransactions.ts
  - src/transactions/dto/create-transaction.dto.ts
  - src/transactions/dto/transaction-response.dto.ts
  - src/transactions/dto/update-transaction.dto.ts
  - src/transactions/entities/transaction.entity.ts
  - src/transactions/transactions.controller.ts
  - src/transactions/transactions.module.ts
  - src/transactions/transactions.service.spec.ts
  - src/transactions/transactions.service.ts
  - src/transfers/dto/create-transfer.dto.ts
  - src/transfers/dto/transfer-response.dto.ts
  - src/transfers/transfers.controller.ts
  - src/transfers/transfers.module.ts
  - src/transfers/transfers.service.spec.ts
  - src/transfers/transfers.service.ts
  - test/transactions.e2e-spec.ts
  - test/transactions-cross-tenant.e2e-spec.ts
  - test/transfers.e2e-spec.ts
  - test/transfers-cross-tenant.e2e-spec.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 04: Transactions & Transfers Code Review Report

**Reviewed:** 2026-09-14T00:00:00Z
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

The transactions/transfers vertical slice is well tested for the concurrency and IDOR scenarios its own authors anticipated (double-DELETE races, opposite-direction transfer locking, cross-tenant 404s, decimal-precision accumulation). However, tracing the `update()` write path against the `remove()` write path across the same table exposes a real data-integrity race: `TransactionsService.update()` (and the pre-existing `AccountsService.update()`/`remove()` pair it mirrors) reads a full entity with no lock and later persists the *entire* loaded object, including its `deletedAt` snapshot — which can silently resurrect a row that a concurrent DELETE already soft-deleted and reversed. A second, narrower finding: the transfer self-reference guard and the ascending-id lock order in `TransfersService` both rely on case-sensitive string comparison of UUIDs, which is not guaranteed to line up with Postgres's case-insensitive `uuid` equality, letting a case-varied duplicate slip past the "fromAccountId !== toAccountId" check. Remaining items are lower-severity robustness/code-quality notes.

## Critical Issues

### CR-01: `TransactionsService.update()` can resurrect a concurrently soft-deleted transaction, decoupling the row from its already-reversed balance effect

**File:** `src/transactions/transactions.service.ts:109-117`

**Issue:**
```ts
async update(
  userId: string,
  id: string,
  dto: UpdateTransactionDto,
): Promise<Transaction> {
  const transaction = await this.findOne(userId, id);
  Object.assign(transaction, dto);
  return this.transactionsRepository.save(transaction);
}
```
`findOne()` issues a plain, unlocked `SELECT ... WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`. `save()` on the returned, fully-hydrated `Transaction` entity later issues an `UPDATE` that writes back every mapped column present on the object — including `deletedAt`, whose in-memory value is whatever was read at `findOne()` time (`null`).

`TransactionsService.remove()` (lines 126-168) is a separate, unlocked-from-`update()`'s-perspective code path: it opens its own `QueryRunner`, pessimistic-locks the row, reverses the account balance, sets `deletedAt`, and commits. Nothing in `update()` participates in that lock or re-checks `deletedAt` before persisting.

Concrete interleaving that corrupts data:
1. Client A calls `PATCH /transactions/:id` with `{ description: "..." }`. `update()`'s `findOne()` reads the row with `deletedAt: null` (correct at that instant — no DB-level lock is taken, so it doesn't block anything).
2. Client B calls `DELETE /transactions/:id` for the *same* id. `remove()` locks the row, reverses the account balance, sets `deleted_at = now()`, commits — this is a fully valid, committed state change.
3. Client A's `update()` call resumes and calls `transactionsRepository.save(transaction)`. The entity object in memory still has `deletedAt: null` from step 1, so the generated `UPDATE` sets `deleted_at = NULL` (along with `description`), silently undoing the soft delete.

Result: the transaction row is now "active" again (visible via `GET /transactions` and `GET /transactions/:id`, matched by `findOne()`'s `deletedAt: IsNull()` filter), but the account balance was already permanently adjusted as if the transaction had been deleted in step 2 and is never re-adjusted. The account balance and the set of "active" transaction rows are now permanently inconsistent — this is exactly the class of bug the rest of this module goes out of its way to prevent (see the pessimistic-lock comments and the dedicated concurrent-DELETE e2e tests), but it is left open on the `update()` path, which has no equivalent test coverage.

**Fix:** Scope the mutation to rows that are still active, using a partial update instead of loading + saving the full entity (or reuse the same locked-`QueryRunner` pattern as `remove()`):
```ts
async update(
  userId: string,
  id: string,
  dto: UpdateTransactionDto,
): Promise<Transaction> {
  await this.findOne(userId, id); // ownership + type-scope + not-deleted check
  const result = await this.transactionsRepository.update(
    { id, userId, deletedAt: IsNull() },
    dto,
  );
  if (result.affected === 0) {
    throw new NotFoundException();
  }
  return this.findOne(userId, id);
}
```
This never touches `deletedAt` and fails the update (rather than corrupting state) if the row was concurrently deleted between the ownership check and the write.

## Warnings

### WR-01: Transfer self-reference guard and ascending-id lock order use case-sensitive string comparison of UUIDs

**File:** `src/transfers/transfers.service.ts:38-42, 57-61`

**Issue:**
```ts
if (dto.fromAccountId === dto.toAccountId) {
  throw new BadRequestException(
    'fromAccountId e toAccountId não podem ser iguais',
  );
}
...
const [firstId, secondId] = [dto.fromAccountId, dto.toAccountId].sort();
```
`@IsUUID()` on `CreateTransferDto` (src/transfers/dto/create-transfer.dto.ts:17-21) accepts mixed-case UUID strings — it validates format, not canonical casing. Postgres's `uuid` column type compares/normalizes values case-insensitively. A client that submits the *same* account id with different casing on `fromAccountId` vs `toAccountId` (e.g. one lowercase, one uppercase) will:
- pass the `===` self-transfer guard (different strings, same underlying account),
- have both `accountsService.findOne()` ownership checks resolve to the *same* row (Postgres uuid equality is case-insensitive),
- produce a persisted "transfer" row with `from_account_id` ≠ `to_account_id` as stored strings-in-memory-before-insert but referring to the identical account, i.e. a self-transfer that the explicit business rule ("fromAccountId e toAccountId não podem ser iguais") was meant to reject.

The two `adjustBalance` deltas net to zero so there is no direct fund loss, but a nonsensical self-transfer row is written to financial history, and this is a genuine bypass of the app's own documented business rule and test (`transfers.service.spec.ts` / `transfers.e2e-spec.ts` "rejects fromAccountId === toAccountId with 400"). It also means the "fixed ascending-id lock order" the code relies on for deadlock avoidance (Pitfall 2) is technically keyed off raw string comparison rather than canonical account identity, so two concurrent transfers referencing the same account pair with inconsistent casing are not guaranteed to lock in the same order.

**Fix:** Normalize both ids before any comparison/use:
```ts
const fromAccountId = dto.fromAccountId.toLowerCase();
const toAccountId = dto.toAccountId.toLowerCase();
if (fromAccountId === toAccountId) {
  throw new BadRequestException(/* ... */);
}
...
const [firstId, secondId] = [fromAccountId, toAccountId].sort();
```
(and apply the same normalization in `remove()`'s sort of `transfer.fromAccountId!`/`transfer.toAccountId!`, or rely on the DB's own lowercase-normalized values, which are already consistent since they round-tripped through Postgres).

### WR-02: `AccountsService.update()`/`remove()` share the same unlocked read-then-full-save pattern as CR-01

**File:** `src/accounts/accounts.service.ts:46-62`

**Issue:** `update()` (lines 46-54) and `remove()` (lines 58-62) both do `findOne()` (unlocked) → mutate in memory → `accountsRepository.save(entity)` (full-entity write). Since `remove()` sets `deletedAt` this way and `update()` writes back whatever `deletedAt` it read, the identical race described in CR-01 applies here: a `PATCH /accounts/:id` racing a `DELETE /accounts/:id` on the same account can resurrect a soft-deleted account (`deleted_at` reset to `NULL`). This is pre-existing code (not new in this phase) but is exercised by the same phase's transactions/transfers code paths (`adjustBalance` assumes `deletedAt IS NULL` is a reliable exclusion filter), so a resurrected account could later participate in `adjustBalance` calls again in a state the rest of the system assumes is impossible.

**Fix:** Same pattern as CR-01 — use a scoped partial `update({ id, userId, deletedAt: IsNull() }, dto)` for `AccountsService.update()`, and consider whether `remove()` should also verify `result.affected` rather than assuming the prior `findOne()` result is still valid at write time.

### WR-03: No upper-bound check on cumulative account balance vs. `numeric(12,2)` capacity

**File:** `src/accounts/accounts.service.ts:83-98`, `src/common/decimal.util.ts:40-42`

**Issue:** `CreateTransactionDto.amount`/`CreateTransferDto.amount` cap a *single* transaction's integer part at 10 digits (matching `numeric(12,2)`'s max), but `adjustBalance()` has no check on the *resulting* balance after `addDecimalStrings(account.balance, delta)`. A sequence of large income transactions (each individually valid) can push `account.balance` past `9999999999.99`. When `manager.save(account)` is then issued, Postgres raises a `numeric field overflow` error (SQLSTATE 22003) that is not caught anywhere in `adjustBalance()`/`TransactionsService.create()`/`TransfersService.create()`, so it propagates as an unhandled 500 instead of a controlled 400, and (depending on the global exception filter) may leak a raw Postgres error message to the client.

**Fix:** Either validate the post-delta balance against the column's representable range before `save()` and throw a `BadRequestException`, or catch the specific Postgres error code in the service layer and translate it to a 400.

## Info

### IN-01: `toCents()` silently truncates (not rounds or rejects) fractional digits beyond 2 decimal places

**File:** `src/common/decimal.util.ts:14-21`

**Issue:**
```ts
const cents = fracPart.padEnd(2, '0').slice(0, 2);
```
If this function is ever called with a value carrying more than 2 fractional digits (currently unreachable through the validated DTO regexes, but this is a shared utility with no guard of its own), it silently drops the extra precision instead of rounding or throwing — e.g. `toCents('1.239')` yields the same cents as `'1.23'`, silently discarding `9`. This is a latent correctness trap for any future caller that doesn't happen to route through `CreateTransactionDto`/`CreateTransferDto`'s regex first.

**Fix:** Add a defensive check (e.g. reject fractional parts longer than 2 digits) so the function fails loudly rather than silently losing precision if reused elsewhere later.

### IN-02: `TransfersService` injects `transactionsRepository` but never uses it

**File:** `src/transfers/transfers.service.ts:23-24`

**Issue:** `@InjectRepository(Transaction) private readonly transactionsRepository: Repository<Transaction>` is declared and wired through DI, but every read/write in the class goes through `queryRunner.manager.findOne(Transaction, ...)` / `queryRunner.manager.save(...)` instead. The field is dead — it adds unnecessary DI surface and the module's own `TypeOrmModule.forFeature([Transaction])` import exists solely to support an unused injection, which is mildly misleading for a reader trying to understand why this module registers its own copy of the repository.

**Fix:** Remove the unused constructor parameter and field, or use `this.transactionsRepository` for the non-transactional reads/writes if that was the original intent.

### IN-03: No `GET /transfers` / `GET /transfers/:id` route

**File:** `src/transfers/transfers.controller.ts`

**Issue:** A transfer can only be inspected individually by scanning the combined `GET /transactions` list for a matching id (as the e2e suite itself does). This is very likely intentional per the documented D-05 boundary (no PATCH), but there's no equivalent comment explaining the GET omission the way the PATCH omission is explicitly called out, so it reads as ambiguous between "deliberate" and "not yet built."

**Fix:** If intentional, add a short comment analogous to the PATCH one clarifying that `GET /transactions` is the canonical read path for transfers, to prevent a future maintainer from treating this as an oversight.

---

_Reviewed: 2026-09-14T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
