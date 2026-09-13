# Phase 3: Categories - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-13
**Phase:** 3-Categories
**Areas discussed:** Deletion behavior, Type mutability, Duplicate names, Default categories

---

## Deletion behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Soft delete (Recommended) | deletedAt timestamp, same pattern as Accounts (D-03). Categories stay referenceable once Phase 4 transactions and Phase 5 budgets link to categoryId — avoids a breaking migration later. | ✓ |
| Hard delete | Row is actually removed. Simpler now, but would need to become soft-delete (or block deletion) once Phase 4 transactions exist and reference this category — a one-way decision to revisit. | |
| Block if in use, hard delete otherwise | Delete only allowed when nothing references the category yet (no FK check needed this phase since transactions don't exist yet) — but this check becomes meaningful/needed starting Phase 4, so the endpoint's behavior would change later regardless. | |

**User's choice:** Soft delete (Recommended)
**Notes:** Directly mirrors Phase 2's Account soft-delete (D-03) for the same underlying reason — future FK references from Phase 4/5.

---

## Type mutability

| Option | Description | Selected |
|--------|-------------|----------|
| Immutable (Recommended) | Type is locked at creation, same as Account.type in Phase 2 (D-02's shape). Prevents a category from silently flipping meaning under transactions/budgets that already reference it once Phase 4/5 ship. | ✓ |
| Mutable | PATCH can change type freely. Simpler now, but risks misrepresenting historical transactions/budgets tied to that category once those modules exist — would need retrofitted validation later. | |

**User's choice:** Immutable (Recommended)
**Notes:** Parallels Phase 2's D-02 (balance immutability) for the same reversibility reasoning.

---

## Duplicate names

| Option | Description | Selected |
|--------|-------------|----------|
| Block same name+type (Recommended) | Unique constraint on (userId, name, type). Prevents accidental duplicate "Alimentação" (despesa) categories cluttering reports later, while still allowing the same name under a different type (e.g. "Outros" as both receita and despesa). | ✓ |
| Allow duplicates | No uniqueness constraint — user can create as many identically-named categories as they want. Simpler, but duplicate names will look confusing in Phase 6 reports grouped by category. | |

**User's choice:** Block same name+type (Recommended)
**Notes:** Enforced at DB level per composite unique constraint, not just application validation.

---

## Default categories

| Option | Description | Selected |
|--------|-------------|----------|
| Blank slate (Recommended) | No seeding. Matches Phase 1/2 precedent (no auto-provisioned data anywhere yet) and keeps this phase's scope to CAT-01/02 only — pure user-driven CRUD. | ✓ |
| Seed defaults on signup | A fixed set of common categories (e.g. Salário, Alimentação, Moradia, Transporte) auto-created when a user registers. Nicer first-run UX but adds signup-flow logic and an opinionated taxonomy outside CAT-01/02's stated scope. | |

**User's choice:** Blank slate (Recommended)
**Notes:** None.

---

## Claude's Discretion

- Exact DTO/entity field names, module file layout — mirror `src/accounts/` structure.
- Unique-constraint implementation detail (plain composite unique index vs. partial index also filtering `deletedAt IS NULL` so a deleted category's name can be reused).
- HTTP status/error shape for a duplicate-name conflict (409 vs 400).

## Deferred Ideas

None — discussion stayed within phase scope.
