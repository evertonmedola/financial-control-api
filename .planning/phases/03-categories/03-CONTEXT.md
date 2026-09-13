# Phase 3: Categories - Context

**Gathered:** 2026-09-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can create, list, view, update, and delete their own custom income/expense categories (`receita`/`despesa`). This phase establishes `Category` as the entity Phase 4's `Transaction` and Phase 5's `Budget` will reference by `categoryId` — no transactions or budgets exist yet, so referential-integrity concerns (what happens to a category "in use") aren't enforceable this phase, but the deletion and mutability decisions below are made now specifically to avoid a breaking change once those modules exist. Covers CAT-01, CAT-02 from REQUIREMENTS.md.

</domain>

<decisions>
## Implementation Decisions

### Category Deletion (CAT-02)
- **D-01:** Deleting a category is a **soft delete** (`deletedAt` timestamp column), mirroring Phase 2's Account soft-delete (D-03) — never a hard row removal. **Reversibility:** one-way to change later — Phase 4's transactions and Phase 5's budgets will have a foreign key to `categories.id`; a hard-delete convention adopted now would need a breaking migration once transaction/budget history exists and must continue referencing a "deleted" category.
- Soft-deleted categories are excluded from list/view endpoints by default (`deletedAt IS NULL` filter), same as Accounts.

### Category Type Mutability (protects Phase 5's budget-per-category assumption ahead of time)
- **D-02:** `type` (`receita`/`despesa`) is set only at category creation and is **locked against direct edits via `PATCH /categories/:id`** — update endpoints may change `name`, never `type`. **Reversibility:** reversible now (no data depends on it yet), but becomes one-way once Phase 4/5 ship, since a category flipping type after transactions/budgets already reference it would silently misrepresent existing records.

### Duplicate Category Names
- **D-03:** Category `name` must be **unique per `(userId, name, type)`** — a user cannot create two `despesa` categories both named "Alimentação," but the same name is allowed once per type (e.g. "Outros" as both `receita` and `despesa`). Enforced via a composite unique constraint (or unique index) at the database level, not just application-layer validation. **Reversibility:** reversible — a uniqueness constraint can be relaxed later without data loss, though loosening it after real duplicate data isn't a concern here since it's additive, not restrictive.

### Default Categories on Signup
- **D-04:** **No seeding.** New users start with zero categories — pure blank slate, matching Phase 1/2 precedent (no auto-provisioned data exists anywhere in the system yet). Category creation is entirely user-driven, matching CAT-01/02's stated scope exactly.

### Claude's Discretion
- Exact DTO/entity field names, module file layout — follow `nestjs-conventions` skill (module/controller/service/dto/entities per domain), mirroring `src/accounts/` structure exactly (it's the closest and most recent precedent — simpler than Accounts since there's no balance/money concern here).
- Whether the unique constraint (D-03) is implemented as a DB-level composite unique index vs. a partial unique index that also accounts for `deletedAt IS NULL` (so a soft-deleted category's name can be reused) — planner's call; recommend the partial-index approach so deleting and recreating a category with the same name isn't permanently blocked.
- HTTP error shape/status for a duplicate-name conflict (409 vs 400) — follow whatever convention `nestjs-conventions` or existing modules already establish; no strong opinion expressed.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project conventions
- `.claude/skills/nestjs-conventions/SKILLS.md` — module structure, `userId`-scoped entities, controller-passes-userId-to-service pattern, TypeORM migrations (never `synchronize: true`)
- `.claude/skills/security-review/SKILLS.md` — security checklist this phase's implementation must pass before being considered done

### Research
- `.planning/research/ARCHITECTURE.md` §"Module boundaries" and §"Cross-domain dependency direction" — `Transactions → Categories`, `Budgets → Categories` (read-only, direct service injection); nothing should import from `Categories` the other way
- `.planning/research/PITFALLS.md` §IDOR — every list/get/update/delete must scope by `userId`, return 404 not 403 on mismatch; this phase ships its own dedicated cross-tenant isolation test suite mirroring `test/cross-tenant.e2e-spec.ts`
- `.planning/research/FEATURES.md` — "User-defined categories (income/expense)" feature rationale; confirms `type` is required and categories are user-tailored, not a fixed taxonomy

### Project definition
- `.planning/PROJECT.md` — Core Value, Key Decisions table (soft-delete precedent from Phase 2, established pattern to follow)
- `.planning/REQUIREMENTS.md` — CAT-01, CAT-02 full requirement text

### Phase 2 precedent (closest pattern to mirror, not re-decide)
- `.planning/phases/02-accounts/02-CONTEXT.md` — D-01/D-02/D-03 (balance convention, mutability, soft-delete) — this phase's D-01/D-02 directly parallel Phase 2's D-03/D-02 for the same underlying reason (future FK references from Phase 4/5)
- `src/accounts/accounts.module.ts`, `src/accounts/entities/account.entity.ts` — concrete module/entity structure to mirror for `src/categories/`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `@CurrentUser()` decorator (`src/auth/decorators/current-user.decorator.ts`) — inject the authenticated `userId` into every Categories controller method, same as Accounts; never read `Request` in the service.
- Global `ResponseInterceptor` + `ValidationPipe({whitelist, forbidNonWhitelisted, transform})` + `ClassSerializerInterceptor` (registered as `APP_INTERCEPTOR`/`APP_PIPE` in `AppModule`) — every new controller/DTO gets consistent response envelope and validation for free.
- `JwtAuthGuard` (`src/auth/guards/jwt-auth.guard.ts`) — apply to every Categories route to require authentication.

### Established Patterns
- Domain module layout: `<domain>.module.ts` / `.controller.ts` / `.service.ts` / `dto/` / `entities/` — `src/accounts/` is the closest, most recent reference (simpler than `src/auth/` since Categories has no auth-specific concerns).
- Entity pattern: `@Entity('table_name')`, `@PrimaryGeneratedColumn('uuid')`, snake_case DB columns via `@Column({name: 'snake_case'})`, `@Index()` on `user_id`, `@CreateDateColumn`/`@UpdateDateColumn` — see `src/accounts/entities/account.entity.ts`.
- `deletedAt` soft-delete column pattern already established in `Account` entity — replicate exactly for `Category`.
- TypeORM migrations are hand-generated per change, never `synchronize: true` — `AppModule`'s `TypeOrmModule.forRootAsync` already has `synchronize: false` locked in.
- `CategoriesModule` should `export: [CategoriesService]` (mirroring `AccountsModule`) so Phase 4's `TransactionsModule` and Phase 5's `BudgetsModule` can inject it later without reaching into its repository.

### Integration Points
- `AppModule` imports — add `CategoriesModule` alongside `AuthModule` and `AccountsModule`.
- No changes needed to global guards/interceptors/pipes — they already apply project-wide.

</code_context>

<specifics>
## Specific Ideas

No specific UI/UX or vendor references — this is a JSON API phase, same shape as Phase 1/2. Open to standard NestJS/TypeORM implementation within the decisions above.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Category grouping/templates like "Needs/Wants/Savings" is explicitly a v2/deferred feature per REQUIREMENTS.md FIN-03 — already out of scope, not a new deferred idea from this discussion.)

</deferred>

---

*Phase: 3-Categories*
*Context gathered: 2026-09-13*
