# Phase 2: Accounts - Context

**Gathered:** 2026-09-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can create, list, view, update, and delete their own financial accounts (corrente, poupança, carteira, cartão de crédito), each with a balance. This phase establishes the `AccountsService` as the single write-path for balance mutation — Phase 4 (Transactions & Transfers) will call into it rather than mutating balances directly, per `ARCHITECTURE.md`'s module-boundary rule. Covers ACCT-01..04 from REQUIREMENTS.md. No transaction ledger exists yet (that's Phase 4) — this phase only establishes account creation with an initial balance and the ownership/CRUD pattern every later module reuses, mirroring Phase 1's `userId`-scoping precedent.

</domain>

<decisions>
## Implementation Decisions

### Credit Card Balance Convention (ACCT-03)
- **D-01:** Credit card balance is represented as a **positive number meaning "amount owed"** (e.g. `balance: 500` = user owes R$500) — not a negative-number liability convention. **Reversibility:** costly — this is an API contract every client and later report (Phase 6) reads; flipping the sign convention later requires a coordinated migration + client update, not just a code change.

### Balance Mutability (protects ACCT-04's "no drift" guarantee ahead of Phase 4)
- **D-02:** `balance` is set only at account creation and is **locked against direct edits via `PATCH /accounts/:id`** — update endpoints may change name/type/metadata, never `balance` directly. **Reversibility:** reversible now (no data depends on it yet), but becomes one-way once Phase 4 ships, since opening a direct-edit path after transactions exist reintroduces the drift ACCT-04 exists to prevent.

### Account Deletion (ACCT-02)
- **D-03:** Deleting an account is a **soft delete** (e.g. `deletedAt` timestamp column), never a hard row removal. **Reversibility:** one-way to change later — Phase 4's transactions will have a foreign key to `accounts.id`; a hard-delete convention adopted now would need a breaking migration once transaction history exists and must continue referencing a "deleted" account.

### Claude's Discretion
- Exact DTO/entity field names, module file layout — follow `nestjs-conventions` skill (module/controller/service/dto/entities per domain), mirroring `src/auth/` exactly.
- Account type representation (enum vs string column) — the four types are fixed by ACCT-01 (`corrente`, `poupança`, `carteira`, `cartão de crédito`); no new types are in scope this phase.
- Money/decimal column type and precision handling — `PITFALLS.md` Pitfall 1 already mandates PostgreSQL `numeric`/`decimal` (never `float`/`double precision`, never coerced through `parseFloat`) with an exact-arithmetic test; this is a locked technical constraint, not a gray area, and the planner/executor should treat it as non-negotiable.
- Whether soft-deleted accounts are excluded from list/view endpoints by default — yes, standard soft-delete filtering (`deletedAt IS NULL`) on all list/read queries unless a future phase needs an "archived accounts" view.
- Initial balance validation (can it be negative at creation for non-credit-card types?) — planner's call; no strong opinion expressed, default to allowing it (real accounts can start overdrawn) unless research surfaces a reason to block it.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project conventions
- `.claude/skills/nestjs-conventions/SKILLS.md` — module structure, `userId`-scoped entities, controller-passes-userId-to-service pattern, TypeORM migrations (never `synchronize: true`)
- `.claude/skills/security-review/SKILLS.md` — security checklist this phase's implementation must pass before being considered done

### Research
- `.planning/research/ARCHITECTURE.md` §"Module boundaries" and §"Cross-domain dependency direction" — `Transactions → Accounts` (Accounts must never import Transactions); balance mutation must only ever happen through `AccountsService`, never raw repository access from a future module
- `.planning/research/PITFALLS.md` Pitfall 1 (money as `numeric`/`decimal`, never float) and Pitfall 3 (IDOR — every list/get/update/delete must scope by `userId`, return 404 not 403 on mismatch, and this phase must ship its own dedicated cross-tenant isolation test suite mirroring `test/cross-tenant.e2e-spec.ts`)
- `.planning/research/STACK.md` — confirms TypeORM 1.1.x, PostgreSQL migration conventions already in use

### Project definition
- `.planning/PROJECT.md` — Core Value, Key Decisions table (argon2, JWT strategy — established precedent for how decisions are recorded)
- `.planning/REQUIREMENTS.md` — ACCT-01..04 full requirement text

### Phase 1 precedent (pattern to mirror, not re-decide)
- `.planning/phases/01-authentication-multi-tenant-foundation/01-01-SUMMARY.md` — established module layout, `@CurrentUser()` decorator, global `ResponseInterceptor`/`ValidationPipe` pattern every new controller inherits automatically
- `.planning/phases/01-authentication-multi-tenant-foundation/01-05-SUMMARY.md` — the cross-tenant/IDOR test suite pattern (`test/cross-tenant.e2e-spec.ts`) this phase's own isolation tests should mirror
- `src/auth/entities/user.entity.ts`, `src/auth/auth.module.ts` — concrete entity/module structure to follow for `src/accounts/`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `@CurrentUser()` decorator (`src/auth/decorators/current-user.decorator.ts`) — inject the authenticated `userId` into every Accounts controller method exactly as `AuthController` does; never read `Request` in the service.
- Global `ResponseInterceptor` + `ValidationPipe({whitelist, forbidNonWhitelisted, transform})` + `ClassSerializerInterceptor` (registered as `APP_INTERCEPTOR`/`APP_PIPE` in `AppModule`) — every new controller/DTO gets consistent response envelope and validation for free; no per-module setup needed.
- `JwtAuthGuard` (`src/auth/guards/jwt-auth.guard.ts`) — apply to every Accounts route to require authentication.

### Established Patterns
- Domain module layout: `<domain>.module.ts` / `.controller.ts` / `.service.ts` / `dto/` / `entities/` — `src/auth/` is the concrete reference implementation.
- Entity pattern: `@Entity('table_name')`, `@PrimaryGeneratedColumn('uuid')`, snake_case DB columns via `@Column({name: 'snake_case'})`, `@CreateDateColumn`/`@UpdateDateColumn` — see `src/auth/entities/user.entity.ts`.
- TypeORM migrations are hand-generated per change, never `synchronize: true` — `AppModule`'s `TypeOrmModule.forRootAsync` already has `synchronize: false` locked in.
- `AccountsModule` should `export: [AccountsService]` (mirroring `AuthModule`) so Phase 4's `TransactionsModule` can inject it later without reaching into its repository.

### Integration Points
- `AppModule` imports — add `AccountsModule` alongside `AuthModule`.
- No changes needed to global guards/interceptors/pipes — they already apply project-wide.

</code_context>

<specifics>
## Specific Ideas

No specific UI/UX or vendor references — this is a JSON API phase, same shape as Phase 1's auth endpoints. Open to standard NestJS/TypeORM implementation within the decisions above.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Balance mutation via transactions, transfers, and the "no drift" derivation itself are explicitly Phase 4's job, already correctly out of scope here per ROADMAP.md sequencing — not a deferred idea, just the existing plan.)

</deferred>

---

*Phase: 2-Accounts*
*Context gathered: 2026-09-12*
