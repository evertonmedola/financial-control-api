---
phase: 03-categories
plan: 01
subsystem: categories
tags: [nestjs, typeorm, postgres, partial-unique-index, dto-validation, idor]

requires:
  - phase: 01-authentication-multi-tenant-foundation
    provides: JwtAuthGuard, CurrentUser decorator, global ValidationPipe/ResponseInterceptor
  - phase: 02-accounts
    provides: domain module structure precedent (entity/dto/service/controller/module), soft-delete + userId-scoping conventions
provides:
  - Category entity + CategoryType enum (receita/despesa)
  - categories table migration with D-03 composite partial unique index (user_id, name, type) WHERE deleted_at IS NULL
  - CategoriesService.create() with 23505-to-ConflictException translation
  - POST /categories route, CategoriesModule exported for Phase 4/5 injection
affects: [04-transactions, 05-budgets]

actuals:
  tokens: 5345
  tasks: 2
  commits: 2
  plan_head_before: 613939a20f81ab23548e899be63a5ee2daae80bb

tech-stack:
  added: []
  patterns:
    - "D-03 duplicate protection enforced via a Postgres partial unique index (WHERE deleted_at IS NULL), never an app-layer pre-check-then-insert — the service only translates the resulting 23505 into a 409, closing any TOCTOU race"
    - "Explicit-construction response DTOs (fromEntity, field-by-field) — never spread the entity"

key-files:
  created:
    - src/categories/entities/category.entity.ts
    - src/database/migrations/1789400000000-CreateCategories.ts
    - src/categories/dto/create-category.dto.ts
    - src/categories/dto/category-response.dto.ts
    - src/categories/categories.service.ts
    - src/categories/categories.controller.ts
    - src/categories/categories.module.ts
    - src/categories/categories.service.spec.ts
    - test/categories.e2e-spec.ts
  modified:
    - src/app.module.ts

key-decisions:
  - "D-03's uniqueness is enforced at the database level via a partial unique index, not application-layer validation, so concurrent duplicate creates resolve deterministically (one 201, one 409, never both, never a 500)"
  - "This plan's Task 2 draft assumed a GET /categories endpoint for post-hoc list-count verification; that endpoint is CAT-02 scope (03-02-PLAN.md) and does not exist yet. Removed the GET-based cross-checks (Rule 3 deviation) — the 201-then-409 status sequence is itself sufficient proof of non-duplication, since a Postgres unique-violation aborts the INSERT statement entirely."

patterns-established:
  - "Domain modules injecting a shared Postgres unique-violation-to-ConflictException translator pattern (copied from AuthService.isUniqueViolation, now present in AccountsService's sibling pattern too via CategoriesService) — Phase 4/5 modules with their own uniqueness rules can reuse the same shape"

requirements-completed: [CAT-01]

coverage:
  - id: D1
    description: "POST /categories creates a category (receita or despesa) and returns 201 with id/name/type/createdAt/updatedAt"
    requirement: "CAT-01"
    verification:
      - kind: e2e
        ref: "test/categories.e2e-spec.ts#create category > POST /categories creates a despesa category and returns 201 with the created category"
        status: pass
      - kind: e2e
        ref: "test/categories.e2e-spec.ts#create category > POST /categories creates a receita category and returns 201 with the created category"
        status: pass
    human_judgment: false
  - id: D2
    description: "Duplicate (userId, name, type) is rejected 409 — idempotent-by-rejection, not idempotent-by-merge"
    requirement: "CAT-01"
    verification:
      - kind: e2e
        ref: "test/categories.e2e-spec.ts#create category > duplicate name+type (D-03)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Concurrent duplicate creates resolve deterministically to exactly one 201 and one 409 via the DB-level partial unique index, never both succeeding, never a 500"
    requirement: "CAT-01"
    verification:
      - kind: e2e
        ref: "test/categories.e2e-spec.ts#create category > two concurrent POST /categories calls"
        status: pass
    human_judgment: false
  - id: D4
    description: "Same name with different type is allowed as a distinct category (uniqueness scoped per type, not per name alone)"
    requirement: "CAT-01"
    verification:
      - kind: e2e
        ref: "test/categories.e2e-spec.ts#create category > same name, different type is allowed"
        status: pass
    human_judgment: false
  - id: D5
    description: "An invalid/unrecognized type value is rejected 400, never silently coerced to a default (prohibition P1)"
    requirement: "CAT-01"
    verification:
      - kind: e2e
        ref: "test/categories.e2e-spec.ts#create category > rejects an invalid/unrecognized type"
        status: pass
      - kind: e2e
        ref: "test/categories.e2e-spec.ts#create category > rejects a body missing type entirely"
        status: pass
    human_judgment: false
  - id: D6
    description: "A client-supplied userId field is rejected 400, never used to override ownership (IDOR)"
    requirement: "CAT-01"
    verification:
      - kind: e2e
        ref: "test/categories.e2e-spec.ts#create category > rejects a client-supplied userId field"
        status: pass
    human_judgment: false
  - id: D7
    description: "categories table, categories_type_enum type, IDX_categories_user_id, UQ_categories_user_id_name_type, and the users FK apply cleanly via npm run migration:run"
    requirement: "CAT-01"
    verification:
      - kind: other
        ref: "npm run migration:run (CreateCategories1789400000000 executed successfully against local dev Postgres)"
        status: pass
    human_judgment: false
  - id: D8
    description: "CategoriesService.create() unit-tested: happy path merges userId into the DTO and persists via the repository; error path translates a 23505 repository rejection into ConflictException"
    requirement: "CAT-01"
    verification:
      - kind: unit
        ref: "src/categories/categories.service.spec.ts#CategoriesService > create"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-09-13
