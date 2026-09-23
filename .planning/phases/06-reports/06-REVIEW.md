---
phase: 06-reports
reviewed: 2026-09-23T01:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - src/app.module.ts
  - src/reports/dto/category-summary-query.dto.ts
  - src/reports/dto/category-summary-response.dto.ts
  - src/reports/dto/month-comparison-query.dto.ts
  - src/reports/dto/month-comparison-response.dto.ts
  - src/reports/dto/net-balance-response.dto.ts
  - src/reports/dto/net-balance-query.dto.ts
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
  warning: 0
  info: 2
  total: 2
status: issues_found
---

# Phase 06: Code Review Report (re-review, iteration 2)

**Reviewed:** 2026-09-23T01:00:00Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Re-review after the fix pass documented in `06-REVIEW-FIX.md`, which claimed to resolve WR-01 (missing unit coverage for `getCategorySummary`) and WR-02 (`GET /reports/net-balance` not structurally rejecting unexpected/spoofed query params). Both fixes were verified directly against the current code, not just trusted from the fix report.

**WR-01 — verified fixed.** `src/reports/reports.service.spec.ts:50-109` now has a full `describe('getCategorySummary', ...)` block with four tests: the `from > to` → `BadRequestException` guard, the empty-spend-map early return (asserting `categoriesService.findAll` is never called), the soft-deleted-category skip branch, and a normal-case assertion of the built DTO shape. All four map onto the exact branches called out in the original finding (`reports.service.ts:31-33`, `41-43`, `59-61`). Ran the actual assertions through the current `ReportsService` logic by hand (guard is a strict string `>` on validated `YYYY-MM-DD` values, matches test expectations); no gaps.

**WR-02 — verified fixed.** `src/reports/dto/net-balance-query.dto.ts` adds an empty `NetBalanceQueryDto`, and `reports.controller.ts:33-39` now binds `@Query() _query: NetBalanceQueryDto` on the `netBalance` handler. Because the DTO has zero decorated properties, the global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` (`app.module.ts:84-90`) now rejects *any* query key on this route with 400 — confirmed this is the correct mechanism (whitelist strips/forbids properties not present on the target class, and an empty class has none). `test/reports.e2e-spec.ts:382-396` adds two e2e assertions (`?foo=bar` → 400, spoofed `?userId=...` → 400) that directly exercise this. Checked that `test/reports-cross-tenant.e2e-spec.ts`'s net-balance calls (`:228, :237`) pass no query string at all, so the tightened validation doesn't break the pre-existing isolation suite. `git show --stat` on both fix commits (`7f7dd68`, `31da4bc`) confirms the changes are scoped exactly to what the fix report claims — no incidental edits elsewhere.

No new bugs, security issues, or regressions were introduced by either fix. `transactions.service.ts` and `transactions.service.spec.ts` are unchanged since the prior review pass and were re-scanned for anything missed the first time; nothing new surfaced.

The two Info-level findings from the previous review were explicitly left out of scope by the fix pass (per `06-REVIEW-FIX.md`'s stated scope) and remain present, unchanged. They are re-listed below for completeness/tracking, not as new findings.

## Info

### IN-01: Duplicated "skip category with no active name" block between `getCategorySummary` and `getMonthComparison` (carried over, unfixed — out of fix scope)

**File:** `src/reports/reports.service.ts:53-61` and `src/reports/reports.service.ts:130-137`
**Issue:** Both methods build an identical `categoryNamesById` lookup and an identical `if (categoryName === undefined) { continue; }` skip for a soft-deleted category still referenced by transactions. Correct in both places, but duplicated, so a future change to this convention (e.g. showing `"(categoria excluída)"` instead of skipping) must be applied in two places.
**Fix:** Extract a small private helper, e.g. `private resolveCategoryName(categoryId: string, categoryNamesById: Map<string, string>): string | undefined`, and call it from both loops.

### IN-02: Unused mock method in `reports.service.spec.ts`'s `transactionsService` double (carried over, unfixed — out of fix scope)

**File:** `src/reports/reports.service.spec.ts:14-19,29-31`
**Issue:** The `transactionsService` mock's `Pick<...>` type and `beforeEach` setup both still include `sumByCategoryExcludingTransfers`, but `ReportsService` never calls that method (only `sumByCategoryForDateRangeExcludingTransfers` is used). Harmless leftover, likely copy-pasted from `transactions.service.spec.ts`, but dead test setup that could mislead a future reader into thinking `ReportsService` calls both aggregation methods. Note: the new `getCategorySummary` tests added for WR-01 correctly use only `sumByCategoryForDateRangeExcludingTransfers`, so this stale entry wasn't propagated into the new tests — it's isolated to the shared mock declaration.
**Fix:** Drop `sumByCategoryExcludingTransfers` from the `Pick<...>` type and the mock initialization in this spec file.

---

_Reviewed: 2026-09-23T01:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
