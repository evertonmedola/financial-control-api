# Phase 3: Categories - Pattern Map

**Mapped:** 2026-09-13
**Files analyzed:** 11
**Analogs found:** 11 / 11

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/categories/entities/category.entity.ts` | model | CRUD | `src/accounts/entities/account.entity.ts` | exact |
| `src/categories/dto/create-category.dto.ts` | utility (DTO) | request-response | `src/accounts/dto/create-account.dto.ts` | exact |
| `src/categories/dto/update-category.dto.ts` | utility (DTO) | request-response | `src/accounts/dto/update-account.dto.ts` | exact |
| `src/categories/dto/category-response.dto.ts` | utility (DTO) | request-response | `src/accounts/dto/account-response.dto.ts` | exact |
| `src/categories/categories.service.ts` | service | CRUD | `src/accounts/accounts.service.ts` | exact |
| `src/categories/categories.controller.ts` | controller | request-response | `src/accounts/accounts.controller.ts` | exact |
| `src/categories/categories.module.ts` | module/config | request-response | `src/accounts/accounts.module.ts` | exact |
| `src/database/migrations/<timestamp>-CreateCategories.ts` | migration | batch | `src/database/migrations/1789300000000-CreateAccounts.ts` | exact |
| `src/categories/categories.service.spec.ts` | test | CRUD | `src/accounts/accounts.service.spec.ts` | exact |
| `test/categories.e2e-spec.ts` | test | request-response | `test/accounts.e2e-spec.ts` | exact |
| `test/categories-cross-tenant.e2e-spec.ts` | test | request-response | `test/accounts-cross-tenant.e2e-spec.ts` | exact |
| `src/app.module.ts` (modified: register `CategoriesModule`) | config | — | existing `AccountsModule` import line | exact |

## Pattern Assignments

### `src/categories/entities/category.entity.ts` (model, CRUD)

**Analog:** `src/accounts/entities/account.entity.ts` (full file, 51 lines)

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AccountType {
  CORRENTE = 'corrente',
  POUPANCA = 'poupanca',
  CARTEIRA = 'carteira',
  CARTAO_CREDITO = 'cartao_credito',
}

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id' })
  userId!: string;

  @Column()
  name!: string;

  @Column({ type: 'enum', enum: AccountType })
  type!: AccountType;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  balance!: string;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
```

**Adaptation for `Category`:**
- Rename `AccountType` -> `CategoryType` with values `RECEITA = 'receita'`, `DESPESA = 'despesa'` (D-01/D-02 of 03-CONTEXT.md — this is the `type` field, immutable after creation, matching `Account.type`'s existing immutability precedent (Phase 2 D-02) — no new pattern needed, just reuse the "enum column, never edited via PATCH" convention already established).
- Drop `balance` entirely — no money concept in Categories.
- Keep `@Index()` on `user_id` — same tenant-scoping rationale (IDOR / ARCHITECTURE.md composite-index guidance).
- Keep `deletedAt` column verbatim — D-01 of 03-CONTEXT.md explicitly mirrors Account's soft-delete (Phase 2 D-03).
- D-03 (composite unique `userId + name + type`, partial index excluding soft-deleted rows) has **no existing analog** in Account — this is new. Implement as a DB-level partial unique index in the migration (see migration section below); no entity-level `@Unique()` decorator is used elsewhere in this codebase for partial (filtered) uniqueness, so express it purely in the migration SQL, matching how `IDX_accounts_user_id` is hand-written SQL rather than a decorator.

---

### `src/categories/dto/create-category.dto.ts` (DTO, request-response)

**Analog:** `src/accounts/dto/create-account.dto.ts` (full file, 31 lines)

```typescript
import {
  IsEnum,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AccountType } from '../entities/account.entity';

export class CreateAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsEnum(AccountType)
  type!: AccountType;

  @Matches(/^-?\d+(\.\d{1,2})?$/, {
    message: 'balance deve ser uma string decimal com até 2 casas',
  })
  balance!: string;
}
```

**Adaptation:** Keep `name` (`@IsString @MinLength(1) @MaxLength(100)`) and `type` (`@IsEnum(CategoryType)`) fields verbatim. Drop the `balance`/`@Matches` block entirely — Categories has no money field. `CreateCategoryDto` ends up as just `name` + `type`, both required (CAT-01: type is required at creation).

---

### `src/categories/dto/update-category.dto.ts` (DTO, request-response)

**Analog:** `src/accounts/dto/update-account.dto.ts` (full file, 22 lines)

```typescript
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;
}
```

**Adaptation:** Copy verbatim structure — `UpdateCategoryDto` has only optional `name`. This is a direct, near-identical copy: D-02 of 03-CONTEXT.md ("`type` locked against direct edits via PATCH") is the exact same rule as Account's D-02 ("balance/type locked"). Reuse the same doc-comment pattern explaining why `type` is intentionally omitted (global `forbidNonWhitelisted: true` already rejects any `type` field in the body with 400 — no manual guard needed, exactly as noted in the Account analog's comment).

