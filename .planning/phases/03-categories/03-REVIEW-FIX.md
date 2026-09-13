---
phase: 03-categories
fixed_at: 2026-09-13T00:00:00Z
review_path: D:/FinancialControl/.planning/phases/03-categories/03-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 03: Code Review Fix Report

**Fixed at:** 2026-09-13
**Source review:** D:/FinancialControl/.planning/phases/03-categories/03-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (critical_warning scope: CR-01, WR-01, WR-02, WR-03)
- Fixed: 4
- Skipped: 0

**Note on this run:** A prior run of this fix task was interrupted by a rate limit after
committing CR-01, WR-01, and WR-02 directly to `master` (those commits — `e18ee6a`, `8fabff1`,
`5979c31` — predate this run and were verified present in the working tree before this run
started). This run verified those three fixes are genuinely applied in source, then applied and
committed the one remaining finding, WR-03.

**Verification environment:** This run operated inside an isolated git worktree
(`.claude/worktrees/rf-03-*`, branch `gsd-reviewfix/03-*`) per the fixer's transactional-worktree
protocol. The worktree has no `node_modules` by design, so Tier 2 syntax/type checks (`tsc
--noEmit`) were not available there — verification for WR-03 relied on Tier 1 (re-read modified
file, confirm fix text present and surrounding code intact) per the Tier 3 fallback rule. The
prior run's three commits (CR-01, WR-01, WR-02) were independently re-verified by reading the
current file contents directly in the main checkout before this run began. No gate/test run
occurred in the main checkout as part of this fix session.

## Fixed Issues

### CR-01: `update()` doesn't catch the unique-violation that `create()` explicitly handles — PATCH-to-duplicate-name 500s instead of 409

**Files modified:** `src/categories/categories.service.ts`
**Commit:** `e18ee6a` (from prior interrupted run, verified present on `master`)
**Applied fix:** Extracted a shared private `saveOrThrowConflict()` helper used by both `create()`
and `update()`, translating a Postgres `23505` unique-violation into a `ConflictException` (409)
for both write paths instead of only `create()`.

### WR-01: No `:id` format validation — a malformed id returns 500, not 404

**Files modified:** `src/categories/categories.controller.ts`
**Commit:** `8fabff1` (from prior interrupted run, verified present on `master`)
**Applied fix:** Added `@Param('id', ParseUUIDPipe) id: string` on `findOne`, `update`, and
`remove` routes in `CategoriesController`, so malformed UUIDs are rejected with a clean `400`
before reaching the service/repository.

### WR-02: `name` is not trimmed and whitespace-only names are not rejected

**Files modified:** `src/categories/dto/create-category.dto.ts`, `src/categories/dto/update-category.dto.ts`
**Commit:** `5979c31` (from prior interrupted run, verified present on `master`)
**Applied fix:** Added `@Transform(({ value }) => typeof value === 'string' ? value.trim() : value)`
ahead of `@IsString()`/`@MinLength(1)`/`@MaxLength(100)` in both DTOs, so whitespace-only names are
rejected and leading/trailing whitespace can no longer be used to defeat the D-03
per-user (name, type) uniqueness index.

### WR-03: `isUniqueViolation()` matches on error code alone, not the specific constraint

**Files modified:** `src/categories/categories.service.ts`
**Commit:** `6baf01a`
**Applied fix:** Updated `isUniqueViolation()` to additionally check
`(error as { constraint?: string }).constraint === 'UQ_categories_user_id_name_type'`, alongside
the existing `code === '23505'` check, matching the fix suggested in the review. Confirmed the
constraint name against the migration (`src/database/migrations/1789400000000-CreateCategories.ts`)
before applying, to ensure the literal string matches exactly. Verified via Tier 1 (re-read) only —
Tier 2 (`tsc --noEmit`) was unavailable in the isolated worktree used for this fix (no
`node_modules`); no logic-check concerns apply since this is a straightforward equality-check
addition mirroring the existing code style.

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-09-13_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
