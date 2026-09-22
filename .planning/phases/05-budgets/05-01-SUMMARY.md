---
phase: 05-budgets
plan: 01
subsystem: budgets
tags: [nestjs, typeorm, budgets, aggregation, decimal-math, category-spend]

requires:
  - phase: 04-transactions-transfers
    provides: TransactionsService (ownership-chain pattern, TXN-04 transfer-exclusion rule), decimal.util.ts's BigInt-cents arithmetic, Transaction entity shape (type/amount/date/categoryId)
  - phase: 03-categories
    provides: CategoriesService (findOne ownership check), CategoryType enum (DESPESA/RECEITA), soft-delete + partial-unique-index pattern
provides:
  - Budget entity + migration (standing limit per category, D-01, no month/year columns)
  - POST/GET/GET:id/PATCH/DELETE /budgets — full CRUD with D-02 editable limit, D-03 DESPESA-only creation, D-07 soft-delete + category-reuse
  - GET /budgets computed status (limit/spent/remaining/overBudget) for the current calendar month, D-06 no per-category 404
  - TransactionsService.sumByCategoryExcludingTransfers — first grouped read-side SUM(...)GROUP BY aggregation in this codebase, reusing TXN-04's transfer exclusion in a read path
  - decimal.util.ts additions: subtractDecimalStrings, isGreaterThanDecimalString (exact BigInt-cents remaining/overBudget math)
affects: [06-reports]

actuals:
  tokens: 18579
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Grouped read-side aggregation via TypeORM QueryBuilder (SELECT categoryId, SUM(amount) ... GROUP BY categoryId), guarded against TypeORM's empty-array IN() throw — first precedent in this codebase for a non-CRUD read query"
    - "Computed-aggregate DTO with a static factory (BudgetStatusDto.build) instead of fromEntity, since there is no single entity backing the response shape"
    - "Cross-module read-only composition: BudgetsModule imports CategoriesModule + TransactionsModule and calls their exported services, never registers a second Transaction repository"

key-files:
  created:
    - src/budgets/entities/budget.entity.ts
    - src/database/migrations/1789600000000-CreateBudgets.ts
    - src/budgets/dto/create-budget.dto.ts
    - src/budgets/dto/update-budget.dto.ts
    - src/budgets/dto/budget-response.dto.ts
    - src/budgets/dto/budget-status.dto.ts
    - src/budgets/budgets.service.ts
    - src/budgets/budgets.service.spec.ts
    - src/budgets/budgets.controller.ts
    - src/budgets/budgets.module.ts
    - test/budgets.e2e-spec.ts
  modified:
    - src/common/decimal.util.ts
    - src/common/decimal.util.spec.ts
    - src/transactions/transactions.service.ts
    - src/transactions/transactions.service.spec.ts
    - src/app.module.ts

key-decisions:
  - "Task 1 (tracer) and Task 2 (CRUD hardening) were implemented together in a single pass for budgets.service.ts/budgets.controller.ts, then the code was deliberately split back into two commits (trimming findOne/update/remove out of the Task 1 commit, restoring them for Task 2) so the per-task commit history matches the plan's task boundaries — no functional difference, just commit hygiene."
  - "Fixed a test-authoring bug found while running Task 2's IDOR test: the literal '11111111-1111-1111-1111-111111111111' used elsewhere in the codebase for userId-spoofing tests is NOT a syntactically valid UUID (wrong variant nibble) — class-validator's @IsUUID() correctly rejects it with 400 before reaching the service. Replaced with a proper v4 UUID ('ab2e3980-297d-4a86-bea9-4acb2e4aec4b') for the 'nonexistent categoryId' 404 test, which specifically needs to pass format validation and only fail ownership lookup."
  - "Docker Desktop was not running at session start (required for the [BLOCKING] npm run migration:run step against the local dev Postgres) — started it programmatically and waited for the daemon before proceeding, per the checkpoint-automation-first principle (no manual step surfaced to the user)."

requirements-completed: [BUD-01, BUD-02, BUD-03]