---

### `src/categories/dto/category-response.dto.ts` (DTO, request-response)

**Analog:** `src/accounts/dto/account-response.dto.ts` (full file, 27 lines)

```typescript
import { Account, AccountType } from '../entities/account.entity';

export class AccountResponseDto {
  id!: string;
  name!: string;
  type!: AccountType;
  balance!: string;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(account: Account): AccountResponseDto {
    const dto = new AccountResponseDto();
    dto.id = account.id;
    dto.name = account.name;
    dto.type = account.type;
    dto.balance = account.balance;
    dto.createdAt = account.createdAt;
    dto.updatedAt = account.updatedAt;
    return dto;
  }
}
```

**Adaptation:** Same explicit field-by-field `fromEntity()` static factory pattern (never spreads the entity, so `deletedAt` never leaks) — drop `balance`, keep `id`, `name`, `type`, `createdAt`, `updatedAt`.

---

### `src/categories/categories.service.ts` (service, CRUD)

**Analog:** `src/accounts/accounts.service.ts` (full file, 78 lines)

**Imports pattern** (lines 1-6):
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { Account } from './entities/account.entity';
```

**Core CRUD + soft-delete + IDOR pattern** (lines 15-61):
```typescript
async create(userId: string, dto: CreateAccountDto): Promise<Account> {
  const account = this.accountsRepository.create({ ...dto, userId });
  return this.accountsRepository.save(account);
}

async findAll(userId: string): Promise<Account[]> {
  return this.accountsRepository.find({
    where: { userId, deletedAt: IsNull() },
    order: { createdAt: 'ASC' },
  });
}

// 404, never 403, when the account doesn't exist or belongs to another
// user — mirrors AuthService's generic-error philosophy applied to
// ownership checks (Pitfall 3, IDOR).
async findOne(userId: string, id: string): Promise<Account> {
  const account = await this.accountsRepository.findOne({
    where: { id, userId, deletedAt: IsNull() },
  });
  if (!account) {
    throw new NotFoundException();
  }
  return account;
}

async update(
  userId: string,
  id: string,
  dto: UpdateAccountDto,
): Promise<Account> {
  const account = await this.findOne(userId, id);
  Object.assign(account, dto);
  return this.accountsRepository.save(account);
}

// D-03: soft delete only. Never .delete()/.remove() on the repository.
async remove(userId: string, id: string): Promise<void> {
  const account = await this.findOne(userId, id);
  account.deletedAt = new Date();
  await this.accountsRepository.save(account);
}
```

**Adaptation:** `CategoriesService.create/findAll/findOne/update/remove` follow this exact shape 1:1 — same `IsNull()` filter, same `order: { createdAt: 'ASC' }`, same 404-not-403 ownership check via `findOne`, same soft-delete-via-save (never `.delete()`). No `adjustBalance`-equivalent stub is needed (Categories has no analog to balance mutation). New concern not present in Account: **duplicate-name conflict (D-03)** — when `create()` violates the partial unique index, catch the Postgres unique-violation error (`error.code === '23505'`) and rethrow as `ConflictException` (409, per Claude's Discretion in CONTEXT.md — no existing controller in this codebase yet handles a 409 case, so this is a new pattern to introduce, but the try/catch-and-rethrow shape should mirror the `NotFoundException` throw style already used in `findOne`).

---

### `src/categories/categories.controller.ts` (controller, request-response)

**Analog:** `src/accounts/accounts.controller.ts` (full file, 71 lines)

**Full pattern** (guard placement, `@CurrentUser()`, response-DTO mapping, empty-object delete response):
```typescript
@UseGuards(JwtAuthGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  async create(
    @CurrentUser() userId: string,
    @Body() dto: CreateAccountDto,
  ): Promise<AccountResponseDto> {
    const account = await this.accountsService.create(userId, dto);
    return AccountResponseDto.fromEntity(account);
  }

  @Get()
  async findAll(@CurrentUser() userId: string): Promise<AccountResponseDto[]> {
    const accounts = await this.accountsService.findAll(userId);
    return accounts.map((account) => AccountResponseDto.fromEntity(account));
  }

  @Get(':id')
  async findOne(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ): Promise<AccountResponseDto> { /* ... */ }

  @Patch(':id')
  async update(/* ... */): Promise<AccountResponseDto> { /* ... */ }

  @Delete(':id')
  async remove(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ): Promise<Record<string, never>> {
    await this.accountsService.remove(userId, id);
    return {};
  }
}
```

**Adaptation:** Copy 1:1, renaming `accounts` -> `categories`, `AccountsService` -> `CategoriesService`, DTOs accordingly. Guard applied at controller level (`@UseGuards(JwtAuthGuard)`), not per-route — same deliberate deviation noted in the Accounts analog comment.

---

### `src/categories/categories.module.ts` (module/config)

**Analog:** `src/accounts/accounts.module.ts` (full file, 16 lines)

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { Account } from './entities/account.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Account])],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
```

