---
phase: 06-reports
reviewed: 2026-09-23T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/app.module.ts
  - src/reports/dto/category-summary-query.dto.ts
  - src/reports/dto/category-summary-response.dto.ts
  - src/reports/dto/month-comparison-query.dto.ts
  - src/reports/dto/month-comparison-response.dto.ts
  - src/reports/dto/net-balance-response.dto.ts
  - src/reports/reports.controller.ts
  - src/reports/reports.module.ts
  - src/reports/reports.service.spec.ts
  - src/reports/reports.service.ts
  - src/transactions/transactions.service.spec.ts
  - src/transactions/transactions.service.ts
  - test/reports.e2e-spec.ts
  - test/reports-cross-tenant.e2e-spec.ts
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-09-23T00:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Reviewed the Reports module (category summary, net balance, month comparison), its DTOs, module wiring, the supporting `TransactionsService` aggregation methods, and the unit/e2e suites. Traced the money-math call chain (`decimal.util.ts` via `addDecimalStrings`/`subtractDecimalStrings`), the date-bounds computation for month comparisons across year rollover, tenant scoping on every read path, and the DTO validation surface (including the `forbidNonWhitelisted` IDOR-closing behavior tested in the e2e suite).

No correctness bugs, injection vectors, or IDOR gaps were found — every query is userId-scoped and parameterized, decimal arithmetic goes through the shared BigInt-cents helpers (never `parseFloat`/`Number`), and the month-bounds/previous-month-rollover logic (including the December-rollback case) is arithmetically sound and unit-tested. The findings below are test-coverage and maintainability gaps, not shipped defects.

## Warnings

### WR-01: `ReportsService.getCategorySummary` has no unit test coverage

**File:** `src/reports/reports.service.spec.ts`
**Issue:** `reports.service.spec.ts` has `describe` blocks for `getNetBalance` and `getMonthComparison` only — there is no `describe('getCategorySummary', ...)` block at all. This leaves the entire method's business logic — the `from > to` → `BadRequestException` guard (`reports.service.ts:31-33`), the early return when `spentByCategory.size === 0` (`reports.service.ts:41-43`), and the "skip category with no active name" branch (`reports.service.ts:59-61`) — verified only indirectly through `test/reports.e2e-spec.ts`'s full-stack e2e tests. A regression in any of these branches (e.g. accidentally flipping the `from > to` comparison, or removing the soft-deleted-category skip) would not be caught by the fast unit suite; it would only surface in the slower e2e run, and only for the specific cases those e2e tests happen to construct.
**Fix:** Add a `describe('getCategorySummary', ...)` block mirroring the existing `getMonthComparison` tests: mock `transactionsService.sumByCategoryForDateRangeExcludingTransfers` and `categoriesService.findAll` directly and assert on (a) the `from > to` 400, (b) the empty-map early return, and (c) the skip-when-category-name-undefined branch, e.g.:
```ts
describe('getCategorySummary', () => {
  it('throws BadRequestException when from > to', async () => {
    await expect(
      service.getCategorySummary('user-id', '2026-09-20', '2026-09-01'),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns [] without calling categoriesService.findAll when there is no spend in range', async () => {
    transactionsService.sumByCategoryForDateRangeExcludingTransfers.mockResolvedValue(new Map());
    const result = await service.getCategorySummary('user-id', '2026-09-01', '2026-09-30');
    expect(result).toEqual([]);
    expect(categoriesService.findAll).not.toHaveBeenCalled();
  });
});
```

### WR-02: `GET /reports/net-balance` silently ignores unexpected query params instead of 400ing like every other Reports/domain endpoint

**File:** `src/reports/reports.controller.ts:28-33`
**Issue:** `categorySummary` and `monthComparison` both bind `@Query()` to a DTO, so the global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` rejects any unrecognized query param with 400 — and `test/reports.e2e-spec.ts` explicitly asserts this IDOR-relevant behavior for `category-summary` ("rejects a client-supplied userId in the query string with 400"). `netBalance` has no `@Query()` parameter at all, so Nest never runs the query string through the validation pipe for this route: `GET /reports/net-balance?userId=<other-user>&foo=bar` returns 200 exactly as if no query string were sent, because nothing reads it — but this also means the endpoint provides no structural proof that a client-supplied `userId`/`accountId` is ignored, unlike its siblings. The code comment at line 27 ("No query parameters — narrowest possible input surface") states an intent that isn't actually enforced at the framework layer; it only happens to be harmless today because the handler genuinely never reads `req.query`.
**Fix:** Either add an explicit empty DTO to get the same `forbidNonWhitelisted` 400 behavior as the other two routes, for consistency and defense-in-depth:
```ts
export class NetBalanceQueryDto {}
...
@Get('net-balance')
async netBalance(
  @CurrentUser() userId: string,
  @Query() _query: NetBalanceQueryDto,
): Promise<NetBalanceResponseDto> {
  return this.reportsService.getNetBalance(userId);
}
```
or add an explicit e2e test asserting the current (permissive) behavior so it's a documented decision rather than an implicit gap.

## Info

### IN-01: Duplicated "skip category with no active name" block between `getCategorySummary` and `getMonthComparison`

**File:** `src/reports/reports.service.ts:53-61` and `src/reports/reports.service.ts:130-137`
**Issue:** Both methods build an identical `categoryNamesById` lookup and an identical `if (categoryName === undefined) { continue; }` skip for a soft-deleted category still referenced by transactions. The logic is correct in both places, but duplicated rather than shared, so a future change to this convention (e.g. showing `"(categoria excluída)"` instead of skipping) has to be remembered and applied in two places.
**Fix:** Extract a small private helper, e.g. `private resolveCategoryName(categoryId: string, categoryNamesById: Map<string, string>): string | undefined`, and call it from both loops.

### IN-02: Unused mock method in `reports.service.spec.ts`'s `transactionsService` double

**File:** `src/reports/reports.service.spec.ts:13-19,28-31`
**Issue:** The `transactionsService` mock's `Pick<...>` type and `beforeEach` setup both include `sumByCategoryExcludingTransfers`, but `ReportsService` never calls that method (only `sumByCategoryForDateRangeExcludingTransfers`, added in this phase, is used). It's a harmless leftover — likely copy-pasted from `transactions.service.spec.ts` — but it's dead test setup that could mislead a future reader into thinking `ReportsService` calls both aggregation methods.
**Fix:** Drop `sumByCategoryExcludingTransfers` from the `Pick<...>` type and the mock initialization in this spec file.

---

_Reviewed: 2026-09-23T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
