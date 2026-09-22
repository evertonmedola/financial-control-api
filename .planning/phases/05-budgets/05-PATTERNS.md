# Phase 5: Budgets - Pattern Map

**Mapped:** 2026-09-14
**Files analyzed:** 10 (new/modified)
**Analogs found:** 10 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/budgets/entities/budget.entity.ts` | model | CRUD | `src/categories/entities/category.entity.ts` | exact |
| `src/budgets/budgets.module.ts` | provider/module | request-response | `src/transactions/transactions.module.ts` (cross-module import shape) | exact |
| `src/budgets/budgets.controller.ts` | controller | request-response | `src/categories/categories.controller.ts` | exact |
| `src/budgets/budgets.service.ts` | service | CRUD + aggregation (transform) | `src/categories/categories.service.ts` (CRUD/soft-delete/conflict) + `src/transactions/transactions.service.ts` (cross-service ownership validation, decimal-safe math) | role-match (composite) |
| `src/budgets/dto/create-budget.dto.ts` | DTO/validation | request-response | `src/categories/dto/create-category.dto.ts` | exact |
| `src/budgets/dto/update-budget.dto.ts` | DTO/validation | request-response | `src/categories/dto/update-category.dto.ts` | exact |
| `src/budgets/dto/budget-response.dto.ts` | DTO/serialization | request-response | `src/categories/dto/category-response.dto.ts` | exact |
| `src/budgets/dto/budget-status.dto.ts` (or `budget-summary.dto.ts` for GET consumed/remaining) | DTO/serialization | transform (computed-read) | no exact analog — new "computed" DTO shape; nearest is `budget-response.dto.ts` itself for the `fromEntity`-style construction convention | role-match |
| `src/database/migrations/<ts>-CreateBudgets.ts` | migration | CRUD (DDL) | `src/database/migrations/1789400000000-CreateCategories.ts` | exact |
| `src/budgets/budgets.service.spec.ts` | test | CRUD | `src/categories/categories.service.spec.ts` / `src/transactions/transactions.service.spec.ts` | role-match |

## Pattern Assignments

### `src/budgets/entities/budget.entity.ts` (model, CRUD)

**Analog:** `src/categories/entities/category.entity.ts` (D:/FinancialControl/src/categories/entities/category.entity.ts, entire file, 45 lines — small file, read in full)

Copy the exact shape: `@PrimaryGeneratedColumn('uuid')`, indexed `userId` column via `@Index() @Column({ name: 'user_id' })`, snake_case `@Column({ name: '...' })` mapping, `deletedAt: Date | null` soft-delete column, `@CreateDateColumn`/`@UpdateDateColumn`.

```typescript
@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id' })
  userId!: string;

  @Column()
  name!: string;

  @Column({ type: 'enum', enum: CategoryType })
  type!: CategoryType;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
```

**Budget-specific deltas from this analog:**
- Add `@Column({ name: 'category_id', type: 'uuid' })` — foreign key to `categories.id`. Follow `Transaction.categoryId`'s explicit `type: 'uuid'` requirement (`src/transactions/entities/transaction.entity.ts` lines 53-55) — a plain `string` column needs the explicit type or TypeORM's reflect-metadata inference produces `DataTypeNotSupportedError`.
- Add `@Column({ type: 'decimal', precision: 12, scale: 2 })` for `limit`, mirroring `Transaction.amount` exactly (`src/transactions/entities/transaction.entity.ts` lines 31-34, decimal string, never a JS number — Pitfall 1).
- No `type` enum column needed on Budget itself (D-03's `DESPESA`-only rule is enforced by validating against the referenced `Category.type` in the service, not stored redundantly).
- No `(userId, categoryId, month, year)` fields — per D-01, standing limit only, no period columns.

---

### `src/budgets/dto/create-budget.dto.ts` / `update-budget.dto.ts` (DTO, request-response)

**Analog:** `src/categories/dto/create-category.dto.ts` and `update-category.dto.ts` (both files, full contents above).

Key convention: class-validator decorators directly on public fields, `@Transform` for trimming strings (N/A for budgets — no string fields to trim), explicit doc comments explaining which fields are intentionally *excluded* from Update DTOs (mirrors `UpdateCategoryDto`'s doc-comment explaining why `type` is omitted).

```typescript
// create-category.dto.ts pattern — adapt to Budget's fields:
export class CreateBudgetDto {
  @IsUUID()
  categoryId!: string;

