# Phase 4: Transactions & Transfers - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-13
**Phase:** 4-Transactions & Transfers
**Areas discussed:** Transfer modeling, Editing money-moving records, Overdraft policy, Transaction listing scope

---

## Transfer modeling

### How should a transfer be represented in the data model?

| Option | Description | Selected |
|--------|-------------|----------|
| Single row, type=TRANSFER | One Transaction row per transfer with fromAccountId + toAccountId. Simpler schema, one row to query/delete/update. No categoryId. | ✓ |
| Linked pair (two legs) | Two Transaction rows (debit leg + credit leg) linked by a shared transferId. Native per-account history row, but two rows to keep in sync. | |

### Does a transfer need its own dedicated endpoint, or reuse the transaction endpoints with a type field?

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated POST /transfers | Separate resource/controller with its own DTO (fromAccountId, toAccountId, amount, date, description). | ✓ |
| POST /transactions with type | One controller/endpoint for everything; type discriminator picks required fields. | |

### Does a listed transfer show up in GET /transactions, or only in a separate transfers listing?

| Option | Description | Selected |
|--------|-------------|----------|
| Appears in /transactions too | Transfers show up in the same list (tagged type=TRANSFER); report/budget queries filter them out of spend totals separately. | ✓ |
| Separate from /transactions | Transfers only show up via their own listing endpoint. | |

**Notes:** No further questions — moved directly to next area.

---

## Editing money-moving records

### Once a transaction (income/expense) is created, which fields can a user edit via PATCH?

| Option | Description | Selected |
|--------|-------------|----------|
| Description + date only | Mirrors Accounts/Categories D-02 pattern. amount/account/category immutable — delete+recreate to fix. | ✓ |
| All fields editable | amount, account, category, description, date all editable; update must reverse old balance effect and apply new one. | |

### Can a transfer be edited via PATCH after creation, or only deleted and recreated?

| Option | Description | Selected |
|--------|-------------|----------|
| Delete + recreate only | No PATCH /transfers/:id at all. | ✓ |
| PATCH allowed (amount/date/description) | Editable except fromAccountId/toAccountId (locked). | |

### When a transaction/transfer is deleted, what happens to the affected account balance(s)?

| Option | Description | Selected |
|--------|-------------|----------|
| Reverse the balance effect immediately | DELETE calls AccountsService.adjustBalance() with the inverse delta in the same DB transaction. | ✓ |
| You decide | Claude picks the standard approach (same as reverse-immediately). | |

**Notes:** No further questions — moved directly to next area.

---

## Overdraft policy

### Should an expense or transfer be blocked if it would push a checking/savings/wallet account's balance negative?

| Option | Description | Selected |
|--------|-------------|----------|
| Allow it (no block) | Real accounts can go overdrawn; matches Phase 2's own discretion note. | ✓ |
| Block it (reject with error) | Reject with 400/422 if resulting balance would go below zero for non-credit-card types. | |

### Credit card accounts represent amount owed. Any limit enforcement on those in this phase?

| Option | Description | Selected |
|--------|-------------|----------|
| No limit enforcement | No creditLimit field exists yet (out of ACCT-01 scope) — expense always succeeds. | ✓ |
| You decide | Claude follows the same rule as the checking/savings/wallet answer. | |

**Notes:** No further questions — moved directly to next area.

---

## Transaction listing scope

### What should GET /transactions support in this phase?

| Option | Description | Selected |
|--------|-------------|----------|
| Plain list only | Mirrors Accounts/Categories today — no query filters. Date-range/category filtering deferred to Phase 6 Reports (REP-01). | ✓ |
| Add basic filters now | accountId/categoryId/date-range query params ahead of Reports. | |

### What order should the transaction list return by default?

| Option | Description | Selected |
|--------|-------------|----------|
| Most recent first (date DESC) | Newest transaction date first — matches every finance app reviewed in FEATURES.md. | ✓ |
| Oldest first (createdAt ASC) | Matches Accounts' list convention exactly. | |

**Notes:** No further questions — discussion concluded, proceeded to write CONTEXT.md.

---

## Claude's Discretion

- Exact DTO/entity field names, module file layout (follow `nestjs-conventions`, mirror `src/accounts/`/`src/categories/`)
- Whether `TransactionsService`/`TransfersService` share one module or two
- Exact TypeORM 1.x pessimistic-locking API surface (validate during planning per STATE.md's flagged blocker)
- Self-transfer validation (`fromAccountId === toAccountId`) — recommend rejecting with 400
- Whether a transaction's `date` can be in the future — check Phase 5 Budgets' month-boundary assumptions first
- Soft-delete vs hard-delete for `Transaction`/`Transfer` rows — recommend soft-delete for consistency with Accounts/Categories precedent

## Deferred Ideas

None — discussion stayed within phase scope. Date-range/account/category filtering was explicitly discussed and deferred to Phase 6 Reports (D-09 in CONTEXT.md), matching ROADMAP.md's existing sequencing.