**Adaptation:** Copy 1:1. `exports: [CategoriesService]` is required — CONTEXT.md explicitly states Phase 4's `TransactionsModule` and Phase 5's `BudgetsModule` will inject `CategoriesService` directly (same cross-domain pattern as `AccountsService`).

---

### `src/database/migrations/<timestamp>-CreateCategories.ts` (migration, batch)

**Analog:** `src/database/migrations/1789300000000-CreateAccounts.ts` (full file, 37 lines)

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccounts1789300000000 implements MigrationInterface {
  name = 'CreateAccounts1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."accounts_type_enum" AS ENUM('corrente', 'poupanca', 'carteira', 'cartao_credito')`,
    );
    await queryRunner.query(
      `CREATE TABLE "accounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "name" character varying NOT NULL,
        "type" "public"."accounts_type_enum" NOT NULL,
        "balance" numeric(12,2) NOT NULL,
        "deleted_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_accounts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_accounts_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_accounts_user_id" ON "accounts" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_accounts_user_id"`);
    await queryRunner.query(`DROP TABLE "accounts"`);
    await queryRunner.query(`DROP TYPE "public"."accounts_type_enum"`);
  }
}
```

**Adaptation:**
- Rename table to `categories`, enum type to `categories_type_enum` with values `('receita', 'despesa')`.
- No `balance` column.
- Keep `deleted_at`, `created_at`, `updated_at`, `user_id` + FK to `users(id) ON DELETE CASCADE`, and the `IDX_categories_user_id` index — same as Accounts.
- **New, no analog:** D-03's composite partial unique index. Recommended per CONTEXT.md's discretion (partial index excluding soft-deleted rows so deleting+recreating a same-named category isn't blocked):
```sql
CREATE UNIQUE INDEX "UQ_categories_user_id_name_type"
  ON "categories" ("user_id", "name", "type")
  WHERE "deleted_at" IS NULL
```
  Add the matching `DROP INDEX` in `down()`. This SQL pattern (raw `queryRunner.query` for indexes) directly follows the existing convention already used for `IDX_accounts_user_id` — just extend it with a `WHERE` clause, which is standard Postgres partial-index syntax and requires no new migration idiom beyond what's already in the codebase.

---

### `src/categories/categories.service.spec.ts` (test, CRUD)

**Analog:** `src/accounts/accounts.service.spec.ts` (partial read, lines 1-60; pattern is representative of the whole file)

```typescript
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { Account, AccountType } from './entities/account.entity';

describe('AccountsService', () => {
  let service: AccountsService;
  let accountsRepository: jest.Mocked<Repository<Account>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        {
          provide: getRepositoryToken(Account),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            delete: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AccountsService>(AccountsService);
    accountsRepository = module.get(getRepositoryToken(Account));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('merges userId into the DTO and persists the account via the repository (happy path)', async () => {
      // ...mock repository.create/save, assert call args and returned entity
    });
  });
});
```

**Adaptation:** Mock-repository test scaffold copies 1:1 (`getRepositoryToken(Category)`, same jest.fn() surface). Add a new test case not present in Accounts: `create()` rethrowing a Postgres `23505` unique-violation as `ConflictException` (D-03 duplicate name/type per user) — no existing analog for this specific case, model it after the existing `findOne` -> `NotFoundException` throw-and-assert pattern in the same file.

---

### `test/categories.e2e-spec.ts` and `test/categories-cross-tenant.e2e-spec.ts` (test, request-response)

**Analogs:** `test/accounts.e2e-spec.ts` and `test/accounts-cross-tenant.e2e-spec.ts`

**Cross-tenant suite scaffold** (`test/accounts-cross-tenant.e2e-spec.ts`, lines 1-60):
```typescript
import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const noopThrottlerGuard: CanActivate = { canActivate: () => true };

