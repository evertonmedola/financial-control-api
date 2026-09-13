---
phase: 03-categories
plan: 02
subsystem: categories
tags: [nestjs, typeorm, postgres, idor, soft-delete, crud]

requires:
  - phase: 03-categories
    provides: Category entity + CategoryType enum, categories table migration (D-03 partial unique index), CategoriesService.create(), POST /categories, CategoriesModule exported (03-01-PLAN.md)
  - phase: 02-accounts
    provides: domain module structure precedent (entity/dto/service/controller/module), soft-delete + userId-scoping conventions, cross-tenant e2e suite structure
provides:
  - UpdateCategoryDto (name-only, type permanently locked per D-02)
  - CategoriesService.findAll/findOne/update/remove — userId+deletedAt-scoped queries, 404-not-403 ownership check
  - GET /categories, GET /categories/:id, PATCH /categories/:id, DELETE /categories/:id routes
  - test/categories-cross-tenant.e2e-spec.ts — dedicated two-user IDOR regression suite for every Categories route
affects: [04-transactions, 05-budgets]

actuals:
  tokens: 5711
  tasks: 2
  commits: 2
  plan_head_before: 6ebcb15c7c81d75a74849294914a6371b5b0c79d

tech-stack:
  added: []
  patterns:
    - "Full CRUD service/controller shape copied 1:1 from AccountsService/AccountsController (findAll ordered createdAt ASC, findOne 404-not-403, update via findOne-then-Object.assign-then-save, remove via findOne-then-deletedAt-then-save) — no new pattern introduced, this plan closes out the same shape Categories' create-slice already started"

key-files:
  created:
    - src/categories/dto/update-category.dto.ts
    - test/categories-cross-tenant.e2e-spec.ts
  modified:
    - src/categories/categories.service.ts
    - src/categories/categories.controller.ts
    - src/categories/categories.service.spec.ts
    - test/categories.e2e-spec.ts

key-decisions:
  - "UpdateCategoryDto is name-only, no type field — D-02 (type immutability) enforced entirely via DTO-layer omission + global forbidNonWhitelisted:true, no manual guard code, mirroring UpdateAccountDto exactly"
  - "DELETE /categories/:id returns 200 + {} (not 204), mirroring AccountsController.remove()'s established empty-envelope convention"

patterns-established: []

requirements-completed: [CAT-02]

