# Phase 4: Transactions & Transfers - Context

**Gathered:** 2026-09-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can record income/expense transactions linked to an account and a category, and transfer money between two of their own accounts as a single atomic operation. This phase makes `AccountsService.adjustBalance()` (reserved stub since Phase 2) live for the first time — it becomes the single write-path every balance mutation in this phase goes through, per `ARCHITECTURE.md`'s module-boundary rule. Transfers must never appear in category spend totals (that exclusion is proven by TXN-04's own tests here, even though Budgets/Reports don't exist until Phase 5/6). Covers TXN-01..05 from REQUIREMENTS.md. Concurrency correctness (row locking on transfers) is this phase's single highest-risk piece of business logic per `PITFALLS.md` Pitfall 2.

</domain>

<decisions>
## Implementation Decisions

### Transfer Modeling (TXN-03, TXN-04)
- **D-01:** A transfer is stored as a **single `Transaction` row** with `type = TRANSFER`, carrying both `fromAccountId` and `toAccountId` — not two linked "leg" rows. No `categoryId` on a transfer row (transfers aren't categorized). **Reversibility:** one-way — switching to a two-row/linked-pair model later would require a data migration and would change every query that currently expects one row per transfer.
- **D-02:** Transfers are created via a **dedicated `POST /transfers` endpoint** (its own controller/DTO: `fromAccountId`, `toAccountId`, `amount`, `date`, `description`), not by reusing `POST /transactions` with a `type` field in the request body. `POST /transactions` only ever accepts `type = INCOME | EXPENSE`. **Reversibility:** reversible — this only affects the request-side shape/routing; both write the same underlying entity (D-01), so consolidating endpoints later doesn't require a data migration.
- **D-03:** A created transfer **does appear in `GET /transactions`** (tagged `type = TRANSFER`) alongside income/expense rows, so a user sees full account activity in one place. Budget/report queries (Phase 5/6) are responsible for filtering `type != TRANSFER` out of spend totals (TXN-04) — this phase's job is only to prove that exclusion is possible and write a test that confirms a transfer does not inflate any category-spend calculation stub/helper this phase introduces.

### Editing Money-Moving Records (protects ACCT-04's "no drift" guarantee)
- **D-04:** For income/expense transactions, `PATCH /transactions/:id` allows editing **only `description` and `date`** — `amount`, `accountId`, and `categoryId` are locked after creation (mirrors Accounts D-02 / Categories D-02's "lock the risky fields" pattern). To fix an amount/account/category mistake, delete and recreate. **Reversibility:** reversible now, but becomes one-way once real transaction history accumulates, for the same reason D-02 in Phase 2/3 became one-way — opening a direct-edit path on `amount`/`accountId` later reintroduces exactly the balance-drift risk ACCT-04 exists to prevent.
- **D-05:** Transfers have **no `PATCH /transfers/:id` at all** — only create and delete. To change the amount, date, description, or which accounts are involved, delete the transfer (reverses both account balances) and create a new one. **Reversibility:** reversible — adding a constrained PATCH later (e.g. description/date only, matching D-04) is additive, not breaking.
- **D-06:** Deleting a transaction or transfer **reverses its balance effect immediately**, in the same DB transaction as the delete — `AccountsService.adjustBalance()` is called with the inverse delta (or both inverse deltas, for a transfer) before the delete commits, so the balance is correct the instant the request succeeds. **Reversibility:** n/a (this is the correctness baseline, not a preference).

### Overdraft Policy
- **D-07:** Expenses and transfers are **never blocked for insufficient balance** — checking/savings/wallet accounts are allowed to go negative, matching real-world overdraft and Phase 2's own discretion note ("default to allowing negative balance unless research surfaces a reason to block it"). No pre-mutation balance-sufficiency check is required.
- **D-08:** Credit card accounts have **no limit enforcement** in this phase — there is no `creditLimit` field on `Account` (out of ACCT-01's scope), so a credit card expense always succeeds regardless of amount already owed.

### Transaction Listing Scope (TXN-02)
- **D-09:** `GET /transactions` is a **plain list with no query filters** in this phase — mirrors Accounts/Categories' current list endpoints. Date-range/account/category filtering is Phase 6 Reports' job (REP-01), not this phase's.
- **D-10:** Default sort order is **most recent first (`date` DESC)** — a deliberate departure from Accounts' `createdAt ASC` convention, chosen because a transaction ledger's natural reading order is newest-first (every finance app reviewed in `FEATURES.md` does this), while Accounts is a short, rarely-reordered list where insertion order reads fine.

### Claude's Discretion
- Exact DTO/entity field names, module file layout — follow `nestjs-conventions` skill, mirroring `src/accounts/` and `src/categories/` structure. `TransactionsModule` and `TransfersModule` (or a shared module — planner's call) both need `AccountsModule`/`CategoriesModule` imported for cross-service validation.
- Money representation for `amount` — follow the exact precedent already shipped in `Account.balance`: PostgreSQL `decimal`/`numeric` column, typed `string` in the entity, never `parseFloat`'d. This is a locked technical constraint from `PITFALLS.md` Pitfall 1, not a new gray area.
- Exact TypeORM locking mechanism (`queryRunner` + `pessimistic_write`, lock ordering by ascending account `id` to avoid deadlocks) — `PITFALLS.md` Pitfall 2 already prescribes the approach; researcher/planner should validate the exact 1.x API surface per `STATE.md`'s flagged blocker ("TypeORM 1.x pessimistic locking API specifics are sparsely documented").
- Whether `TransactionsService`/`TransfersService` share one module or two — no strong opinion; whichever keeps the "transfers have no category, transactions require one" validation cleanest.
- Self-transfer validation (`fromAccountId === toAccountId`) — planner's call to reject with 400; no strong opinion expressed, but this is an obvious edge case worth a dedicated test given Pitfall 2's framing of transfers as this phase's highest-risk logic.
- Whether a transaction's `date` can be in the future — no strong opinion; planner/researcher should check if any downstream (Phase 5 Budgets month-boundary logic) has an implicit assumption here, otherwise allow it.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project conventions
- `.claude/skills/nestjs-conventions/SKILLS.md` — module structure, `userId`-scoped entities, controller-passes-userId-to-service pattern, TypeORM migrations (never `synchronize: true`)
- `.claude/skills/security-review/SKILLS.md` — security checklist this phase's implementation must pass before being considered done

### Research
- `.planning/research/ARCHITECTURE.md` §"Internal Boundaries" — `Transactions ↔ Accounts` (direct service injection into a DB transaction, balance mutation only via `AccountsService.adjustBalance()`), `Transactions ↔ Categories` (direct service injection, read-only, validate ownership before assigning)
- `.planning/research/PITFALLS.md` Pitfall 1 (money as `numeric`/`decimal`, never float — locked precedent, already shipped in `Account.balance`) and Pitfall 2 (transfers need a single `QueryRunner` DB transaction + pessimistic row locking in a consistent account-id order to avoid lost updates and deadlocks — **this phase's highest-risk logic**, needs dedicated concurrent-request integration tests) and Pitfall 3 (IDOR — every list/get/update/delete scoped by `userId`; for transactions, verify the *whole ownership chain*: the referenced `accountId`/`categoryId` must also belong to the authenticated user, not just the transaction row itself)
- `.planning/research/FEATURES.md` §"Table Stakes" (transaction/transfer feature description, the `type: INCOME | EXPENSE | TRANSFER` discriminator pattern this phase's D-01 follows) and §"Feature Dependencies" (transfers reuse the transaction model, must be modeled before/with budget-consumption calculation per its own dependency note)

### Project definition
- `.planning/PROJECT.md` — Core Value, Key Decisions table (soft-delete/immutable-field precedent from Phases 2-3, established pattern this phase's D-04/D-05 extend)
- `.planning/REQUIREMENTS.md` — TXN-01..05 full requirement text
- `.planning/STATE.md` — flagged blocker: "TypeORM 1.x pessimistic locking API specifics are sparsely documented — validate exact `queryRunner`/`lock` API during Phase 4 planning rather than trusting 0.3.x-era examples"

### Phase 2/3 precedent (pattern to mirror, not re-decide)
- `.planning/phases/02-accounts/02-CONTEXT.md` — D-02 (balance immutability), the exact precedent D-04 here extends to transactions
- `.planning/phases/03-categories/03-CONTEXT.md` — D-02 (type-locked-after-creation), the same "lock the risky field" pattern
- `src/accounts/accounts.service.ts` — `adjustBalance(userId, id, delta)` reserved stub (throws `'not implemented until Phase 4'`) that this phase must implement and call from `TransactionsService`/`TransfersService`; `src/accounts/entities/account.entity.ts` — `balance: string` decimal column pattern to mirror for `Transaction.amount`
- `src/categories/categories.module.ts`, `src/categories/entities/category.entity.ts` — module/entity structure to mirror for `src/transactions/` and `src/transfers/`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AccountsService.adjustBalance(userId, id, delta)` (`src/accounts/accounts.service.ts`) — reserved stub since Phase 2, throws `'not implemented until Phase 4'`. This phase implements it for real (wrapping the mutation in a `QueryRunner` transaction with pessimistic locking per Pitfall 2) and is the *only* method that may ever change `Account.balance`.
- `@CurrentUser()` decorator, global `ResponseInterceptor`/`ValidationPipe`/`ClassSerializerInterceptor`, `JwtAuthGuard` — same reuse as every prior domain module, no new setup needed.
- `CategoriesService`/`AccountsService` — inject directly into `TransactionsService`/`TransfersService` to validate that a given `accountId`/`categoryId` exists, is not soft-deleted, and belongs to the authenticated `userId` before allowing a transaction/transfer to reference it (closes the IDOR "ownership chain" gap called out in Pitfall 3).

### Established Patterns
- Domain module layout: `<domain>.module.ts` / `.controller.ts` / `.service.ts` / `dto/` / `entities/` — `src/categories/` is the closest recent precedent.
- Entity pattern: `@Entity('table_name')`, `@PrimaryGeneratedColumn('uuid')`, snake_case DB columns via `@Column({name: 'snake_case'})`, `@Index()` on `user_id`, `@CreateDateColumn`/`@UpdateDateColumn` — see `src/accounts/entities/account.entity.ts` and `src/categories/entities/category.entity.ts`.
- `deletedAt` soft-delete column pattern — not yet decided for `Transaction`/`Transfer` rows this discussion; planner should default to following the same precedent (soft-delete, exclude via `deletedAt IS NULL`) unless a reason emerges to hard-delete financial records (no reason surfaced — recommend soft-delete for consistency and future audit-trail value).
- TypeORM migrations are hand-generated per change, never `synchronize: true` — locked in `AppModule`'s `TypeOrmModule.forRootAsync`.
- `AccountsModule`/`CategoriesModule` already `export: [...Service]` (established in Phase 2/3 specifically so this phase could inject them without reaching into their repositories) — use that existing export, don't add raw repository access across module boundaries.

### Integration Points
- `AppModule` imports — add `TransactionsModule` and `TransfersModule` (or one combined module, per planner's discretion) alongside `AuthModule`/`AccountsModule`/`CategoriesModule`.
- No changes needed to global guards/interceptors/pipes — they already apply project-wide.

</code_context>

<specifics>
## Specific Ideas

No specific UI/UX or vendor references — this is a JSON API phase, same shape as Phases 1-3. The main "I want it like X" signal from this discussion is behavioral: transfers should read like a normal line item in the account's activity feed (D-03), and the API should favor simplicity (lock fields, no PATCH on transfers) over maximal editability, consistent with how Accounts/Categories were shaped.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Date-range/account/category filtering on transaction listing was explicitly discussed and deferred to Phase 6 Reports per D-09, not a new idea — already correctly sequenced in ROADMAP.md.)

</deferred>

---

*Phase: 4-Transactions & Transfers*
*Context gathered: 2026-09-13*
