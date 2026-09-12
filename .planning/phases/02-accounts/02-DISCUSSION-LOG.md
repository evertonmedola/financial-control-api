# Phase 2: Accounts - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-12
**Phase:** 2-Accounts
**Areas discussed:** Credit card balance convention, Balance mutability, Account deletion

---

## Credit Card Balance Convention (ACCT-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Positivo = dívida | `balance: 500` means "you owe R$500" — intuitive to display, business logic (not sign) distinguishes liability from asset | ✓ |
| Negativo = dívida | `balance: -500` means "you owe R$500" — classic accounting convention, mathematically consistent with other account types but less intuitive to display directly | |

**User's choice:** Positivo = dívida (recommended option)
**Notes:** None beyond the recommendation's own rationale.

---

## Balance Mutability

| Option | Description | Selected |
|--------|-------------|----------|
| Travado após criação | `PATCH` only changes name/type/metadata, never `balance` — protects ACCT-04's "no drift" guarantee ahead of Phase 4 | ✓ |
| Editável livremente via PATCH | User can correct balance anytime via update — more flexible for manual fixes, but opens a path parallel to transaction history that can drift once Phase 4 exists | |

**User's choice:** Travado após criação (recommended option)
**Notes:** None beyond the recommendation's own rationale.

---

## Account Deletion (ACCT-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Soft delete | Mark account as deleted/inactive (e.g. `deletedAt`), keep the row — needed for Phase 4, where old transactions must keep referencing the account even after "deletion" | ✓ |
| Hard delete | Actually remove the row — simpler now, but breaks referential integrity for Phase 4 transactions unless deleting accounts with history is blocked | |

**User's choice:** Soft delete (recommended option)
**Notes:** None beyond the recommendation's own rationale.

---

## Claude's Discretion

- Exact DTO/entity field names, module file layout (mirror `src/auth/`)
- Account type representation (enum vs string) — types themselves fixed by ACCT-01
- Money/decimal column type — locked to `numeric`/`decimal` by `PITFALLS.md` Pitfall 1, not a gray area
- Soft-deleted accounts excluded from list/view by default (`deletedAt IS NULL` filtering)
- Whether initial balance can be negative at account creation (non-credit-card types) — default to allowing it

## Deferred Ideas

None — discussion stayed within phase scope.
