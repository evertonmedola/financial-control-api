---
phase: 05-budgets
reviewed: 2026-09-22T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - src/app.module.ts
  - src/budgets/budgets.controller.ts
  - src/budgets/budgets.module.ts
  - src/budgets/budgets.service.spec.ts
  - src/budgets/budgets.service.ts
  - src/budgets/dto/budget-response.dto.ts
  - src/budgets/dto/budget-status.dto.ts
  - src/budgets/dto/create-budget.dto.ts
  - src/budgets/dto/update-budget.dto.ts
  - src/budgets/entities/budget.entity.ts
  - src/common/decimal.util.spec.ts
  - src/common/decimal.util.ts
  - src/database/migrations/1789600000000-CreateBudgets.ts
  - src/transactions/transactions.service.spec.ts
  - src/transactions/transactions.service.ts
  - test/budgets.e2e-spec.ts
  - test/budgets-cross-tenant.e2e-spec.ts
findings:
  critical: 2
  warning: 1
  info: 2
  total: 5
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-09-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

The Budgets module is well-structured and follows the codebase's established conventions closely (decimal-string money handling, ownership-chain IDOR checks, soft-delete, partial unique index + Postgres-error-to-409 translation). The cross-tenant e2e suite (`test/budgets-cross-tenant.e2e-spec.ts`) is thorough and I found no IDOR gaps in it.

However, two correctness defects surfaced that undermine the feature's core value proposition (accurate budget tracking) and are not covered by any existing test:

1. The `spent` aggregation used by `GET /budgets` counts more than expenses — it only excludes `TRANSFER` rows, not `INCOME` rows, so an income transaction mis-tagged (or legitimately tagged, e.g. a refund) against a `DESPESA` category inflates the reported spend.
2. `PATCH /budgets/:id` with `{"limit": null}` bypasses the DTO's regex validation entirely (a documented `class-validator` `@IsOptional()` behavior) and reaches the database, producing an unhandled 500 instead of a controlled 400.

A third, lower-severity concurrency gap was found in `BudgetsService.update()`, which mirrors `CategoriesService.update()`'s read-then-mutate-then-save pattern instead of the scoped conditional-update pattern `TransactionsService.update()` deliberately adopted (per its own inline "CR-01" comment) to close exactly this race.

## Critical Issues

### CR-01: `spent` total wrongly includes non-expense transactions

**File:** `src/transactions/transactions.service.ts:210-212`