coverage:
  - id: D1
    description: "POST /budgets sets a standing spending limit for a user's own DESPESA category; limit round-trips exactly as a decimal string (BUD-01)"
    requirement: "BUD-01"
    verification:
      - kind: e2e
        ref: "test/budgets.e2e-spec.ts > create budget > POST /budgets sets a limit..."
        status: pass
      - kind: unit
        ref: "src/budgets/budgets.service.spec.ts > create > happy path"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /budgets returns each budgeted category's limit/spent/remaining/overBudget for the current calendar month, with spent correctly excluding TRANSFER rows (BUD-02, D-08)"
    requirement: "BUD-02"
    verification:
      - kind: e2e
        ref: "test/budgets.e2e-spec.ts > create budget (tracer: real expense counted, real transfer excluded)"
        status: pass
      - kind: unit
        ref: "src/transactions/transactions.service.spec.ts > sumByCategoryExcludingTransfers"
        status: pass
    human_judgment: false
  - id: D3
    description: "A category with zero matching transactions in the current month shows spent='0.00' and remaining=limit, never a crash/NaN/null (Pitfall 4 divide-by-zero edge case)"
    verification:
      - kind: e2e
        ref: "test/budgets.e2e-spec.ts > create budget (zero-spend status assertion)"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /budgets never 404s per-category — only lists categories that actually have a budget (D-06)"
    requirement: "BUD-02"
    verification:
      - kind: unit
        ref: "src/budgets/budgets.service.spec.ts > findAllWithStatus > empty-list short-circuit"
        status: pass
    human_judgment: false
  - id: D5
    description: "PATCH /budgets/:id updates limit (D-02); DELETE /budgets/:id soft-deletes, never a hard row delete (D-07)"
    verification:
      - kind: e2e
        ref: "test/budgets.e2e-spec.ts > view/edit/delete budget > PATCH updates limit / DELETE soft-deletes and frees category"
        status: pass
      - kind: unit
        ref: "src/budgets/budgets.service.spec.ts > update / remove"
        status: pass
    human_judgment: false
  - id: D6
    description: "Creating a budget for a RECEITA category is rejected with 400, never silently accepted (D-03)"
    requirement: "BUD-01"
    verification:
      - kind: e2e
        ref: "test/budgets.e2e-spec.ts > view/edit/delete budget > rejects a budget for a RECEITA category with 400"
        status: pass
      - kind: unit
        ref: "src/budgets/budgets.service.spec.ts > create > throws BadRequestException when RECEITA"
        status: pass
    human_judgment: false
  - id: D7
    description: "An over-budget category's GET /budgets entry shows overBudget:true and a negative, un-clamped remaining (BUD-03)"
    requirement: "BUD-03"
    verification:
      - kind: e2e
        ref: "test/budgets.e2e-spec.ts > view/edit/delete budget > over-budget category shows overBudget:true..."
        status: pass
      - kind: unit
        ref: "src/common/decimal.util.spec.ts > subtractDecimalStrings / isGreaterThanDecimalString"
        status: pass
    human_judgment: false
  - id: D8
    description: "A budget created mid-month still reflects transactions from earlier in the same calendar month in spent (D-05)"
    verification:
      - kind: e2e
        ref: "test/budgets.e2e-spec.ts > view/edit/delete budget > mid-month creation reflects earlier transaction"
        status: pass
    human_judgment: false
  - id: D9
    description: "Two concurrent POST /budgets for the same category resolve to exactly one 201 and one 409, enforced by the DB-level partial unique index (D-07)"
    verification:
      - kind: e2e
        ref: "test/budgets.e2e-spec.ts > view/edit/delete budget > duplicate budget concurrency"
        status: pass
    human_judgment: false
  - id: D10
    description: "Ownership-chain IDOR protection on categoryId (create) and on every :id route; malformed :id returns 400 not 500; client-supplied userId/categoryId overrides rejected via forbidNonWhitelisted"
    verification:
      - kind: e2e
        ref: "test/budgets.e2e-spec.ts > view/edit/delete budget > IDOR / malformed-id / client-supplied-field cases"
        status: pass
    human_judgment: false

duration: ~45min
completed: 2026-09-22
status: complete
---

