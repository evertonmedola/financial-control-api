---
phase: 06-reports
plan: 02
subsystem: reports
tags: [nestjs, typeorm, reports, aggregation, decimal-arithmetic, net-balance, month-comparison]

requires:
  - phase: 06-reports
    provides: "06-01-PLAN.md's ReportsModule/ReportsController/ReportsService skeleton, the @Query()-bound class-validator DTO pattern, and TransactionsService.sumByCategoryForDateRangeExcludingTransfers, all extended (not duplicated) by this plan"
provides:
  - "GET /reports/net-balance — a single net figure = sum(asset-type account balances) - sum(cartao_credito balances), soft-deleted accounts excluded, decimal.util.ts only"
  - "GET /reports/month-comparison?month=YYYY-MM — per-category {categoryId, categoryName, currentMonthTotal, previousMonthTotal, delta} comparing the requested month against the immediately preceding calendar month"
  - "ReportsService.getMonthBounds/getPreviousMonthBounds — UTC-date-parts month-bounds helpers parameterized by a requested month string, including the January-into-December rollover"
  - "All three ROADMAP.md Phase 6 success criteria now complete (category summary, net balance, month comparison)"
affects: []

actuals:
  tokens: 6487
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "AccountsModule wired into ReportsModule as a third read-only dependency (alongside Categories/Transactions), still with no TypeOrmModule.forFeature() call of its own"
    - "Month-bounds computation parameterized by a requested 'YYYY-MM' string (getMonthBounds/getPreviousMonthBounds), mirroring BudgetsService.getCurrentMonthBounds's UTC-date-parts approach but decoupled from new Date()"
    - "Union-of-two-maps aggregation (current-month keys UNION previous-month keys) so a category with activity in only one side of a comparison still appears, defaulting the missing side to '0.00' — the read-side analog of Budgets' Pitfall-4 convention"

key-files:
  created:
    - src/reports/dto/net-balance-response.dto.ts
    - src/reports/dto/month-comparison-query.dto.ts
    - src/reports/dto/month-comparison-response.dto.ts
    - src/reports/reports.service.spec.ts
  modified:
    - src/reports/reports.module.ts
    - src/reports/reports.controller.ts
    - src/reports/reports.service.ts
    - test/reports.e2e-spec.ts

key-decisions:
  - "getMonthBounds/getPreviousMonthBounds implemented as private ReportsService methods (not exported/shared with BudgetsService) — the two services' bounds logic is now duplicated in shape but each parameterized differently (BudgetsService always uses new Date(), ReportsService always parses a requested month string); no shared abstraction was extracted since PLAN.md didn't call for one and the two use different inputs"
  - "The net-balance e2e test uses a dedicated freshly-registered user (not the shared accessToken every other describe block in this file uses) — the category-summary describe block already created several corrente accounts under the shared user, which would have inflated an exact-equality net-balance assertion; isolating the user keeps the '700.00'/'-300.00' assertions exact without touching prior tests"
  - "MonthComparisonResponseDto.build() intentionally has no deltaPercent field or divide-by-zero branch — subtractDecimalStrings never divides, so CONTEXT.md's explicitly deferred percentage-convention question never had to be resolved in this plan"

patterns-established:
  - "Cross-module netting (assets minus liabilities) via decimal.util.ts's addDecimalStrings/subtractDecimalStrings, seeded from '0.00', never parseFloat/Number()"

requirements-completed: [REP-02, REP-03]