describe('Accounts cross-tenant isolation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerGuard)
      .useValue(noopThrottlerGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });
  // ... two-user setup, assert every GET/PATCH/DELETE /accounts/:id returns
  // 404 (never 403/200) for a foreign id, and GET /accounts never leaks
  // another tenant's ids.
});
```

**Adaptation:** Copy both files' structure 1:1, renaming `accounts` -> `categories` and the request bodies to `{ name, type }` (drop `balance`). CONTEXT.md explicitly requires this phase to "ship its own dedicated cross-tenant isolation test suite mirroring `test/cross-tenant.e2e-spec.ts`" (via the Accounts precedent). Add one assertion not present in Accounts: POST duplicate `(name, type)` for the same user returns 409 (D-03), and POST with the same `name` but different `type`, or a soft-deleted-then-recreated name, succeeds (verifying the partial index).

---

### `src/app.module.ts` (config, modified)

**Analog:** existing `AccountsModule` import/registration line in the same file.

**Adaptation:** Add `import { CategoriesModule } from './categories/categories.module';` and include `CategoriesModule` in the `imports` array alongside `AuthModule` and `AccountsModule` — no new pattern, straight copy of the existing registration line.

## Shared Patterns

### Authentication Guard
**Source:** `src/auth/guards/jwt-auth.guard.ts`, applied via `@UseGuards(JwtAuthGuard)` at controller level in `src/accounts/accounts.controller.ts` line 21.
**Apply to:** `src/categories/categories.controller.ts` (entire controller).

### Current-user injection
**Source:** `src/auth/decorators/current-user.decorator.ts`, used throughout `AccountsController`.
**Apply to:** Every `CategoriesController` handler — never read `Request` directly in the service; `userId` always flows in via `@CurrentUser()` in the controller and is passed explicitly to the service method.

### Tenant-scoped 404-not-403 (IDOR mitigation)
**Source:** `AccountsService.findOne()` (`src/accounts/accounts.service.ts` lines 32-40).
**Apply to:** `CategoriesService.findOne/update/remove` — always filter by `{ id, userId, deletedAt: IsNull() }` and throw `NotFoundException` (never `ForbiddenException`) on a cross-tenant or missing id.

### Soft delete
**Source:** `AccountsService.remove()` (`src/accounts/accounts.service.ts` lines 57-61) and the `deletedAt` column in `Account` entity.
**Apply to:** `Category` entity + `CategoriesService.remove()` — set `deletedAt = new Date()` and `save()`, never call repository `.delete()`/`.remove()`.

### Response DTO field-by-field mapping (no entity spreading)
**Source:** `AccountResponseDto.fromEntity()` (`src/accounts/dto/account-response.dto.ts`).
**Apply to:** `CategoryResponseDto` — explicit static factory, never `{ ...entity }`, so `deletedAt`/`userId` never leak into API responses.

### Global validation/response envelope (no new code needed)
**Source:** `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` + `ResponseInterceptor` + `ClassSerializerInterceptor`, registered as `APP_PIPE`/`APP_INTERCEPTOR` in `AppModule`.
**Apply to:** All Categories DTOs/controllers automatically — no per-module wiring required, same as Accounts.

## No Analog Found

| File/Concern | Role | Data Flow | Reason |
|---|---|---|---|
| Partial unique index (D-03: `user_id, name, type` where `deleted_at IS NULL`) | migration | batch | Accounts has no uniqueness constraint beyond the primary key; this is a new SQL pattern (Postgres partial index) not yet used anywhere in `src/database/migrations/`, though it follows the same raw-`queryRunner.query` idiom already established. |
| Duplicate-name conflict handling (409) | service/controller | request-response | No existing controller/service in the codebase currently throws or handles a `ConflictException`/409 — this is new; model the throw style after `NotFoundException` in `AccountsService.findOne()`. |

## Metadata

**Analog search scope:** `src/accounts/`, `src/database/migrations/`, `test/accounts*.e2e-spec.ts`, `src/app.module.ts`
**Files scanned:** 11 (8 source files under `src/accounts/`, 1 migration, 2 e2e test files) plus `src/app.module.ts` for registration pattern
**Pattern extraction date:** 2026-09-13
