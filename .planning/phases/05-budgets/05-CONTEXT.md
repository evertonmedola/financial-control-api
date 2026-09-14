# Phase 5: Budgets - Context

**Gathered:** 2026-09-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can set a standing monthly spending limit per expense category and see, for the current calendar month, how much they've spent against it (`remaining = limit - spent`), with an explicit signal when they're over budget. Transfers are excluded from "spent" (established as a Phase 4 cross-cutting invariant, `type = TRANSFER` rows never count toward category spend). Covers BUD-01..03 from REQUIREMENTS.md. Arbitrary month/date-range querying, category/period summaries, and month-over-month comparisons are explicitly Phase 6 Reports' job, not this phase's — mirrors the Phase 4 D-09 precedent (transaction listing has no filters; filtering is a Reports concern).

</domain>

<decisions>
## Implementation Decisions

### Budget Period Model
- **D-01:** A budget is a **standing limit per category** — `Budget = (userId, categoryId, limit)`, one row per category, no `month`/`year` on the entity. It applies to whichever month is being evaluated (this phase only evaluates the current month; see D-05). **Reversibility:** one-way — switching to a per-month record model later (`(userId, categoryId, month, year, limit)`) requires a data migration and changes the uniqueness constraint from "one per category" to "one per category per month".
- **Accepted tradeoff (user's explicit call, not overlooked):** because the limit is standing, changing it today also changes how *past* months would compute if a historical view is ever added — there's only ever one `limit` value, not a per-month snapshot. The user picked this deliberately over the month/year-record alternative (which FEATURES.md's research actually leans toward — "simple limit-spent=remaining per category per month"). Flag this explicitly to research/planner as a known deviation from the research recommendation, not an oversight.

### Editing (BUD-01)
- **D-02:** `PATCH /budgets/:id` (or equivalent) **allows editing `limit`** — unlike Accounts' `balance`/Categories' `type`/Transactions' `amount` (all locked post-creation), a budget's limit is a plan/goal, not a consummated financial fact, so editing it doesn't introduce the balance-drift risk that motivated those earlier lock-downs. **Reversibility:** reversible — this is a validation-layer choice (DTO includes `limit`), easy to tighten later if it proves to be a mistake.

### Category Scope (BUD-01)
- **D-03:** A budget can only be created for a category with `type = DESPESA` (expense). Attempting to create a budget for a `RECEITA` (income) category is rejected with **400**. **Reversibility:** reversible — relaxing this later (e.g. supporting income "minimum" goals) is additive, doesn't break existing budget rows.

### Query Scope (BUD-02)
- **D-04:** The consumed/remaining endpoint only ever evaluates the **current calendar month** — no `?month=`/`?year=` query params in this phase. Arbitrary period querying is Phase 6 Reports' responsibility (REP-03 does month-over-month comparison). **Reversibility:** reversible — adding optional query params later is additive.
- **D-05:** "Current calendar month" must be computed from **calendar month boundaries** (1st 00:00 to end of month), independent of when the budget record itself was created — a budget created on the 15th must reflect the full month's spend from the 1st, not just from creation date onward. This closes PITFALLS.md Pitfall 4's "mid-month budget creation" edge case. **Reversibility:** n/a — this is a correctness baseline, not a preference.

### Missing Budget / Listing (BUD-02)
- **D-06:** There is **no per-category 404 lookup** for consumed/remaining — the listing endpoint (`GET /budgets` or equivalent) only returns categories that actually have a budget set, each with its computed `limit/spent/remaining/overBudget`. A category with no budget simply doesn't appear in the list; there's no dedicated "check this one category" endpoint that could 404. **Reversibility:** reversible — adding a `GET /budgets/by-category/:categoryId` lookup later (with 404 for no-budget) is additive.

### Delete
- **D-07:** `DELETE /budgets/:id` uses **soft-delete** (`deletedAt`, never hard-delete) — consistent with Accounts D-03 and Categories D-01/D-03. A deleted budget's category becomes eligible for a new budget (same "soft-delete frees the row for recreation via partial unique index" pattern already shipped for Accounts/Categories name+type uniqueness). **Reversibility:** reversible — this is a preference-consistency choice, not a structural constraint; the entity structurally supports switching to hard-delete later without a migration beyond dropping the column.

### Response Shape (BUD-02, BUD-03)
- **D-08:** Consumed/remaining response shape is `{ categoryId, limit, spent, remaining, overBudget: boolean }`. `remaining` is **not clamped** — it can go negative when over budget; `overBudget` is a redundant-but-explicit boolean derived from `spent > limit`, satisfying BUD-03's "must not silently return just a negative number" requirement without hiding the actual magnitude of the overage. **Reversibility:** reversible — additive fields (e.g. `overBy`) can be added later without breaking existing consumers.

### Claude's Discretion
- Exact endpoint paths/DTO field names, module file layout — follow `nestjs-conventions` skill, mirroring `src/categories/` structure (closest precedent: single-entity CRUD + one computed-read concern).
- Whether budgets live in their own `BudgetsModule` importing `CategoriesModule`/`TransactionsModule` (read-only) — no strong opinion, but per `ARCHITECTURE.md`'s dependency direction (`Budgets → Categories`), `BudgetsModule` must not be imported by `Categories`/`Transactions`/`Accounts`.
- Aggregation query shape for "spent" (single `SUM(amount) WHERE userId AND categoryId AND type != TRANSFER AND date BETWEEN <month bounds>` per category, or one grouped query for all budgeted categories) — planner's call; PITFALLS.md's performance note recommends a single grouped query over an N+1 per-category loop once this scales, but at personal-project scale either is acceptable for v1.
- Timezone handling for month boundaries — no explicit preference from the user; researcher/planner should check what convention `Transaction.date` already uses (Phase 4 D-10 sort order references `date` but doesn't specify timezone handling) and stay consistent with it.
- Uniqueness enforcement mechanism for "one budget per category" — per the established Accounts/Categories precedent (D-03 in both), this should be a partial unique index on `(user_id, category_id) WHERE deleted_at IS NULL`, not an app-layer check. Not re-litigated here since it's already the project's locked pattern, but flagged so planner doesn't rediscover it as a new decision.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project conventions
- `.claude/skills/nestjs-conventions/SKILLS.md` — module structure, `userId`-scoped entities, controller-passes-userId-to-service pattern, TypeORM migrations (never `synchronize: true`)
- `.claude/skills/security-review/SKILLS.md` — security checklist this phase's implementation must pass before being considered done

### Research
- `.planning/research/ARCHITECTURE.md` §"Internal Boundaries" — `Budgets ↔ Categories` (direct service injection, read-only) dependency direction; §line 206 "Budget consumed/remaining computed on read, no denormalized running total in v1"
- `.planning/research/PITFALLS.md` Pitfall 4 ("Budget consumed vs remaining calculated incorrectly at edge cases") — the primary risk register for this phase: transfer exclusion, calendar-month boundaries independent of budget creation date, timezone boundary bugs, zero-transaction categories (no divide-by-zero), over-100% not clamped/hidden. Also Pitfall 3 (IDOR — ownership chain check on `categoryId`) and Pitfall 1 (decimal-safe money, never float)
- `.planning/research/FEATURES.md` §"Table Stakes" (budget limit + spent/remaining, universal `Remaining = Planned - Spent` formula) and §"Feature Dependencies" (budget rollover explicitly deferred to v2, not built into this phase's entity)
- `.planning/research/PITFALLS.md` line 224 — avoid N+1 per-category aggregation query; use grouped `SUM(...) GROUP BY category_id`

### Project definition
- `.planning/PROJECT.md` — Core Value, Key Decisions table (soft-delete/immutable-vs-editable-field precedent this phase's D-02/D-03/D-07 extend or deliberately diverge from)
- `.planning/REQUIREMENTS.md` — BUD-01..03 full requirement text
- `.planning/ROADMAP.md` §"Phase 5: Budgets" — Goal and Success Criteria this phase must satisfy

### Phase 2/3/4 precedent (pattern to mirror or deliberately diverge from)
- `.planning/phases/02-accounts/02-CONTEXT.md` — D-03 (soft-delete + partial unique index pattern), D-02 (locked-field precedent this phase's D-02 diverges from, with stated rationale)
- `.planning/phases/03-categories/03-CONTEXT.md` — D-01/D-03 (soft-delete frees name/type for reuse via partial unique index) — same mechanism this phase's D-07 reuses for `(userId, categoryId)`
- `.planning/phases/04-transactions-transfers/04-CONTEXT.md` — D-03 (transfers appear in listings but must be excluded from category-spend calculations — this phase is where that exclusion actually gets implemented and tested for the first time); D-09 (no query filters on listing endpoints — precedent for this phase's D-04 "current month only")
- `src/categories/entities/category.entity.ts` — `CategoryType.DESPESA`/`RECEITA` enum this phase's D-03 validates against; soft-delete (`deletedAt`) column pattern to mirror exactly
- `src/transactions/` — `Transaction.type`/`amount`/`date`/`categoryId` shape the spend-aggregation query reads from

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `CategoriesService` — inject directly (read-only) to validate `categoryId` exists, is not soft-deleted, belongs to the authenticated `userId`, and has `type = DESPESA` before allowing a budget to reference it (D-03).
- `TransactionsService` / `Transaction` repository — read-only aggregation source for "spent" (`SUM(amount) WHERE userId AND categoryId AND type != TRANSFER AND date BETWEEN <month bounds>`).
- `@CurrentUser()` decorator, global `ResponseInterceptor`/`ValidationPipe`/`ClassSerializerInterceptor`, `JwtAuthGuard` — same reuse as every prior domain module, no new setup needed.
- Money-as-string decimal pattern (`src/common/decimal.util.ts`, BigInt-cents arithmetic) — reuse for `limit`, `spent`, `remaining` fields exactly as `Account.balance`/`Transaction.amount` already do; never `parseFloat`.

### Established Patterns
- Domain module layout: `<domain>.module.ts` / `.controller.ts` / `.service.ts` / `dto/` / `entities/` — `src/categories/` is the closest precedent (single-entity CRUD + one computed-read concern, no cross-account locking complexity like Transfers).
- Entity pattern: `@Entity('table_name')`, `@PrimaryGeneratedColumn('uuid')`, snake_case DB columns via `@Column({name: 'snake_case'})`, `@Index()` on `user_id`, `@CreateDateColumn`/`@UpdateDateColumn` — see `src/categories/entities/category.entity.ts`.
- Partial unique index for "one active row per scope" (`WHERE deleted_at IS NULL`) — established in Accounts (name+type) and Categories (name+type); this phase applies the same mechanism to `(user_id, category_id)`.
- TypeORM migrations are hand-generated per change, never `synchronize: true` — locked in `AppModule`'s `TypeOrmModule.forRootAsync`.
- `CategoriesModule`/`TransactionsModule` already `export: [...Service]` — use that existing export for `BudgetsModule`'s cross-module reads, don't reach into repositories directly.

### Integration Points
- `AppModule` imports — add `BudgetsModule` alongside the existing domain modules.
- No changes needed to global guards/interceptors/pipes — they already apply project-wide.
- Per `ARCHITECTURE.md`'s dependency direction, `BudgetsModule` depends on `CategoriesModule` and `TransactionsModule` (both read-only) — nothing should depend back on `BudgetsModule` except the future `ReportsModule` (Phase 6).

</code_context>

<specifics>
## Specific Ideas

No specific UI/UX or vendor references — this is a JSON API phase, same shape as Phases 1-4. The one clear behavioral preference from this discussion: budgets are a lightweight, editable "setting" (standing limit, editable, soft-deletable) rather than an immutable historical record like a transaction — the user consistently favored simplicity/mutability over the stricter immutability precedent used for money-movement records in Phases 2-4.

</specifics>

<deferred>
## Deferred Ideas

- **Per-month budget records** (a distinct `(categoryId, month, year, limit)` row per month, preserving exact historical limits) — the research (`FEATURES.md`) actually recommends this shape, and it's the natural fit if arbitrary historical-month querying is ever added. Not built now because the user explicitly chose the simpler standing-limit model (D-01). Revisit if/when historical accuracy of past budget limits becomes a real requirement.
- **Budget rollover** (unspent/overspent carries to next month) — already tracked as v2 (FIN-02) in REQUIREMENTS.md; not discussed further here since it wasn't raised and is out of this phase's scope.
- **`?month=`/`?year=` querying on the budgets endpoint** — deferred to Phase 6 Reports (REP-03 month-over-month comparison) per D-04; not lost, just correctly sequenced.

</deferred>

---

*Phase: 5-Budgets*
*Context gathered: 2026-09-14*
