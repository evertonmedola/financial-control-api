---
phase: 05-budgets
fixed_at: 2026-09-22T19:50:00Z
review_path: .planning/phases/05-budgets/05-REVIEW.md
iteration: 3
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 05: Code Review Fix Report

**Fixed at:** 2026-09-22T19:50:00Z
**Source review:** .planning/phases/05-budgets/05-REVIEW.md
**Iteration:** 3

**Summary:**
- Findings in scope: 2 (CR-01, WR-01 — `fix_scope: critical_warning`; IN-01 and IN-02 explicitly out of scope, left untouched)
- Fixed: 2
- Skipped: 0

**Verification environment:** `workflow.use_worktrees` is `false` in `.planning/config.json`, so all edits, syntax checks, and test runs happened directly in the main checkout on `master` — no isolated worktree was created and no cleanup tail was needed. Results below are reproducible from this same tree.

## Fixed Issues

### CR-01: `PATCH /transactions/:id` with `{"date": null}` or `{"description": null}` crashed with an unhandled 500 (NOT-NULL constraint violation)

**Files modified:** `src/transactions/dto/update-transaction.dto.ts`
**Commit:** `23464ba`
**Applied fix:** `UpdateTransactionDto`'s `description` and `date` fields used plain `@IsOptional()`, which class-validator short-circuits for both `null` and `undefined` — letting an explicit `null` bypass `@IsString()`/`@IsDateString()` and reach `Repository.update()`, which then tried to write `NULL` into the NOT NULL `description`/`date` columns and crashed with an unhandled 500 (Postgres `23502`). Replaced `@IsOptional()` with `@ValidateIf((_dto, value) => value !== undefined)` on both fields — the exact same pattern already applied to `UpdateBudgetDto.limit` for CR-02 in a prior iteration. `null` now reaches the underlying validators and fails with a controlled 400 instead of crashing; the service-layer empty-PATCH guard never sees a `null`, since it can no longer pass validation.

### WR-01: Empty-PATCH-body guards were hand-enumerated per field, risking silent field-update loss if a new optional field is ever added

**Files modified:** `src/common/patch.util.ts` (new), `src/common/patch.util.spec.ts` (new), `src/budgets/budgets.service.ts`, `src/transactions/transactions.service.ts`
**Commit:** `c2ef34d`
**Applied fix:** Extracted `hasNoUpdatableFields(dto: object): boolean` (`Object.values(dto).every((v) => v === undefined)`) into `src/common/patch.util.ts`, with a unit spec covering the empty/all-undefined/mixed/explicit-`null` cases (the `null` case is the important one: `hasNoUpdatableFields({ date: null })` must be `false`, since `null` is a real value, not an absent field). Both `BudgetsService.update()`'s `dto.limit === undefined` check and `TransactionsService.update()`'s `dto.description === undefined && dto.date === undefined` check were replaced with `hasNoUpdatableFields(dto)`, so the guard is now derived from each DTO's actual keys rather than a manually maintained field list. This also resolves IN-01's duplication note as a side effect, though IN-01 itself was out of scope for this pass.

**Regression tests added** (separate commit `d7d2574`, required by the fix-pass task instructions, not itself a REVIEW.md finding):
- `src/transactions/dto/update-transaction.dto.spec.ts` (new): exercises `class-validator`'s `validate()` directly against `UpdateTransactionDto` instances (via `plainToInstance`) — mirrors the CR-01 bug's actual location (the validation layer, not the service) more precisely than a service-level unit test would, since `TransactionsService.update()` never sees a value that fails DTO validation. Asserts `{date: null}` and `{description: null}` each produce a validation error on that property, while an omitted-fields body and a valid-values body both pass with zero errors.
- `test/transactions.e2e-spec.ts`: new end-to-end test posting `PATCH /transactions/:id` with `{"date": null}` and separately `{"description": null}`, asserting `400` for both (previously an unhandled `500` against the real Postgres instance, not a mock), then re-reading the transaction to confirm it was left unchanged.

Note on "mirroring the CR-02 null-limit test pattern" (per the task instructions): no dedicated null-limit unit/e2e test was ever actually committed for CR-02 (`1e4d59e` only touched `src/budgets/dto/update-budget.dto.ts`, confirmed via `git show --stat`) — CR-02 relied on the reviewer's live reproduction rather than a checked-in regression test. This pass could not literally mirror a nonexistent test, so it wrote CR-01's regression tests in the same spirit (validation-layer unit test + e2e 400 assertion) instead.

## Skipped Issues

None. IN-01 (duplicated guard logic — addressed anyway as a side effect of the WR-01 fix) and IN-02 (missing regression test for the `EXPENSE`-only spend aggregation filter, carryover) were both explicitly out of scope for this fix pass (`fix_scope: critical_warning`) and left untouched, per the task instructions.

## Verification

- `npx tsc --noEmit -p tsconfig.json` — no new errors in any modified/new file (`update-transaction.dto.ts`, `update-transaction.dto.spec.ts`, `patch.util.ts`, `patch.util.spec.ts`, `budgets.service.ts`, `transactions.service.ts`, `transactions.e2e-spec.ts`). Pre-existing unrelated errors are untouched.
- `npx jest src/budgets src/transactions src/common` — 4 suites / 42 tests passed after the WR-01 fix; `npx jest src/transactions/dto/update-transaction.dto.spec.ts` — 1 suite / 4 tests passed for the new CR-01 DTO validation test.
- `npm run test` (full unit suite) — 9 suites / 80 tests passed (up from 7 suites / 70 tests in iteration 2, reflecting the new `patch.util.spec.ts` and `update-transaction.dto.spec.ts` files).
- `npx jest --config ./test/jest-e2e.json test/transactions.e2e-spec.ts` — 22 tests passed, including the new null-date/null-description regression test, against the real Postgres instance (not mocked).
- `npm run test:e2e` (full e2e suite) — 13 suites / 149 tests passed (up from 148 in iteration 2, the new CR-01 e2e test). The one logged `ERROR [HttpExceptionFilter] Unhandled exception on GET /auth/me` line is a pre-existing, intentional exception-handling test case (confirmed against iteration 2's report), not a failure.

No regressions observed in any test tier. This was the final auto-fix iteration (cap is 3); the remaining open findings (IN-01, IN-02) are informational and out of scope for auto-fix.

---

_Fixed: 2026-09-22T19:50:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
