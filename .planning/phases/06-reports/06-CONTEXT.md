# Phase 6: Reports - Context

**Gathered:** 2026-09-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Read-only, JSON-only aggregation endpoints over existing Accounts/Categories/Transactions data. No new write paths, no new entities beyond DTOs. Delivers exactly the three ROADMAP success criteria: (1) category/period spending summary for an arbitrary date range, (2) a single consolidated balance across all accounts, (3) a month-over-month per-category spending comparison. Explicitly out of scope per PROJECT.md: visualization/export (CSV/PDF/dashboards) — v1 reports are JSON endpoints only — and any budget-vs-actual view (Budgets and Reports are separate phases; the ROADMAP success criteria for Phase 6 make no mention of budgets).

</domain>

<decisions>
## Implementation Decisions

### Balance Netting (REP-02: consolidated balance)
- Consolidated balance is a **net total**: sum of asset-type accounts (checking, savings, wallet) minus sum of credit-card balances owed — one true net-worth figure, not a naive SUM(balance) across all accounts.
- Rationale: credit-card `balance` is stored as "amount owed" (always positive, per Phase 2's D-01 convention) — a gross sum would add debt to assets and produce a misleading number. Net (assets − debt) is the only figure that's actually meaningful as "a single consolidated balance."
- Soft-deleted accounts are excluded from the total (consistent with every other aggregate/list endpoint so far).

### Date Range Input (REP-01: category/period summary)
- Query params `?from=YYYY-MM-DD&to=YYYY-MM-DD`, both required.
- 400 Bad Request if either param is missing, malformed, or `from > to`.
- No hard cap on range size — low personal-use transaction volume, no pagination/perf concern at this scale.

### Month-over-Month Comparison Scope (REP-03)
- Single query param `?month=YYYY-MM`. Compares that month against the immediately preceding calendar month (no explicit second-month param).
- Per-category delta shape: `{categoryId, categoryName, currentMonthTotal, previousMonthTotal, delta}`. (`deltaPercent` deferred — divide-by-zero when previous month total is 0 needs a defined convention; leave to planner/executor as a Rule-1/Rule-2-class implementation detail, not a phase-blocking grey area.)

### Empty Category Rows (REP-01)
- A category with zero matching transactions in the requested range is **omitted** from the category/period summary list — mirrors the established Budgets convention (`GET /budgets` only lists categories that actually have a budget; a category with no activity simply doesn't appear).

### Claude's Discretion
- Exact response envelope/DTO field naming beyond what's specified above.
- Whether category/period summary and month-over-month comparison are separate controller methods/routes or share a service method — implementation detail, not a user-facing contract question.
- `deltaPercent` divide-by-zero convention (see above) — resolve using the same judgment already applied to Budgets' zero-transaction divide-by-zero case (Phase 5, Pitfall 4: never crash/NaN/null).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `TransactionsService.sumByCategoryExcludingTransfers` (`src/transactions/transactions.service.ts`) — the first grouped read-side `SUM(...) GROUP BY` aggregation in this codebase (built for Budgets, Phase 5). Reports' category/period summary and month-over-month comparison should extend or parallel this same aggregation shape, adding a date-range filter alongside the existing transfer-exclusion (`type = EXPENSE`, hardened during Phase 5's code-review loop) rather than reinventing it.
- `src/common/decimal.util.ts` — BigInt-cents arithmetic helpers (`subtractDecimalStrings`, `isGreaterThanDecimalString`, etc.) — all report money math (net balance, deltas) must go through this, never `parseFloat`/`Number()`, per the project's established no-float-drift convention (proven under Phase 4's precision stress tests).
- `AccountsService` — accounts already carry `type` and signed-per-type `balance` (Phase 2, D-01). Net-balance calculation reads directly from `accounts` (no need to re-derive from transaction history).

### Established Patterns
- Every module in this codebase follows: module/controller/service/dto/entities under `src/<domain>/`, `userId`-scoped everywhere via `@CurrentUser()` (never client input), global `ValidationPipe`/`ClassSerializerInterceptor`/`ResponseInterceptor`, `class-validator` DTOs with `forbidNonWhitelisted: true`.
- Response money fields are always decimal **strings**, never JS numbers (established in Accounts/Transactions/Budgets).
- Soft-deleted rows (`deletedAt`) are excluded from every list/aggregate query across all four prior domain modules — Reports must follow the same convention for accounts, categories, and transactions.
- Post-execution code review + security-review checklist close-out is mandatory before phase completion (CLAUDE.md constraint, applied identically in Phases 1-5).

### Integration Points
- New `src/reports/` module (module/controller/service/dto), registered in `src/app.module.ts` alongside the other five domain modules.
- Reads from `AccountsService`/`AccountRepository`, `CategoriesService`/`CategoryRepository`, and `TransactionsService`/`TransactionRepository` — no new entities, no new migrations expected.

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond the ROADMAP success criteria and the decisions above — open to standard approaches for anything not explicitly decided.

</specifics>

<deferred>
## Deferred Ideas

- Budget-vs-actual reporting (comparing a category's actual spend against its Phase 5 budget limit) — natural follow-on once both Budgets and Reports exist, but not in Phase 6's ROADMAP success criteria. Noted for a possible future phase, not auto-added to scope.
- CSV/PDF export or dashboard visualization of reports — explicitly Out of Scope per PROJECT.md ("relatórios v1 são só endpoints JSON").
- `deltaPercent` field on the month-over-month comparison — deferred to implementation discretion (see Claude's Discretion above), not a blocking decision.

</deferred>
