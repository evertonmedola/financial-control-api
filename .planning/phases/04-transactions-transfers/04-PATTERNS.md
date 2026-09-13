# Phase 4: Transactions & Transfers - Pattern Map

**Mapped:** 2026-09-13
**Files analyzed:** 16
**Analogs found:** 16 / 16

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/accounts/accounts.service.ts` (`adjustBalance` implementation) | service | CRUD (balance mutation, locked) | Same file (own stub) + pattern from `src/categories/categories.service.ts`'s `saveOrThrow`-style guarded write | exact (stub already exists) |
| `src/transactions/entities/transaction.entity.ts` | model | CRUD | `src/accounts/entities/account.entity.ts` | exact (decimal column + soft-delete + userId index) |
| `src/transfers/entities/transfer.entity.ts` — **not created** per D-01 (transfer reuses `Transaction` row with `type=TRANSFER`) | n/a | n/a | n/a | no separate entity — D-01 |
| `src/transactions/transactions.module.ts` | config/module | n/a | `src/categories/categories.module.ts` | exact |
| `src/transfers/transfers.module.ts` | config/module | n/a | `src/categories/categories.module.ts` | exact |
| `src/transactions/transactions.controller.ts` | controller | request-response | `src/accounts/accounts.controller.ts` | exact |
| `src/transfers/transfers.controller.ts` | controller | request-response (multi-row atomic write) | `src/accounts/accounts.controller.ts` (route shape) + new locking logic (no in-repo analog) | role-match |
| `src/transactions/transactions.service.ts` | service | CRUD + cross-service validation | `src/categories/categories.service.ts` (ownership pattern) + `src/accounts/accounts.service.ts` (balance-mutation caller) | role-match |
| `src/transfers/transfers.service.ts` | service | CRUD + event-driven-like atomic double mutation | No in-repo analog for `QueryRunner`/pessimistic locking — synthesize from PITFALLS.md Pitfall 2 prescription + `accounts.service.ts`'s method shape | no analog (documented below) |
| `src/transactions/dto/create-transaction.dto.ts` | utility (validation) | request-response | `src/accounts/dto/create-account.dto.ts` (decimal `@Matches` pattern) + `src/categories/dto/create-category.dto.ts` (`@Transform` trim, `@IsEnum`) | exact |
| `src/transactions/dto/update-transaction.dto.ts` | utility (validation) | request-response | `src/accounts/dto/update-account.dto.ts` (locked-field pattern) | exact |
| `src/transfers/dto/create-transfer.dto.ts` | utility (validation) | request-response | `src/accounts/dto/create-account.dto.ts` (decimal `@Matches`) | role-match |
| `src/transactions/dto/transaction-response.dto.ts` | utility (serialization) | request-response | `src/categories/dto/category-response.dto.ts` | exact |
| `src/transfers/dto/transfer-response.dto.ts` | utility (serialization) | request-response | `src/categories/dto/category-response.dto.ts` | exact |
| `src/database/migrations/<ts>-CreateTransactions.ts` | migration | batch/DDL | `src/database/migrations/1789400000000-CreateCategories.ts` | exact |
| `src/app.module.ts` (add `TransactionsModule`/`TransfersModule` imports) | config | n/a | existing `AccountsModule`/`CategoriesModule` registration lines | exact |
| `*.service.spec.ts` for transactions/transfers | test | unit | `src/accounts/accounts.service.spec.ts`, `src/categories/categories.service.spec.ts` | exact |

## Pattern Assignments

### `src/accounts/accounts.service.ts` — implement `adjustBalance`

**Analog:** same file, existing stub (`src/accounts/accounts.service.ts` lines 63-77)

Current reserved signature to fill in:
```typescript
async adjustBalance(
  _userId: string,
  _id: string,
  _delta: string,
): Promise<Account> {
  throw new Error('not implemented until Phase 4');
}
```

**Required real implementation shape** (per CONTEXT.md D-06/D-07 + PITFALLS.md Pitfall 2 — no in-repo `QueryRunner` precedent exists yet, this is the first one):
- Inject `DataSource` (from `typeorm`, config source: `src/database/data-source.ts` lines 9-19 shows the connection-options shape but not runtime DI — use Nest's `@InjectDataSource()` from `@nestjs/typeorm` instead, consistent with `@InjectRepository()` usage seen in every existing service).
- `adjustBalance` itself should accept an already-open `queryRunner`/`EntityManager` as a parameter OR open its own transaction — **TransfersService needs two `adjustBalance` calls inside ONE shared transaction** (both mutations must commit/rollback together), so the cleanest shape consistent with "single write-path" (ARCHITECTURE.md) is:
  ```typescript
  async adjustBalance(
    manager: EntityManager, // caller supplies the EntityManager tied to its own queryRunner transaction
    userId: string,
    id: string,
    delta: string, // decimal string, positive or negative
  ): Promise<Account> {
    const account = await manager.findOne(Account, {
      where: { id, userId, deletedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
    if (!account) throw new NotFoundException();
    account.balance = addDecimalStrings(account.balance, delta); // never parseFloat — Pitfall 1
    return manager.save(account);
  }
  ```
- `TransactionsService.create/remove` opens its own single-account `queryRunner` transaction and calls this with its manager.
- `TransfersService.create/remove` opens ONE `queryRunner` transaction, locks both accounts in ascending-`id` order (Pitfall 2), and calls `adjustBalance` twice with the same manager before committing.
- 404 semantics: keep `findOne`'s existing 404-not-403 IDOR philosophy (`accounts.service.ts` lines 32-40) — reuse `NotFoundException()`, no leaking existence.

**Error handling pattern** — mirror `categories.service.ts`'s `saveOrThrowConflict` structure (lines 82-93) if any unique/FK constraint translation is needed; otherwise the try/rollback/commit pattern belongs to the `QueryRunner` transaction wrapper in `TransactionsService`/`TransfersService`, not inside `adjustBalance` itself.

---

### `src/transactions/entities/transaction.entity.ts`

**Analog:** `src/accounts/entities/account.entity.ts` (full file, lines 1-51)

**Core pattern to copy verbatim (decorator shape, decimal money, soft delete, userId index):**
```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum TransactionType {
  INCOME = 'income',
  EXPENSE = 'expense',
  TRANSFER = 'transfer',
}

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ type: 'enum', enum: TransactionType })
  type!: TransactionType;

  // Pitfall 1: decimal string, never parseFloat'd — identical precedent to
  // Account.balance (account.entity.ts line 38-39).
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount!: string;

  @Column({ name: 'account_id', nullable: true })
  accountId!: string | null; // set for income/expense; null for transfers (use fromAccountId/toAccountId instead)

  @Column({ name: 'from_account_id', nullable: true })
  fromAccountId!: string | null; // D-01: set only for type=TRANSFER

  @Column({ name: 'to_account_id', nullable: true })
  toAccountId!: string | null; // D-01: set only for type=TRANSFER

  @Column({ name: 'category_id', nullable: true })
  categoryId!: string | null; // D-01: null for TRANSFER rows

  @Column()
  description!: string;

  @Column({ type: 'date' })
  date!: string;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
```
Note: D-01 stores a transfer as one row with `fromAccountId`/`toAccountId` populated and `accountId`/`categoryId` null; income/expense rows populate `accountId`/`categoryId` and leave `fromAccountId`/`toAccountId` null. Enforce this mutual-exclusivity at the DTO/service layer (two separate DTOs/endpoints per D-02), not via a DB CHECK constraint unless the planner wants defense-in-depth.

---

### `src/transactions/transactions.module.ts` / `src/transfers/transfers.module.ts`

**Analog:** `src/categories/categories.module.ts` (full file, lines 1-16)

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction]),
    AccountsModule, // for cross-service ownership validation + adjustBalance
    CategoriesModule, // transactions only — validate categoryId ownership
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
```
`TransfersModule` mirrors this but imports only `AccountsModule` (transfers have no category per D-01).

---

### `src/transactions/transactions.controller.ts`

**Analog:** `src/accounts/accounts.controller.ts` (full file, lines 1-71)

**Core pattern (controller-level guard, `@CurrentUser()`, DTO response mapping):**
```typescript
@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  async create(@CurrentUser() userId: string, @Body() dto: CreateTransactionDto) {
    const tx = await this.transactionsService.create(userId, dto);
    return TransactionResponseDto.fromEntity(tx);
  }

  @Get()
  async findAll(@CurrentUser() userId: string) {
    const txs = await this.transactionsService.findAll(userId); // date DESC per D-10
    return txs.map((t) => TransactionResponseDto.fromEntity(t));
  }

  @Patch(':id') // description/date only — D-04
  async update(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: UpdateTransactionDto) { ... }

  @Delete(':id') // reverses balance via adjustBalance before commit — D-06
  async remove(@CurrentUser() userId: string, @Param('id') id: string) { ... return {}; }
}
```
`TransfersController` mirrors this shape but exposes only `POST /transfers` and `DELETE /transfers/:id` (no PATCH, D-05) and its own `CreateTransferDto` with `fromAccountId`/`toAccountId`/`amount`/`date`/`description` (D-02).

---

### `src/transactions/dto/create-transaction.dto.ts`

**Analog:** `src/accounts/dto/create-account.dto.ts` (decimal `@Matches`, lines 27-30) + `src/categories/dto/create-category.dto.ts` (`@Transform` trim + `@IsEnum`, lines 1-22)

```typescript
export class CreateTransactionDto {
  @IsEnum(TransactionType) // restrict to INCOME | EXPENSE only at this endpoint — D-02
  type!: TransactionType;

  @Matches(/^-?\d+(\.\d{1,2})?$/, {
    message: 'amount deve ser uma string decimal com até 2 casas',
  })
  amount!: string;

  @IsUUID()
  accountId!: string;

  @IsUUID()
  categoryId!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description!: string;

  @IsDateString()
  date!: string;
}
```

### `src/transactions/dto/update-transaction.dto.ts`

**Analog:** `src/accounts/dto/update-account.dto.ts` (full file, lines 1-21 — the "lock the risky fields" pattern)

```typescript
export class UpdateTransactionDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsDateString()
  date?: string;
}
```
Global `forbidNonWhitelisted: true` (AppModule, `src/app.module.ts` lines 76-82) already rejects `amount`/`accountId`/`categoryId` in the body with 400 — no manual guard needed, exactly as `UpdateAccountDto`'s comment documents for `balance`/`type`.

### `src/transfers/dto/create-transfer.dto.ts`

**Analog:** `src/accounts/dto/create-account.dto.ts` decimal pattern + new self-transfer validation (no analog — CONTEXT.md discretion, planner's call to reject `fromAccountId === toAccountId` with 400, likely via a class-validator custom decorator or a service-layer check).

```typescript
export class CreateTransferDto {
  @IsUUID()
  fromAccountId!: string;

  @IsUUID()
  toAccountId!: string;

  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'amount deve ser uma string decimal positiva com até 2 casas' })
  amount!: string;

  @IsDateString()
  date!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description!: string;
}
```

### `src/transactions/dto/transaction-response.dto.ts` / `src/transfers/dto/transfer-response.dto.ts`

**Analog:** `src/categories/dto/category-response.dto.ts` (full file, lines 1-25 — explicit field-by-field construction, never spreads entity)

```typescript
export class TransactionResponseDto {
  id!: string;
  type!: TransactionType;
  amount!: string;
  accountId!: string | null;
  fromAccountId!: string | null;
  toAccountId!: string | null;
  categoryId!: string | null;
  description!: string;
  date!: string;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(tx: Transaction): TransactionResponseDto {
    const dto = new TransactionResponseDto();
    dto.id = tx.id;
    dto.type = tx.type;
    dto.amount = tx.amount;
    dto.accountId = tx.accountId;
    dto.fromAccountId = tx.fromAccountId;
    dto.toAccountId = tx.toAccountId;
    dto.categoryId = tx.categoryId;
    dto.description = tx.description;
    dto.date = tx.date;
    dto.createdAt = tx.createdAt;
    dto.updatedAt = tx.updatedAt;
    return dto;
  }
}
```

---

### `src/database/migrations/<ts>-CreateTransactions.ts`

**Analog:** `src/database/migrations/1789400000000-CreateCategories.ts` (full file, lines 1-45)

Copy structure exactly: `CREATE TYPE ... enum`, `CREATE TABLE` with `user_id` FK to `users`, FKs on `account_id`/`from_account_id`/`to_account_id` → `accounts.id`, `category_id` → `categories.id` (all nullable per the mutual-exclusivity note above), leading-`user_id` index (Performance Traps in PITFALLS.md), and a `down()` that drops in reverse order. No unique index needed (unlike categories' `UQ_categories_user_id_name_type`) — transactions have no uniqueness constraint.

---

## Shared Patterns

### Controller-level JWT guard + `@CurrentUser()`
**Source:** `src/accounts/accounts.controller.ts` lines 21-24
**Apply to:** `TransactionsController`, `TransfersController`
```typescript
@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController { ... }
```

### IDOR-safe ownership lookup (404 not 403)
**Source:** `src/accounts/accounts.service.ts` lines 32-40, `src/categories/categories.service.ts` lines 43-51
**Apply to:** every `findOne`/`update`/`remove` in `TransactionsService`/`TransfersService`, and — critically per Pitfall 3's "whole ownership chain" note — every `accountId`/`categoryId`/`fromAccountId`/`toAccountId` referenced by a create/update must be validated via `AccountsService.findOne(userId, id)` / `CategoriesService.findOne(userId, id)` before being persisted, not just the transaction/transfer row's own `userId`.
```typescript
const account = await this.accountsRepository.findOne({
  where: { id, userId, deletedAt: IsNull() },
});
if (!account) throw new NotFoundException();
```

### Soft delete, never hard delete
**Source:** `src/accounts/accounts.service.ts` lines 55-61, `src/categories/categories.service.ts` lines 70-77
**Apply to:** `TransactionsService.remove`, `TransfersService.remove` — but unlike Accounts/Categories, delete here must ALSO reverse the balance effect (D-06) inside the same DB transaction as the soft-delete write, before commit.

### Decimal money handling (never float)
**Source:** `src/accounts/entities/account.entity.ts` lines 35-39, `src/accounts/dto/create-account.dto.ts` lines 21-30
**Apply to:** `Transaction.amount` column + `CreateTransactionDto`/`CreateTransferDto` `amount` field — `decimal` column typed `string`, validated via `@Matches(/^-?\d+(\.\d{1,2})?$/)`, never `@IsNumber()`, never `parseFloat`.

### Locked-field PATCH pattern
**Source:** `src/accounts/dto/update-account.dto.ts` (full file), extended by categories' D-02
**Apply to:** `UpdateTransactionDto` (description/date only, D-04) — relies on global `forbidNonWhitelisted: true` in `src/app.module.ts` lines 76-82 to 400 any extra field automatically.

### Module export for cross-service injection
**Source:** `src/accounts/accounts.module.ts` lines 11-14, `src/categories/categories.module.ts` lines 11-14
**Apply to:** `TransactionsModule` importing `AccountsModule`+`CategoriesModule`; `TransfersModule` importing `AccountsModule` — both already `export: [...Service]`, no repository-reaching needed.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/transfers/transfers.service.ts` (locking logic) | service | multi-row atomic mutation | No existing code uses `QueryRunner`/`DataSource.transaction()`/`pessimistic_write` locking — this phase is the first to need it. Follow PITFALLS.md Pitfall 2's prescription directly: single `QueryRunner` transaction, lock both accounts in ascending-`id` order, call `AccountsService.adjustBalance()` twice with the transaction's `EntityManager`, commit only after both succeed, rollback on any error. Validate the exact TypeORM 1.x `queryRunner.manager.findOne(..., { lock: { mode: 'pessimistic_write' } })` API surface during implementation per STATE.md's flagged blocker — do not trust 0.3.x-era examples/gists (the one found, `gist.github.com/tomfun/...`, is LOW confidence per PITFALLS.md sources and pre-dates TypeORM 1.x). |
| `src/transactions/transactions.service.ts` (self-transfer / decimal-add helper) | utility | transform | No existing decimal-arithmetic helper in the codebase (Accounts/Categories never add two decimal strings). Add a small `addDecimalStrings(a: string, b: string): string` helper — options: `decimal.js`/`big.js` (recommended per PITFALLS.md Pitfall 1) or manual cents-based integer math; do not use `+`/`parseFloat`. |

## Metadata

**Analog search scope:** `src/accounts/`, `src/categories/`, `src/database/migrations/`, `src/app.module.ts`, `.planning/research/PITFALLS.md`
**Files scanned:** 16 source files + PITFALLS.md + CONTEXT.md
**Pattern extraction date:** 2026-09-13