**Issue:** `sumByCategoryExcludingTransfers` (the sole data source for Budgets' `spent`/`remaining`/`overBudget` fields, per `BudgetsService.findAllWithStatus`) filters out `TRANSFER` rows only:

```ts
.andWhere('transaction.type != :transferType', {
  transferType: TransactionType.TRANSFER,
})
```

It does **not** filter to `type = EXPENSE`. Nothing elsewhere in the codebase enforces that a transaction's `type` (income/expense) matches the referenced category's `type` (receita/despesa) — `TransactionsService.create()` (lines 30-45) only validates category *ownership* via `categoriesService.findOne`, never `category.type` against `dto.type`. A budget can only be created for a `DESPESA` category (`BudgetsService.create`, line 39), but any `INCOME` transaction can still be posted against that same `DESPESA` category (e.g. a refund logged as income under an expense category — a very plausible real-world entry for a personal-finance app). When that happens, the income amount is added straight into the SUM, inflating `spent` and potentially flipping `overBudget` to `true` incorrectly, because `Transaction.amount` is always stored as an unsigned magnitude (confirmed via `CreateTransactionDto.amount`'s no-sign regex and `TransactionsService.create`'s sign-only-from-`type` delta logic) — there is no sign to net the income back out.

This is untested: neither `test/budgets.e2e-spec.ts` nor `transactions.service.spec.ts`'s `sumByCategoryExcludingTransfers` tests exercise a mixed income/expense category.

**Fix:**
```ts
.andWhere('transaction.type = :expenseType', {
  expenseType: TransactionType.EXPENSE,
})
```
(replacing the `!= :transferType` clause), or alternatively enforce `category.type === dto.type` mapping consistency at transaction-creation time in `TransactionsService.create()` so a despesa category can never receive an income row in the first place. The query-level fix is the more defensive one since it doesn't depend on that invariant being introduced/maintained elsewhere.

### CR-02: `PATCH /budgets/:id` with `limit: null` bypasses validation and crashes with 500 instead of 400

**File:** `src/budgets/dto/update-budget.dto.ts:15-20`

**Issue:**
```ts
@IsOptional()
@Matches(/^(?!0+(\.0{1,2})?$)\d{1,10}(\.\d{1,2})?$/, { ... })
limit?: string;
```
`class-validator`'s `@IsOptional()` skips **all** subsequent validators for a property whenever the value is `null` **or** `undefined` (confirmed in `node_modules/class-validator/cjs/decorator/common/IsOptional.js`: the guard is `value !== null && value !== undefined`). A client request body of `{"limit": null}` therefore passes the global `ValidationPipe` untouched — `whitelist`/`forbidNonWhitelisted` don't reject it because `limit` is a declared property, and `@Matches` never runs.

The `null` then flows through `BudgetsController.update` → `BudgetsService.update`:
```ts
const budget = await this.findOne(userId, id);
Object.assign(budget, dto);            // budget.limit = null
return this.saveOrThrowConflict(budget);
```
`budgets.limit` is a NOT NULL `numeric(12,2)` column (see `1789600000000-CreateBudgets.ts:12` and the entity's `@Column({ type: 'decimal', ... })` with no `nullable: true`). The resulting `save()` fails with Postgres error code `23502` (not-null violation), which `isUniqueViolation` doesn't recognize (it only matches `23505` + the specific constraint name), so the raw `QueryFailedError` is rethrown and surfaces to the client as an unhandled 500 (sanitized by `HttpExceptionFilter`, but still the wrong status code and an uncontrolled code path for ordinary malformed client input).

**Fix:** Add an explicit type/`null` guard so `null` is treated as an invalid value rather than "absent", e.g.:
```ts
@IsOptional()
@ValidateIf((_, value) => value !== null)
@Matches(/^(?!0+(\.0{1,2})?$)\d{1,10}(\.\d{1,2})?$/, { ... })
limit?: string;
```
or simply add `@IsNotEmpty()`-style narrowing / a custom validator that rejects `null` explicitly before `@IsOptional()`'s short-circuit applies. The simplest fix: don't rely on `@IsOptional()` alone — pair it with a decorator that still runs on `null` (e.g. `@ValidateIf(o => o.limit !== undefined)` combined with `@Matches`, so `null` is validated as a bad string and correctly 400s).

## Warnings

### WR-01: `BudgetsService.update()` has a TOCTOU race that can resurrect a soft-deleted budget

**File:** `src/budgets/budgets.service.ts:69-77`

**Issue:**
```ts
async update(userId: string, id: string, dto: UpdateBudgetDto): Promise<Budget> {
  const budget = await this.findOne(userId, id);
  Object.assign(budget, dto);
  return this.saveOrThrowConflict(budget);
}
```
`findOne` reads the row with `deletedAt: IsNull()`, giving an in-memory entity with `deletedAt = null`. If a concurrent `DELETE /budgets/:id` commits between that read and this method's `save()` call, `save()` (TypeORM `Repository.save` on an entity carrying its primary key) issues a full-column `UPDATE ... WHERE id = :id`, writing back the entity's in-memory `deletedAt = null` — silently undoing the concurrent soft-delete and reviving the row with the new `limit`. This is the exact class of bug `TransactionsService.update()` deliberately avoids (see its own inline comment: *"if a concurrent DELETE soft-deletes this row between the findOne() above and this write, `affected` is 0 and we fail with 404 instead of silently resurrecting the row (CR-01)"*), but `BudgetsService.update()` was modeled on `CategoriesService.update()`'s older, race-prone pattern instead.

The window is narrow (single request race) and there's no test exercising it, but it directly violates D-07's "soft delete only, never implicitly reversed" intent.

**Fix:** Use a scoped conditional update mirroring `TransactionsService.update()`:
```ts
async update(userId: string, id: string, dto: UpdateBudgetDto): Promise<Budget> {
  const result = await this.budgetsRepository.update(
    { id, userId, deletedAt: IsNull() },
    dto,
  );
  if (result.affected === 0) {
    throw new NotFoundException();
  }
  return this.findOne(userId, id);
}
```
(Still routed through `saveOrThrowConflict`'s translation if a `limit`-only update could realistically collide — today it can't, per the existing comment, but keep the 23505 guard if `categoryId` ever becomes editable again.)

## Info

### IN-01: `getCurrentMonthBounds()` reads `new Date()` directly, complicating deterministic testing

**File:** `src/budgets/budgets.service.ts:125-134`

**Issue:** The current-month window is derived from a fresh `new Date()` on every call with no injectable clock. `budgets.service.spec.ts`'s `findAllWithStatus` test only asserts the date strings loosely via regex (`expect.stringMatching(/^\d{4}-\d{2}-01$/)`), rather than pinning an exact month — acceptable for now, but any future test needing to assert an exact month boundary (e.g. a "first vs last day of month" edge case) will need to fake global time (`jest.useFakeTimers`) or refactor this into an injectable clock.

**Fix:** Not urgent; if finer-grained date-boundary tests are added later, extract a `Clock`/`now()` provider so `getCurrentMonthBounds` can be tested without relying on the real wall clock.

### IN-02: Near-duplicate `isUniqueViolation`/`saveOrThrowConflict` implementations across services

**File:** `src/budgets/budgets.service.ts:139-164` (duplicated from `src/categories/categories.service.ts:79-108`)

**Issue:** `BudgetsService` and `CategoriesService` each carry byte-for-byte-similar private helpers (`saveOrThrowConflict`, `isUniqueViolation`) differing only in the constraint name and message string. This is a maintainability nit, not a bug — but a shared `PostgresConflictHelper`/decorator would remove the duplication and the risk of the two copies drifting (e.g. one getting the CR-01 fix pattern and the other not, as happened between `TransactionsService.update()` and `BudgetsService.update()`/`CategoriesService.update()` — see WR-01).

**Fix:** Extract a shared utility, e.g. `src/common/postgres-conflict.util.ts` exporting `saveOrThrowConflict(repo, entity, constraintName, message)`, and have both services call it.

---

_Reviewed: 2026-09-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