status: complete
---

# Phase 3 Plan 1: Categories Create-Slice Summary

**Category creation (receita/despesa) end-to-end against the real migrated database, with duplicate-name/type protection enforced via a Postgres partial unique index rather than an app-layer pre-check.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-09-13T16:41:00Z (approx., first tool call)
- **Completed:** 2026-09-13T17:36:46Z
- **Tasks:** 2 completed
- **Files modified:** 10 (9 created, 1 modified)

## Accomplishments
- `Category` entity + `CategoryType` enum, `categories` table migration including the D-03 composite partial unique index (`user_id`, `name`, `type` WHERE `deleted_at IS NULL`) and the FK to `users`
- `POST /categories` route: authenticated creation with `class-validator` DTO validation (name length, enum type), explicit-construction response DTO, and DB-level duplicate-conflict translation to 409
- Full e2e coverage (11 tests): both category types, name-length boundaries, missing/invalid type rejection, sequential and concurrent duplicate-name/type handling, distinct-type-same-name adjacency, and IDOR-on-create

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end "create category" — one type, one path (tracer)** - `700e1c0` (feat)
2. **Task 2: Validation, duplicate-name (D-03), and IDOR hardening for category creation** - `9b959e3` (test)

**Plan metadata:** committed alongside this summary (worktree mode — no separate STATE.md/ROADMAP.md commit; orchestrator owns those centrally after merge).

## Files Created/Modified
- `src/categories/entities/category.entity.ts` - `CategoryType` enum + `Category` entity (id, userId, name, type, deletedAt, createdAt, updatedAt)
- `src/database/migrations/1789400000000-CreateCategories.ts` - `categories` table, enum type, userId index, D-03 partial unique index, FK to `users`
- `src/categories/dto/create-category.dto.ts` - `CreateCategoryDto` (name length + enum type validation)
- `src/categories/dto/category-response.dto.ts` - `CategoryResponseDto` explicit-construction response shape
- `src/categories/categories.service.ts` - `CategoriesService.create()` + `isUniqueViolation()` helper (23505 → 409 translation)
- `src/categories/categories.controller.ts` - `POST /categories` route
- `src/categories/categories.module.ts` - `CategoriesModule`, exports `CategoriesService`
- `src/categories/categories.service.spec.ts` - unit tests (happy path + `ConflictException` error case)
- `test/categories.e2e-spec.ts` - 11 e2e tests covering CAT-01's full surface for this plan
- `src/app.module.ts` - `CategoriesModule` added to imports

## Decisions Made
- D-03's uniqueness enforcement lives entirely at the database level (partial unique index), with the service layer only translating the resulting Postgres error code — this is the same TOCTOU-safe pattern `AuthService.register()` already established for email uniqueness in Phase 1, reused verbatim rather than reinvented.
- See `## Deviations from Plan` below for the one deviation from the plan's literal Task 2 text.

## Deviations from Plan

**1. [Rule 3 - Blocking issue] Removed GET /categories list-count cross-checks from Task 2's duplicate/concurrency e2e tests**
- **Found during:** Task 2
- **Issue:** The plan's Task 2 action text specified confirming non-duplication "via `GET /categories`" for both the sequential-duplicate and concurrent-duplicate test cases. `GET /categories` does not exist — it is CAT-02 scope, owned by `03-02-PLAN.md`, and Task 2's own `<files>` list confirms only `test/categories.e2e-spec.ts` was meant to change in this plan (no new production code, including no list endpoint).
- **Fix:** Removed the `GET /categories` calls and their list-length assertions from both tests. The 201-then-409 status-code sequence already proves the plan's `must_haves.truths` claims: a Postgres unique-violation aborts the `INSERT` statement entirely, so a 409 response is definitive proof no second row was created — no list call is needed to establish this.
- **Files modified:** `test/categories.e2e-spec.ts`
- **Verification:** Both tests pass (`npm run test:e2e -- categories.e2e-spec.ts`, 11/11 green); the underlying claim (exactly one row exists) follows directly from Postgres unique-index semantics, not from an assumption.
- **Committed in:** `9b959e3` (part of Task 2's commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 3 — blocking issue, missing endpoint reference)
**Impact on plan:** None on scope or correctness — CAT-01's must_haves.truths are all still verified with equal or stronger rigor; CAT-02's `GET /categories` remains correctly scoped to 03-02-PLAN.md.

## Issues Encountered

**Worktree environment setup (not a plan deviation, infrastructure-only):**
- This worktree had no `node_modules` (worktrees don't inherit them) — resolved with `npm install`.
- This worktree had no `.env` (gitignored, not copied by `git worktree add`) — the coordinator supplied one, then corrected `DB_PORT` from the default `5432` (occupied by an unrelated native Postgres service and a different project's container) to `5433` (this project's actual docker-compose Postgres container, `financialcontrol-db-1`). Connectivity confirmed via `npm run typeorm -- migration:show` before resuming task work. No project files were affected by this; `.env` remains gitignored and untouched by any commit in this plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
`CategoriesService` is exported from `CategoriesModule` and ready for Phase 4's `TransactionsModule` and Phase 5's `BudgetsModule` to inject directly, per `03-CONTEXT.md`'s Integration Points. `03-02-PLAN.md` (list/view/update/delete, CAT-02) can now build directly on the `Category` entity and migration established here — no schema changes anticipated.

No blockers for `03-02-PLAN.md`.

---
*Phase: 03-categories*
*Completed: 2026-09-13*