coverage:
  - id: D1
    description: "GET /reports/net-balance nets a corrente asset against a cartao_credito debt (700.00), and excludes a soft-deleted account from the total (-300.00 after delete)"
    requirement: "REP-02"
    verification:
      - kind: e2e
        ref: "test/reports.e2e-spec.ts#net balance > GET /reports/net-balance nets a corrente asset against a cartao_credito debt, and excludes a soft-deleted account (REP-02)"
        status: pass
    human_judgment: false
  - id: D2
    description: "getNetBalance nets a mixed asset+liability list, sums an all-asset list plainly, nets to negative for an all-debt list, and nets to 0.00 for an empty list"
    requirement: "REP-02"
    verification:
      - kind: unit
        ref: "src/reports/reports.service.spec.ts#getNetBalance"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /reports/month-comparison?month=YYYY-MM returns per-category {categoryId, categoryName, currentMonthTotal, previousMonthTotal, delta} for a real expense in the current month vs. a different-amount expense in the immediately preceding month"
    requirement: "REP-03"
    verification:
      - kind: e2e
        ref: "test/reports.e2e-spec.ts#month comparison > GET /reports/month-comparison compares the requested month against the immediately preceding one (REP-03)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Malformed month (2026-13, not-a-month) and missing month both return 400"
    requirement: "REP-03"
    verification:
      - kind: e2e
        ref: "test/reports.e2e-spec.ts#month comparison > rejects a malformed \"month\" (2026-13) with 400 / (not-a-month) with 400 / missing \"month\" with 400"
        status: pass
    human_judgment: false
  - id: D5
    description: "A category active in only one of the two compared months still appears, with the inactive side defaulting to '0.00' and a correctly-signed delta"
    requirement: "REP-03"
    verification:
      - kind: unit
        ref: "src/reports/reports.service.spec.ts#getMonthComparison > a category present only in the previous/current month appears with the other side 0.00"
        status: pass
    human_judgment: false
  - id: D6
    description: "A January month correctly rolls its previous-month bounds into December of the prior year"
    requirement: "REP-03"
    verification:
      - kind: unit
        ref: "src/reports/reports.service.spec.ts#getMonthComparison > a January month rolls its previous-month bounds into December of the prior year"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-09-23
status: complete
---

# Phase 6 Plan 2: Net Balance and Month-Over-Month Comparison Summary

**Delivers `GET /reports/net-balance` (assets minus credit-card debt via decimal.util.ts, soft-deleted accounts excluded) and `GET /reports/month-comparison?month=YYYY-MM` (per-category current-vs-previous-month totals with correct January rollover), completing all three Phase 6 ROADMAP.md success criteria.**

## Performance
- **Duration:** 15min (approx)
- **Started:** 2026-09-23T00:14 (approx)
- **Completed:** 2026-09-23T00:23
- **Tasks:** 2 completed
- **Files modified:** 8 (4 created, 4 modified)