  // Decimal string, never a number — same convention as CreateTransactionDto's
  // amount field validation (Pitfall 1). Check
  // src/transactions/dto/create-transaction.dto.ts for the exact
  // @IsNumberString / regex pattern used for decimal-string amount fields.
  limit!: string;
}
```

Per D-02, `UpdateBudgetDto` DOES include `limit` (unlike `UpdateCategoryDto` excluding `type` or `UpdateTransactionDto` excluding `amount`) — this is a deliberate divergence, document it the same way `UpdateCategoryDto`'s comment documents its own omission, but inverted ("include `limit` — see 05-CONTEXT.md D-02").

**Note:** Read `src/transactions/dto/create-transaction.dto.ts` for the exact decimal-string amount validator (not read in full above; grep it before finalizing the plan) to match `limit`'s validation to `Transaction.amount`'s validation exactly.

---

### `src/budgets/dto/budget-response.dto.ts` (DTO, serialization)

**Analog:** `src/categories/dto/category-response.dto.ts` (full file above).

```typescript
export class CategoryResponseDto {
  id!: string;
  name!: string;
  type!: CategoryType;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(category: Category): CategoryResponseDto {
    const dto = new CategoryResponseDto();
    dto.id = category.id;
    dto.name = category.name;
    dto.type = category.type;
    dto.createdAt = category.createdAt;
    dto.updatedAt = category.updatedAt;
    return dto;
  }
}
```

Apply the same "never spread the entity, construct field-by-field via static `fromEntity`" convention for `BudgetResponseDto` (fields: `id`, `categoryId`, `limit`, `createdAt`, `updatedAt` — no `userId`, no `deletedAt`).

For the GET consumed/remaining shape (D-08: `{ categoryId, limit, spent, remaining, overBudget }`), there is no entity to construct `fromEntity` from — it's a computed aggregate. Use a plain static factory (e.g. `BudgetStatusDto.build(categoryId, limit, spent)`) that internally computes `remaining` and `overBudget` using `src/common/decimal.util.ts`'s exact-cents arithmetic (see Shared Patterns below) rather than any float subtraction/comparison.

---

### `src/budgets/budgets.controller.ts` (controller, request-response)

**Analog:** `src/categories/categories.controller.ts` (full file above, 75 lines).

```typescript
@UseGuards(JwtAuthGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  async create(@CurrentUser() userId: string, @Body() dto: CreateCategoryDto) { ... }

  @Get()
  async findAll(@CurrentUser() userId: string) { ... }

  @Get(':id')
  async findOne(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) { ... }

  @Patch(':id')
  async update(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) { ... }

  @Delete(':id')
  async remove(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<Record<string, never>> {
    await this.categoriesService.remove(userId, id);
    return {};
  }
}
```

Copy directly: controller-level `@UseGuards(JwtAuthGuard)`, `@CurrentUser()` decorator for userId, `ParseUUIDPipe` on `:id` params, empty-object `{}` return on delete, DTO's static `fromEntity` used at the controller boundary (never return raw entities).

Per D-06, the listing endpoint (`GET /budgets`) returns the *computed* `BudgetStatusDto[]` shape (limit/spent/remaining/overBudget), not the raw `BudgetResponseDto[]` — so `findAll`'s return type differs from `CategoriesController.findAll`'s pattern; keep the CRUD routes (`POST`, `PATCH`, `DELETE`, maybe `GET /budgets/:id` for the raw entity) returning `BudgetResponseDto` and add the computed listing as its own method following the same controller-delegates-to-service shape.

---

### `src/budgets/budgets.service.ts` (service, CRUD + aggregation)

**Two analogs, composited:**

1. **CRUD/soft-delete/conflict shape** — `src/categories/categories.service.ts` (full file above, 109 lines):
   - `create()` → `saveOrThrowConflict()` private helper translating Postgres 23505 + specific constraint name into `ConflictException` (lines 82-93, 95-108). Reuse this exact pattern for the `(user_id, category_id) WHERE deleted_at IS NULL` unique index (D-07/discretion note), matching against the new migration's constraint name (e.g. `UQ_budgets_user_id_category_id`).
   - `findOne()` → 404-not-403 ownership check via `where: { id, userId, deletedAt: IsNull() }` (lines 43-51) — directly reusable for `findOne(userId, budgetId)`.
   - `remove()` → soft-delete only, never `.delete()`/`.remove()` (lines 73-77).
   - `update()` → `findOne` then `Object.assign` then `saveOrThrowConflict` (lines 60-68) — reusable for D-02's editable `limit`.

2. **Cross-service ownership validation + decimal-safe math** — `src/transactions/transactions.service.ts` (full file above, 184 lines):
   - Constructor injection of `CategoriesService` (and here, additionally `TransactionsService` or direct `@InjectRepository(Transaction)` per the discretion note in CONTEXT.md) — lines 11-20.
   - `create()` validates `dto.categoryId` ownership via `await this.categoriesService.findOne(userId, dto.categoryId)` BEFORE any write (line 35) — reuse identically for Budget creation, then add the D-03 `type === DESPESA` check on the returned category (throw `BadRequestException` if not).
   - Decimal-safe arithmetic: import from `src/common/decimal.util.ts` (`addDecimalStrings`, `negateDecimalString`, `isWithinDecimalRange`) — never `parseFloat`/`Number()`/unary `+` on money strings (see Shared Patterns).

**New aggregation pattern (no direct analog exists yet in this codebase — this is the first read-side aggregation query in the project):**

Use TypeORM's `QueryBuilder` with `.select('SUM(transaction.amount)', 'total')`, `.where('transaction.userId = :userId', ...)`, `.andWhere('transaction.categoryId IN (:...categoryIds)', ...)`, `.andWhere('transaction.type != :transferType', { transferType: TransactionType.TRANSFER })`, `.andWhere('transaction.date BETWEEN :start AND :end', ...)`, `.andWhere('transaction.deletedAt IS NULL')`, `.groupBy('transaction.categoryId')` — single grouped query per PITFALLS.md line 224 (avoid N+1). Inject via `@InjectRepository(Transaction)` directly in `BudgetsService` (read-only cross-entity query, not going through `TransactionsService`'s write-oriented methods) OR add a dedicated read method to `TransactionsService` and call that — CONTEXT.md leaves this choice to the planner; either is consistent with `ARCHITECTURE.md`'s "Budgets → Transactions read-only" boundary as long as `BudgetsModule` never imports `Transaction`'s repository without going through `TransactionsModule`'s export.

**Zero-transaction categories:** when a budgeted category has no matching aggregation row, `spent` must default to `"0.00"` (a decimal string), never `null`/`undefined`/`NaN` — closes PITFALLS.md Pitfall 4's divide-by-zero/undefined edge case.

**Calendar-month boundaries (D-05):** compute `[firstOfMonth, lastOfMonth]` from `new Date()` at request time using UTC or a fixed convention — check `Transaction.date`'s column type (`{ type: 'date' }`, stored as a bare SQL `date`, no timezone component — see `src/transactions/entities/transaction.entity.ts` line 60-61) and keep boundary computation consistent with that (bare date-string comparison, not a `timestamp` comparison), avoiding the timezone-shift bug PITFALLS.md Pitfall 4 flags.

---

### `src/budgets/budgets.module.ts` (module)

**Analog:** `src/transactions/transactions.module.ts` (full file above, 28 lines) — this is the best match because Budgets, like Transactions, imports multiple other modules for read-only cross-service access.

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction]),
    AccountsModule,
    CategoriesModule,
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
```

For `BudgetsModule`: `imports: [TypeOrmModule.forFeature([Budget, Transaction]), CategoriesModule]` (import `TransactionsModule` instead of registering `Transaction` again if the aggregation query goes through an exported `TransactionsService` method — planner's call per the discretion note above). Per D-41/ARCHITECTURE.md, `BudgetsModule` must NOT be imported by `CategoriesModule`/`TransactionsModule`/`AccountsModule` — only `AppModule` imports it, mirroring how nothing currently imports `TransactionsModule` except `AppModule`.

---

### `src/database/migrations/<ts>-CreateBudgets.ts` (migration, DDL)

**Analog:** `src/database/migrations/1789400000000-CreateCategories.ts` (full file above, 45 lines) — closest because it has the exact partial-unique-index pattern D-07/discretion note requires.

```typescript
await queryRunner.query(
  `CREATE TABLE "categories" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL,
    ...
    "deleted_at" TIMESTAMP,
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT "PK_categories_id" PRIMARY KEY ("id"),
    CONSTRAINT "FK_categories_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
  )`,
);
await queryRunner.query(
  `CREATE INDEX "IDX_categories_user_id" ON "categories" ("user_id")`,
);
await queryRunner.query(
  `CREATE UNIQUE INDEX "UQ_categories_user_id_name_type" ON "categories" ("user_id", "name", "type") WHERE "deleted_at" IS NULL`,
);
```

For Budgets: add `FK_budgets_category_id` referencing `categories(id)` — decide `ON DELETE` behavior (likely `RESTRICT`, matching `FK_transactions_category_id` in `src/database/migrations/1789500000000-CreateTransactions.ts` line 30, since Categories has no cascade-delete precedent for its dependents), a `limit` column as `numeric(12,2) NOT NULL` (matching `Transaction.amount`'s migration DDL, `1789500000000-CreateTransactions.ts` line 15), `IDX_budgets_user_id`, and `UQ_budgets_user_id_category_id ON (user_id, category_id) WHERE deleted_at IS NULL` (the D-07/discretion-note mechanism, structurally identical to `UQ_categories_user_id_name_type`).

---

### `src/budgets/budgets.service.spec.ts` (test)

**Analog:** `src/categories/categories.service.spec.ts` for CRUD/conflict/soft-delete test shape; `src/transactions/transactions.service.spec.ts` for cross-service-mock and decimal-string assertion conventions. (Not read in full in this pass — read both before writing tests; they were not required-reading for pattern mapping but are the natural test analogs given the service composite above.)

---

## Shared Patterns

### Auth Guard
**Source:** `src/categories/categories.controller.ts` line 22 (`@UseGuards(JwtAuthGuard)` at controller level, not per-route)
**Apply to:** `budgets.controller.ts` — identical controller-level guard placement.

### Current-user injection
**Source:** `src/categories/categories.controller.ts` (`@CurrentUser() userId: string` param on every method)
**Apply to:** every `BudgetsController` method and every `BudgetsService` method's first parameter.

### Ownership check / IDOR mitigation (Pitfall 3)
**Source:** `src/categories/categories.service.ts` lines 43-51 (`findOne` — 404 not 403, `where: { id, userId, deletedAt: IsNull() }`)
**Apply to:** `BudgetsService.findOne`, and `BudgetsService.create`'s `categoryId` ownership check via `CategoriesService.findOne(userId, dto.categoryId)` (pattern at `src/transactions/transactions.service.ts` line 35).

### Decimal-safe money (Pitfall 1)
**Source:** `src/common/decimal.util.ts` (full file above — `addDecimalStrings`, `negateDecimalString`, `isWithinDecimalRange`, all BigInt-cents based)
**Apply to:** `limit`, `spent`, `remaining` fields everywhere in Budgets — `remaining` computation must use decimal-string subtraction (add a `subtractDecimalStrings` helper to `decimal.util.ts` if one doesn't exist yet — check the file's exports before assuming `addDecimalStrings(limit, negateDecimalString(spent))` is the intended call shape, since no direct subtract function exists in the current file). `overBudget` must be derived by comparing BigInt cents (via the same `toCents`-style approach), never by comparing two `parseFloat`'d numbers.

### Postgres unique-violation → 409 translation
**Source:** `src/categories/categories.service.ts` lines 82-108 (`saveOrThrowConflict` + `isUniqueViolation` checking both `code === '23505'` AND the specific `constraint` name)
**Apply to:** `BudgetsService.create`/`update`, matching against the new `UQ_budgets_user_id_category_id` constraint name.

### Soft-delete convention
**Source:** `src/categories/categories.entity.ts` `deletedAt` column + `src/categories/categories.service.ts` lines 73-77 (`remove()` sets `deletedAt = new Date()`, saves — never `.delete()`)
**Apply to:** `Budget` entity and `BudgetsService.remove`.

### Module cross-injection (read-only dependency direction)
**Source:** `src/transactions/transactions.module.ts` (imports `AccountsModule` + `CategoriesModule`, exports own service)
**Apply to:** `BudgetsModule` — imports `CategoriesModule` (+ `TransactionsModule` or its own `Transaction` repository registration per the aggregation-query discretion note), exported service never imported back by Categories/Transactions/Accounts (ARCHITECTURE.md dependency direction).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Grouped `SUM(...) GROUP BY category_id` aggregation query (inside `budgets.service.ts`) | service (query) | batch/transform | This is the first read-side SQL aggregation in the codebase — Phases 1-4 are pure CRUD with no `GROUP BY`/`SUM`. Use TypeORM `QueryBuilder` directly; no existing file to copy the query-builder shape from. Follow PITFALLS.md line 224's explicit guidance (single grouped query, not N+1) since no in-repo precedent exists. |
| `src/budgets/dto/budget-status.dto.ts` (computed consumed/remaining shape) | DTO | transform | No existing DTO in the codebase is built from an aggregate/computed value rather than a single entity — closest is `CategoryResponseDto`'s `fromEntity` static-factory *convention*, but the computation logic itself (remaining/overBudget) has no analog. |

## Metadata

**Analog search scope:** `src/categories/`, `src/transactions/`, `src/accounts/`, `src/common/`, `src/database/migrations/`
**Files scanned:** 14 (7 read in full, 3 partially/referenced by grep, 4 directory listings)
**Pattern extraction date:** 2026-09-14