# Phase 5 Plan 1: Budgets CRUD + Spend Aggregation Summary

**Standing per-category spending limits with current-month consumed/remaining, backed by this codebase's first grouped read-side `SUM(...)GROUP BY` aggregation that correctly excludes transfer transactions.**

## Performance
- **Duration:** ~45min
- **Started:** 2026-09-22 (session start)
- **Completed:** 2026-09-22T18:53:29-03:00
- **Tasks:** 2 completed
- **Files modified:** 16 (11 created, 5 modified)

## Accomplishments
- Delivered the full Budgets vertical slice end-to-end against the real migrated database: entity, migration (with FKs, userId index, and a partial unique index enforcing "one active budget per category"), decimal-safe DTOs, cross-service ownership + DESPESA-type validation, and the computed limit/spent/remaining/overBudget read shape.
- Implemented `TransactionsService.sumByCategoryExcludingTransfers` — the first grouped aggregation query in the project — proving in a real e2e test that a `TRANSFER` transaction is excluded from a category's spend while a real expense is correctly counted, reusing Phase 4's TXN-04 exclusion rule in a read path for the first time.
- Full CRUD hardening: RECEITA-category rejection (400), concurrent duplicate-budget race resolved to exactly one 201/409 pair via the DB-level unique index, over-budget signal with un-clamped negative `remaining`, mid-month budget creation correctly backfilling the whole calendar month's spend, PATCH `limit`-only editing with `categoryId` locked, and soft-delete freeing the category for reuse.

## Task Commits
1. **Task 1: Tracer — set a budget, see consumed/remaining, transfers excluded** - `1d758b4` (feat)
2. **Task 2: Full CRUD, DESPESA rejection, over-budget signal, mid-month, duplicate hardening** - `e427f8e` (feat)
**Plan metadata:** commit pending (this SUMMARY + STATE/ROADMAP/REQUIREMENTS)

## Files Created/Modified
- `src/budgets/entities/budget.entity.ts` - Budget entity: id, userId, categoryId, limit (decimal string), deletedAt, createdAt, updatedAt
- `src/database/migrations/1789600000000-CreateBudgets.ts` - budgets table DDL, FKs, IDX_budgets_user_id, UQ_budgets_user_id_category_id partial unique index
- `src/budgets/dto/create-budget.dto.ts` / `update-budget.dto.ts` - categoryId+limit validation (create); limit-only, categoryId locked (update, D-02)
- `src/budgets/dto/budget-response.dto.ts` - raw-entity CRUD response shape
- `src/budgets/dto/budget-status.dto.ts` - computed limit/spent/remaining/overBudget aggregate shape with static `build()` factory
- `src/budgets/budgets.service.ts` - create/findOne/update/remove/findAllWithStatus, calendar-month bounds computation, Postgres unique-violation-to-409 translation
- `src/budgets/budgets.controller.ts` - POST/GET/GET:id/PATCH/DELETE /budgets
- `src/budgets/budgets.module.ts` - imports CategoriesModule + TransactionsModule (read-only), exports BudgetsService
- `src/transactions/transactions.service.ts` - added `sumByCategoryExcludingTransfers` (grouped aggregation, empty-array guard)
- `src/common/decimal.util.ts` - added `subtractDecimalStrings`/`isGreaterThanDecimalString`
- `src/app.module.ts` - registered BudgetsModule
- `src/budgets/budgets.service.spec.ts`, `src/transactions/transactions.service.spec.ts`, `src/common/decimal.util.spec.ts`, `test/budgets.e2e-spec.ts` - unit/e2e coverage