## Accomplishments
- `GET /reports/net-balance` added: reads `AccountsService.findAll(userId)` (already `userId`+`deletedAt IS NULL`-scoped), nets `CORRENTE`/`POUPANCA`/`CARTEIRA` balances as assets against `CARTAO_CREDITO` balances as debt, entirely via `addDecimalStrings`/`subtractDecimalStrings` — no `parseFloat`/`Number()` anywhere.
- `AccountsModule` added to `ReportsModule`'s imports — the third read-only cross-module dependency, still no `TypeOrmModule.forFeature()` of Reports' own.
- `GET /reports/month-comparison?month=YYYY-MM` added: computes current + previous month bounds via new `getMonthBounds`/`getPreviousMonthBounds` helpers (mirroring `BudgetsService.getCurrentMonthBounds`'s UTC-date-parts approach, parameterized by the requested month instead of `new Date()`), calls `sumByCategoryForDateRangeExcludingTransfers` twice concurrently via `Promise.all`, and unions both months' categoryIds so a category active in only one side still appears with the other defaulting to `'0.00'`.
- `MonthComparisonQueryDto` structurally rejects any non-`YYYY-MM` `month` value via `@Matches(/^\d{4}-(0[1-9]|1[0-2])$/)`, before it ever reaches bounds computation.
- `MonthComparisonResponseDto.build()` computes `delta` via `subtractDecimalStrings` — deliberately no `deltaPercent` field (CONTEXT.md's explicit deferral) and no divide-by-zero branch, since subtraction never divides.
- End-to-end proof for both endpoints against the real migrated database: net balance's asset-minus-debt netting plus soft-delete exclusion (`700.00` → `-300.00` after deleting the asset account), and month comparison's real current-vs-previous-month totals (`40.00`/`25.00`/`15.00`).
- Unit coverage: `getNetBalance`'s mixed/all-asset/all-debt/empty-list cases; `getMonthComparison`'s current/previous bounds assertions, one-sided-activity cases (both directions), the January-into-December rollover, and the soft-deleted-category-skip case.
- Full regression check: 91/91 unit tests and 163/163 e2e tests pass across the whole codebase after this plan's changes.

## Task Commits
1. **Task 1: Consolidated net balance across accounts (REP-02)** - `571ca6e` (feat)
2. **Task 2: Month-over-month category comparison (REP-03)** - `6654420` (feat)

## Files Created/Modified
- `src/reports/dto/net-balance-response.dto.ts` - `NetBalanceResponseDto` — computed response, `static build()` factory mirroring `BudgetStatusDto`.
- `src/reports/dto/month-comparison-query.dto.ts` - `MonthComparisonQueryDto` — `@Matches()`-validated `YYYY-MM` query param.
- `src/reports/dto/month-comparison-response.dto.ts` - `MonthComparisonResponseDto` — computed response, `delta` via `subtractDecimalStrings`, no `deltaPercent`.
- `src/reports/reports.service.spec.ts` - Added `getNetBalance` and `getMonthComparison` describe blocks (this plan's tasks; `getCategorySummary` coverage remains 06-01's e2e-only proof, unchanged).
- `src/reports/reports.module.ts` - `AccountsModule` added to `imports`.
- `src/reports/reports.controller.ts` - `GET /reports/net-balance`, `GET /reports/month-comparison` added alongside 06-01's `category-summary` route.
- `src/reports/reports.service.ts` - `getNetBalance()`, `getMonthComparison()`, `getMonthBounds()`, `getPreviousMonthBounds()` added.
- `test/reports.e2e-spec.ts` - `net balance` (dedicated isolated user) and `month comparison` describe blocks added.

## Decisions Made
- `getMonthBounds`/`getPreviousMonthBounds` are private `ReportsService` methods, not shared with `BudgetsService` — the two services' bounds logic is similarly shaped but differently parameterized (Budgets always reads `new Date()`; Reports always parses a requested month string), so no shared abstraction was extracted; PLAN.md didn't call for one.
- The `net balance` e2e test registers its own dedicated user rather than reusing the file's shared `accessToken` — the `category summary` describe block (06-01) already created several `corrente` accounts under that shared user, which would have inflated an exact-equality net-balance assertion (`700.00`/`-300.00`). Isolating the user keeps those assertions exact without needing to touch or reset prior tests' data.
- No `deltaPercent` divide-by-zero convention needed to be decided — `subtractDecimalStrings` never divides, so CONTEXT.md's explicitly deferred question about that convention simply doesn't arise in this implementation.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Prettier auto-fix was applied via `eslint --fix` (whitespace/line-wrap only, no logic change) after the initial edits to `test/reports.e2e-spec.ts`. Pre-existing `@typescript-eslint/no-unsafe-argument` warnings on every `supertest` call in that file (an existing pattern across all e2e specs in this codebase, not introduced by this plan) were left alone per the scope-boundary rule.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Phase 6 (Reports) is now feature-complete: all three ROADMAP.md success criteria (category/period summary, consolidated net balance, month-over-month comparison) are shipped, tested, and passing against the real migrated database. Per CLAUDE.md's phase-close-out convention (applied identically in Phases 1-5), a post-execution code review and the `security-review` skill checklist should run before this phase is marked fully closed — no origin git remote exists in this repo, so (consistent with every prior phase's STATE.md note) the checklist would need to be applied manually rather than via the skill's `git diff`-based invocation. This plan's own manual pass against the `<threat_model>` STRIDE register (T-06-05 through T-06-08) found no gaps: both new routes are `userId`-scoped with no client-supplied id (no IDOR surface), `month` is structurally validated before use, and all money arithmetic goes through `decimal.util.ts` exclusively.

---
*Phase: 06-reports*
*Completed: 2026-09-23*

## Self-Check: PASSED

All created files (src/reports/dto/net-balance-response.dto.ts, src/reports/dto/month-comparison-query.dto.ts, src/reports/dto/month-comparison-response.dto.ts, src/reports/reports.service.spec.ts) confirmed present on disk. Both task commits (571ca6e, 6654420) confirmed present in git log.