coverage:
  - id: D1
    description: "A user can list, view, and update (name only) their own categories — every cross-tenant attempt (list/get/update/delete) against another user's category returns 404, never 200 or 403"
    requirement: "CAT-02"
    verification:
      - kind: e2e
        ref: "test/categories-cross-tenant.e2e-spec.ts#GET /categories/:id with B's category id and A's token returns 404, never 403/200"
        status: pass
      - kind: e2e
        ref: "test/categories-cross-tenant.e2e-spec.ts#PATCH /categories/:id with B's category id and A's token returns 404, never 403/200"
        status: pass
      - kind: e2e
        ref: "test/categories-cross-tenant.e2e-spec.ts#DELETE /categories/:id with B's category id and A's token returns 404, never 403/200"
        status: pass
      - kind: e2e
        ref: "test/categories-cross-tenant.e2e-spec.ts#GET /categories for A never includes any of B's category ids"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /categories on a fresh user with zero categories returns 200 with an empty array (edge-probe: empty)"
    requirement: "CAT-02"
    verification:
      - kind: e2e
        ref: "test/categories.e2e-spec.ts#list/view/update/delete > GET /categories on a fresh user with zero categories returns 200 with an empty array"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /categories returns categories ordered by createdAt ascending, stable across repeated calls with no intervening writes (edge-probe: ordering)"
    requirement: "CAT-02"
    verification:
      - kind: e2e
        ref: "test/categories.e2e-spec.ts#list/view/update/delete > GET /categories returns categories ordered by createdAt ascending"
        status: pass
    human_judgment: false
  - id: D4
    description: "PATCH /categories/:id rejects any request body containing `type` with 400 — type cannot be changed after creation (D-02, Prohibition P2)"
    requirement: "CAT-02"
    verification:
      - kind: e2e
        ref: "test/categories.e2e-spec.ts#list/view/update/delete > PATCH /categories/:id rejects a body containing `type` with 400"
        status: pass
    human_judgment: false
  - id: D5
    description: "A PATCH that changes only `name` succeeds 200 and leaves `type` unchanged"
    requirement: "CAT-02"
    verification:
      - kind: e2e
        ref: "test/categories.e2e-spec.ts#list/view/update/delete > PATCH /categories/:id with only `name` succeeds 200 and leaves `type` unchanged"
        status: pass
    human_judgment: false
  - id: D6
    description: "DELETE /categories/:id soft-deletes (sets deletedAt), excludes the category from subsequent GET /categories and GET /categories/:id (404), and never removes the row (D-01, Prohibition P3)"
    requirement: "CAT-02"
    verification:
      - kind: e2e
        ref: "test/categories.e2e-spec.ts#list/view/update/delete > DELETE /categories/:id soft-deletes"
        status: pass
      - kind: unit
        ref: "src/categories/categories.service.spec.ts#CategoriesService > remove > sets deletedAt and calls .save() — never a hard-delete repository method (D-01)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Calling DELETE /categories/:id a second time on an already-deleted category returns 404, not a second 200 (edge-probe: idempotency)"
    requirement: "CAT-02"
    verification:
      - kind: e2e
        ref: "test/categories.e2e-spec.ts#list/view/update/delete > a second DELETE /categories/:id on an already-deleted category returns 404"
        status: pass
    human_judgment: false
  - id: D8
    description: "Two concurrent DELETE /categories/:id calls on the same category never both return 500 — each resolves 200 or 404, and the final state is soft-deleted (edge-probe: concurrency)"
    requirement: "CAT-02"
    verification:
      - kind: e2e
        ref: "test/categories.e2e-spec.ts#list/view/update/delete > two concurrent DELETE /categories/:id calls on the same category"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-09-13
status: complete
---

# Phase 3 Plan 2: Categories Full CRUD Summary

**Full category CRUD (list/view/update-name/soft-delete) with `type` permanently locked after creation and a dedicated two-user cross-tenant regression suite proving 404-not-403 on every route.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-13T17:41:00Z (approx.)
- **Completed:** 2026-09-13T17:52:32Z
- **Tasks:** 2 completed
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- `UpdateCategoryDto` (name-only, `type` intentionally omitted — D-02) and the remaining four `CategoriesService`/`CategoriesController` CRUD methods/routes, all `userId`+`deletedAt`-scoped and 404-not-403 on ownership mismatch
- `test/categories-cross-tenant.e2e-spec.ts` — dedicated two-user IDOR suite covering GET/PATCH/DELETE `/categories/:id` and list-leak isolation, mirroring `test/accounts-cross-tenant.e2e-spec.ts` exactly
- `test/categories.e2e-spec.ts` extended with 7 new tests covering every edge-probe from the plan's `must_haves.truths`: empty list, stable createdAt-ascending ordering, type-lock rejection, name-only update, soft-delete exclusion, delete-twice idempotency, and concurrent-delete safety

## Task Commits

Each task was committed atomically:

1. **Task 1: List/view/update/delete — soft delete (D-01), type-lock (D-02)** - `8d3662a` (feat)
2. **Task 2: Cross-tenant isolation suite + full CRUD e2e coverage** - `2dd5b36` (test)

**Plan metadata:** committed alongside this summary (sequential mode — STATE.md/ROADMAP.md/REQUIREMENTS.md included in the final metadata commit).