## Decisions Made
- Implemented Task 1 and Task 2's service/controller code together, then deliberately split the working tree back into two commits (Task 1: create + findAllWithStatus + POST/GET only; Task 2: findOne/update/remove + GET:id/PATCH/DELETE) so per-task commit history matches the plan's task boundaries exactly, with no functional difference in the final code.
- Started Docker Desktop programmatically (was not running) rather than surfacing a manual step to the user, since the daemon start is a fully automatable action — no checkpoint needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test bug] Fixed an invalid-UUID literal in the IDOR "nonexistent categoryId" test**
- **Found during:** Task 2, running the full e2e suite
- **Issue:** The test used the literal `'11111111-1111-1111-1111-111111111111'`, which is not a syntactically valid UUID (the variant nibble at the 17th hex position is `1`, not one of `8/9/a/b` as RFC 4122 requires). `class-validator`'s `@IsUUID()` correctly rejects it at the DTO layer with 400, before the request ever reaches `BudgetsService.create`'s ownership-chain check — so the test was asserting the wrong failure mode (expected 404 from a missing category, got 400 from format validation).
- **Fix:** Replaced with a properly-formatted, randomly-generated v4 UUID (`'ab2e3980-297d-4a86-bea9-4acb2e4aec4b'`) that passes format validation and is guaranteed not to exist in the categories table, so the test now correctly exercises the ownership-chain 404 path it was written to prove.
- **Files modified:** `test/budgets.e2e-spec.ts`
- **Verification:** Re-ran the full `budgets.e2e-spec.ts` suite (11/11 passing) and the full project e2e suite (141/141 passing) after the fix.
- **Committed in:** `e427f8e`

---
**Total deviations:** 1 auto-fixed (1 Rule 1 test-authoring bug). **Impact on plan:** None on production code — the fix corrected a test's own input fixture; the ownership-chain 404 behavior it verifies was already correct in `BudgetsService.create`.

## Issues Encountered
- Docker Desktop was not running at session start, which blocked the plan's `[BLOCKING] npm run migration:run` step. Started Docker Desktop programmatically and waited for the daemon (~10s) before running the migration — no user action was required.

## User Setup Required
None - no external service configuration required. The `budgets` table migration was applied directly against the local dev Postgres container already provisioned by `docker-compose.yml`.

## Next Phase Readiness
- `BudgetsService` is exported and ready for Phase 6 (Reports) to consume read-only, per `ARCHITECTURE.md`'s dependency direction — no other module imports `BudgetsModule` back.
- The `sumByCategoryExcludingTransfers` aggregation pattern (grouped `QueryBuilder`, empty-array guard, transfer exclusion) is now the established precedent for any future category-spend aggregation Phase 6 needs to add (e.g. broader date-range or multi-category summaries).
- No blockers. Security-review checklist (Application section) applied manually against this plan's DTOs/queries/ownership checks — see below.

## Security Review (skill checklist, Application section)

✅ Aplicado:
- Todo endpoint (`POST`/`PATCH` `/budgets`) tem DTO com validação `class-validator` (`CreateBudgetDto`/`UpdateBudgetDto`) — nenhum payload aceito sem schema, `forbidNonWhitelisted: true` rejeita campos extras (`categoryId` no PATCH, `userId` client-supplied)
- Toda query usa TypeORM parametrizado (`Repository.find`/`findOne`/`save` e `QueryBuilder` com `:userId`/`:categoryIds`/`:transferType`/`:startDate`/`:endDate` bound params) — nenhuma concatenação de string
- Nenhum segredo/connection string/chave hardcoded (nenhum tocado nesta fase)
- Todo endpoint que retorna/modifica um budget verifica ownership: `categoryId` validado via `categoriesService.findOne(userId, ...)` antes de qualquer write; toda rota `:id` usa `findOne` escopado a `userId` (404, nunca 403) — evita IDOR
- Rate limiting: herdado do `ThrottlerModule` global (100 req/60s); nenhuma rota pública nova adicionada por esta fase
- Mensagens de erro não vazam stack trace/nome de tabela — exceções NestJS padrão (`BadRequestException`/`ConflictException`/`NotFoundException`) com mensagens genéricas em português

⚠️ Atenção: nenhum item pendente identificado para o escopo desta fase (Aplicação). Itens de Infraestrutura AWS/Pipeline não se aplicam — esta fase não tocou infraestrutura.

---
*Phase: 05-budgets*
*Completed: 2026-09-22*

## Self-Check: PASSED

All 11 created files (entity, migration, DTOs, service, controller, module, e2e spec) and both task commits (`1d758b4`, `e427f8e`) verified present on disk / in git history.
