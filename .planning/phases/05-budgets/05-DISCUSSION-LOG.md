# Phase 5: Budgets - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-14
**Phase:** 5-Budgets
**Areas discussed:** Período, Edição, Escopo, Consulta, Sem limite, Delete, Formato

---

## Período (budget period model)

| Option | Description | Selected |
|--------|-------------|----------|
| Limite fixo (standing) | Budget = (userId, categoryId, limit). Applies to any queried month — current or past — until changed. Simpler to use (configure once), but retroactively "rewrites" history: changing the limit today also changes how past months would appear. | ✓ |
| Registro por mês/ano | Budget = (userId, categoryId, month, year, limit). Each month has its own record; querying an unset month returns "no budget". Preserves exact history (matches FEATURES.md's research recommendation), but requires recreating/copying the budget every month. | |

**User's choice:** Limite fixo (standing)
**Notes:** User explicitly accepted the retroactive-rewrite tradeoff despite it diverging from the research-recommended per-month model. Recorded as a deliberate deviation, not an oversight.

---

## Edição (mutability of the limit)

| Option | Description | Selected |
|--------|-------------|----------|
| PATCH permite editar o limit | Different from amount/balance (locked in earlier phases) — a budget is a goal/plan, not a consummated financial fact, so editing it doesn't introduce accounting drift. | ✓ |
| Limit travado, só delete+recreate | Full consistency with the D-02/D-04 pattern already established (Accounts balance, Categories type, Transactions amount) — "only safe fields are editable, never the core value." | |

**User's choice:** PATCH permite editar o limit

---

## Escopo (which category types accept a budget)

| Option | Description | Selected |
|--------|-------------|----------|
| Só categorias de despesa | Rejects with 400 if the category is type "receita" — a budget only makes sense to limit spending, consistent with BUD-01..03's "spending limit" vocabulary. | ✓ |
| Qualquer tipo de categoria | No type validation — allows a budget on an income category too (e.g. a "minimum income target"), more flexible but semantically odd since remaining = limit - spent only makes sense for expense. | |

**User's choice:** Só categorias de despesa

---

## Consulta (query scope for consumed/remaining)

| Option | Description | Selected |
|--------|-------------|----------|
| Só mês atual (recomendado) | Keeps Phase 5 simple and non-overlapping with REP-03 (month-over-month comparison, Phase 6). Mirrors Transactions' D-09: arbitrary filters/periods are Reports' job. | ✓ |
| Aceita ?month=&year= | More immediately useful (query a past month), but pulls part of Reports' scope (REP-03) into Budgets, blurring the phase boundary. | |

**User's choice:** Só mês atual (recomendado)

---

## Sem limite (category with no budget set)

| Option | Description | Selected |
|--------|-------------|----------|
| 404 nessa categoria | GET /budgets/:categoryId (or similar) returns 404 if no budget exists for that category — symmetric with the rest of the API (nonexistent resource = 404). | |
| Listagem só mostra quem tem orçamento | GET /budgets only returns categories with a limit set; there's no endpoint that tries to compute consumed/remaining for a category without one. | ✓ |

**User's choice:** Listagem só mostra quem tem orçamento

---

## Delete (deletion semantics)

| Option | Description | Selected |
|--------|-------------|----------|
| Soft-delete (deletedAt) | Full consistency with the pattern already established across the whole domain (Accounts D-03, Categories D-01/D-03) — never hard-delete, even for a "configuration" like a budget limit. | ✓ |
| Hard-delete | A budget is a configuration/goal, not a historical financial record like a transaction — different enough to justify an exception to the soft-delete pattern. Recreating later is just a fresh INSERT with no unique-index conflict. | |

**User's choice:** Soft-delete (deletedAt)

---

## Formato (response shape for consumed/remaining)

| Option | Description | Selected |
|--------|-------------|----------|
| limit/spent/remaining/overBudget | { categoryId, limit, spent, remaining, overBudget: boolean }. remaining can go negative when overBudget=true (the negative number itself is informative, the flag just makes it explicit and easy to check without parsing sign). | ✓ |
| limit/spent/remaining clamped + overBudget | { categoryId, limit, spent, remaining: max(0, limit-spent), overBudget: boolean, overBy: number }. remaining never negative (avoids API consumers misreading a negative number); overage amount lives in overBy. | |

**User's choice:** limit/spent/remaining/overBudget

---

## Claude's Discretion

- Exact endpoint paths/DTO field names, module file layout — follow `nestjs-conventions` skill, mirroring `src/categories/`.
- Module wiring (single `BudgetsModule` vs. split) — no strong opinion; must respect `ARCHITECTURE.md`'s `Budgets → Categories`/`Budgets → Transactions` (read-only) dependency direction.
- Aggregation query shape (single grouped `SUM(...) GROUP BY category_id` vs. per-category query) — planner's call; grouped query recommended per PITFALLS.md's N+1 warning, but either is acceptable at this project's scale.
- Timezone handling for calendar-month boundaries — no explicit user preference; follow whatever convention `Transaction.date` already uses.
- Uniqueness enforcement for "one budget per category" — partial unique index on `(user_id, category_id) WHERE deleted_at IS NULL`, same mechanism as Accounts/Categories D-03. Not re-discussed since it's already the project's locked pattern.

## Deferred Ideas

- Per-month budget records (exact historical limit preservation) — research-recommended alternative to D-01's standing-limit model; deferred because the user explicitly chose simplicity. Revisit if historical budget-limit accuracy becomes a real requirement.
- Budget rollover — already tracked as v2 (FIN-02) in REQUIREMENTS.md; not raised in this discussion.
- `?month=`/`?year=` querying on the budgets endpoint — correctly deferred to Phase 6 Reports (REP-03).