## Files Created/Modified
- `src/categories/dto/update-category.dto.ts` - `UpdateCategoryDto` (name only, `type` intentionally omitted)
- `src/categories/categories.service.ts` - added `findAll()`, `findOne()`, `update()`, `remove()`
- `src/categories/categories.controller.ts` - added `GET /categories`, `GET /categories/:id`, `PATCH /categories/:id`, `DELETE /categories/:id`
- `src/categories/categories.service.spec.ts` - added `findOne` (404 + happy path) and `remove` (soft-delete, no hard-delete) unit tests
- `test/categories-cross-tenant.e2e-spec.ts` - new: 4 cross-tenant IDOR e2e tests
- `test/categories.e2e-spec.ts` - added `list/view/update/delete` describe block: 7 new e2e tests

## Decisions Made
- `UpdateCategoryDto` is name-only, no `type` field — D-02 (type immutability) enforced entirely via DTO-layer omission plus the existing global `forbidNonWhitelisted:true`, no manual guard code needed, mirroring `UpdateAccountDto` exactly.
- `DELETE /categories/:id` returns 200 + `{}` (not 204), mirroring `AccountsController.remove()`'s already-established empty-envelope convention for response-shape consistency across domain modules.

## Deviations from Plan

**1. [Rule 2 - Missing critical functionality] REQUIREMENTS.md traceability was stale for CAT-01**
- **Found during:** requirements-tracking step (after Task 2)
- **Issue:** `03-01-PLAN.md`'s worktree-mode execution recorded `requirements-completed: [CAT-01]` in `03-01-SUMMARY.md`, but per that summary's own note ("orchestrator owns those centrally after merge") the central `REQUIREMENTS.md` checkbox/traceability update never ran — `CAT-01` was still showing `Pending` in `.planning/REQUIREMENTS.md` even though it fully shipped in Wave 1.
- **Fix:** Ran `requirements.mark-complete CAT-01` alongside this plan's own `CAT-02` update, so `.planning/REQUIREMENTS.md` accurately reflects both requirements this phase has actually closed.
- **Files modified:** `.planning/REQUIREMENTS.md`
- **Verification:** `requirements.mark-complete` reported `write_set_complete: true` for both CAT-01 and CAT-02 (checkbox + traceability surfaces).
- **Committed in:** final metadata commit for this plan (docs commit).

---

**Total deviations:** 1 auto-fixed (1 Rule 2 — missing critical functionality, stale requirements tracking from the prior wave).
**Impact on plan:** None on this plan's own scope or correctness — purely a documentation-accuracy fix for a gap left by the prior plan's worktree-merge handoff.

## Issues Encountered

None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness

CAT-02 is closed. `Category`'s full CRUD surface (create + list/view/update/delete) is complete and cross-tenant-hardened, matching Phase 2's Accounts precedent exactly. `CategoriesService` remains exported from `CategoriesModule` for Phase 4's `TransactionsModule` and Phase 5's `BudgetsModule` to inject directly — no schema or service-signature changes were needed in this plan.

No blockers for Phase 4.

### Security review (skill `security-review` checklist, applied manually — no `origin` remote for `git diff`, same gap noted in prior phases)

✅ Aplicado: DTO validation on `PATCH /categories/:id` (`class-validator`, `forbidNonWhitelisted` rejects `type`); parameterized queries throughout (TypeORM repository, no raw SQL in this plan); every list/get/update/delete scoped by `(id, userId, deletedAt IS NULL)` — verified by the dedicated cross-tenant suite; error responses are generic `NotFoundException` (no stack trace, table name, or dependency version leaked); no new secrets, endpoints exempt from auth (controller-level `JwtAuthGuard` already covers all four new routes).
⚠️ Atenção: none new this plan — rate limiting remains scoped to `/auth/login` and `/auth/register` only, per D-06 (unchanged, not in this plan's scope).

## Self-Check: PASSED

All 6 created/modified files verified present on disk with expected content. Both commits (`8d3662a`, `2dd5b36`) verified present in `git log`.

---
*Phase: 03-categories*
*Completed: 2026-09-13*
