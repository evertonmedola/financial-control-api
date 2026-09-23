# Phase 2: Accounts - Pattern Map

**Mapped:** 2026-09-12
**Files analyzed:** 9
**Analogs found:** 9 / 9

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/accounts/entities/account.entity.ts` | model | CRUD | `src/auth/entities/user.entity.ts` | exact |
| `src/accounts/dto/create-account.dto.ts` | validation/DTO | request-response | `src/auth/dto/register.dto.ts` | exact |
| `src/accounts/dto/update-account.dto.ts` | validation/DTO | request-response | `src/auth/dto/register.dto.ts` | role-match |
| `src/accounts/dto/account-response.dto.ts` | DTO (serialization) | transform | `src/auth/dto/user-response.dto.ts` | exact |
| `src/accounts/accounts.service.ts` | service | CRUD | `src/auth/auth.service.ts` (findById/register CRUD parts) | role-match |
| `src/accounts/accounts.controller.ts` | controller | request-response | `src/auth/auth.controller.ts` | exact |
| `src/accounts/accounts.module.ts` | module/config | wiring | `src/auth/auth.module.ts` | exact |
| `src/database/migrations/<ts>-CreateAccounts.ts` | migration | batch/DDL | `src/database/migrations/1789166140074-InitUsers.ts` | exact |
| `test/cross-tenant.e2e-spec.ts` (extend) | test | request-response | existing `test/cross-tenant.e2e-spec.ts` (Phase 1) | exact |

## Pattern Assignments

### `src/accounts/entities/account.entity.ts` (model, CRUD)

**Analog:** `src/auth/entities/user.entity.ts` (full file, lines 1-29)

**Full pattern to mirror:**
```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

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
  type!: AccountType; // 'corrente' | 'poupanca' | 'carteira' | 'cartao_credito'

  // Pitfall 1 (PITFALLS.md): numeric/decimal, never float/double, never
  // parseFloat'd in app code. Returned as string by pg/TypeORM — keep it a
  // string through DTOs unless a decimal library is introduced project-wide.
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

Notes:
- `User` entity has no `userId` FK (it IS the tenant root); `Account` does — add `@Index()` on `userId` per ARCHITECTURE.md's `(userId, ...)` composite-index guidance for tenant-scoped tables (PITFALLS.md Performance Traps).
- `deletedAt` column implements D-03 (soft delete) — no analog in `User` entity; this is new but follows the same `@Column({ name: 'snake_case', nullable: true })` convention already used for `passwordHash`/`createdAt`.
- No `@Exclude()` needed (balance/type aren't secrets), unlike `User.passwordHash`.

---

### `src/accounts/dto/create-account.dto.ts` (validation/DTO, request-response)

**Analog:** `src/auth/dto/register.dto.ts` (full file, lines 1-11)

**Imports + validation pattern:**
```typescript
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsEnum(AccountType)
  type!: AccountType;

  // D-01/Pitfall 1: validate money as a decimal string, not @IsNumber().
  // No @IsOptional — ACCT-01 requires initial balance at creation.
  @Matches(/^-?\d+(\.\d{1,2})?$/, {
    message: 'balance must be a decimal string with up to 2 places',
  })
  balance!: string;
}
```

Discretion note (CONTEXT.md): allow negative `balance` at creation for non-credit-card types — the `Matches` regex above permits an optional leading `-`; service-layer/DTO-level business rule (if any type restriction is added) goes in `AccountsService`, not the DTO.

---

### `src/accounts/dto/update-account.dto.ts` (validation/DTO, request-response)

**Analog:** `src/auth/dto/register.dto.ts` structure (partial-update variant — no direct Phase 1 analog since auth has no PATCH; pattern is standard NestJS `PartialType` omission)

```typescript
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;

  // D-02: balance is intentionally NOT a field here — PATCH must never
  // accept it. Global ValidationPipe's forbidNonWhitelisted:true (app.module.ts)
  // rejects any request body that includes `balance` with a 400, for free.
}
```

---

### `src/accounts/dto/account-response.dto.ts` (DTO/serialization, transform)

**Analog:** `src/auth/dto/user-response.dto.ts` (full file, lines 1-21)

```typescript
import { Account } from '../entities/account.entity';

/**
 * Explicit-construction response DTO, mirroring UserResponseDto — never
 * spreads the entity directly (avoids leaking internal columns like
 * deletedAt on active-record list/get responses if not desired).
 */
export class AccountResponseDto {
  id!: string;
  name!: string;
  type!: string;
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

---

### `src/accounts/accounts.service.ts` (service, CRUD)

**Analog:** `src/auth/auth.service.ts` — specifically the constructor injection pattern (lines 37-44), `register()` (lines 46-63) for the create-with-repository-error-handling shape, and `findById()` (lines 83-93) for the userId-scoped-or-404 shape.

**Constructor + injection pattern** (mirrors lines 35-44):
```typescript
@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
  ) {}
```

**Core CRUD pattern — every read/write scoped by userId** (Pitfall 3, IDOR):
```typescript
async findAll(userId: string): Promise<Account[]> {
  return this.accountsRepository.find({
    where: { userId, deletedAt: IsNull() },
  });
}

async findOne(userId: string, id: string): Promise<Account> {
  const account = await this.accountsRepository.findOne({
    where: { id, userId, deletedAt: IsNull() },
  });
  if (!account) {
    throw new NotFoundException(); // 404, not 403 — mirrors auth.service.ts's
    // generic-error philosophy (GENERIC_AUTH_ERROR) applied to ownership checks
  }
  return account;
}

async create(userId: string, dto: CreateAccountDto): Promise<Account> {
  const account = this.accountsRepository.create({ ...dto, userId });
  return this.accountsRepository.save(account);
}

async update(userId: string, id: string, dto: UpdateAccountDto): Promise<Account> {
  const account = await this.findOne(userId, id); // ownership check first
  Object.assign(account, dto); // dto never carries `balance` (D-02, enforced upstream)
  return this.accountsRepository.save(account);
}

async remove(userId: string, id: string): Promise<void> {
  const account = await this.findOne(userId, id);
  account.deletedAt = new Date(); // D-03: soft delete, never .delete()/.remove()
  await this.accountsRepository.save(account);
}
```

**Balance mutation gate (ARCHITECTURE.md — single write-path):**
```typescript
// The only method Phase 4's TransactionsService will ever call to change
// balance. Not exposed via any controller route in this phase.
async adjustBalance(userId: string, id: string, delta: string): Promise<Account> {
  // Phase 4 concern: wrap in transaction + pessimistic lock per PITFALLS.md
  // Pitfall 2 once this is actually invoked from TransactionsService.
  throw new Error('not implemented until Phase 4');
}
```

---

### `src/accounts/accounts.controller.ts` (controller, request-response)

**Analog:** `src/auth/auth.controller.ts` (full file, lines 1-71) — specifically the `@CurrentUser()` + guard pattern on `me()` (lines 48-53).

**Imports pattern** (mirrors lines 1-20):
```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { AccountResponseDto } from './dto/account-response.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
```

**Core pattern — guard + CurrentUser on every route** (mirrors `me()`, lines 48-53):
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
    return accounts.map(AccountResponseDto.fromEntity);
  }

  @Get(':id')
  async findOne(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ): Promise<AccountResponseDto> {
    const account = await this.accountsService.findOne(userId, id);
    return AccountResponseDto.fromEntity(account);
  }

  @Patch(':id')
  async update(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ): Promise<AccountResponseDto> {
    const account = await this.accountsService.update(userId, id, dto);
    return AccountResponseDto.fromEntity(account);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.accountsService.remove(userId, id);
  }
}
```

Note: unlike `AuthController`, guard is applied at controller level (`@UseGuards(JwtAuthGuard)` above `@Controller`) rather than per-route, since every Accounts route requires auth (no public register/login-equivalent exists in this module) — this is a deliberate, small deviation from the exact per-route pattern in `auth.controller.ts`, still using the same guard/decorator primitives.

---

### `src/accounts/accounts.module.ts` (module/config, wiring)

**Analog:** `src/auth/auth.module.ts` (full file, lines 1-39) — simplified, since Accounts has no Passport/JWT-issuing concerns, only the `TypeOrmModule.forFeature` + `exports` shape.

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
  // Mirrors AuthModule exporting AuthService (line 37) — ARCHITECTURE.md
  // requires Phase 4's TransactionsModule to inject AccountsService rather
  // than reach into the Account repository directly.
  exports: [AccountsService],
})
export class AccountsModule {}
```

**Integration point** — add to `src/app.module.ts` imports array (currently line 45: `AuthModule`) as a sibling import: `AccountsModule` alongside `AuthModule`. No changes needed to `APP_GUARD`/`APP_INTERCEPTOR`/`APP_PIPE` providers (lines 47-83 of `app.module.ts`) — they already apply globally.

---

### `src/database/migrations/<timestamp>-CreateAccounts.ts` (migration, batch/DDL)

**Analog:** `src/database/migrations/1789166140074-InitUsers.ts` (full file, lines 1-19)

**Pattern to mirror exactly** (class name = `Create<Name><timestamp>`, `name` field matches class name, raw SQL in `up`/`down`, hand-written not `synchronize`-generated-and-trusted-blindly — must be generated via `typeorm migration:generate` then reviewed):
```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccounts<TIMESTAMP> implements MigrationInterface {
  name = 'CreateAccounts<TIMESTAMP>';

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
        CONSTRAINT "PK_accounts_id" PRIMARY KEY ("id")
      )`,
    );
    // Composite/leading-userId index — PITFALLS.md Performance Traps:
    // "Add composite index with userId as leading column on every
    // frequently-queried tenant-scoped table."
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
Also see `src/database/migrations/1789223051154-AddRefreshTokensUserFk.ts` (not read in full — name implies FK-add-after-table pattern) if a separate FK migration for `accounts.user_id → users.id` is preferred over inlining a `REFERENCES` clause; inlining in the same `CREATE TABLE` (as shown above, minus the explicit FK constraint which can be added) is simpler and matches this phase's single-migration scope. Add `CONSTRAINT "FK_accounts_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id")` to the `CREATE TABLE` if a hard FK is wanted (recommended, since Phase 4 will add a further FK from `transactions.account_id → accounts.id`).

---

### `test/cross-tenant.e2e-spec.ts` (extend) (test, request-response)

**Analog:** existing `test/cross-tenant.e2e-spec.ts` (Phase 1) — not fully read here (file exists, git-tracked), but per `01-05-SUMMARY.md` (referenced in CONTEXT.md canonical_refs) this is the established pattern: create two users, user A hits every mutating/read Accounts endpoint using user B's account IDs, assert every response is `404`. Extend this file (or add a sibling `test/accounts-cross-tenant.e2e-spec.ts` following the same structure) — do not invent a new test pattern for this phase; Pitfall 3 explicitly requires this per-module.

---

## Shared Patterns

### userId-scoping (IDOR prevention)
**Source:** `src/auth/decorators/current-user.decorator.ts` (full file) + `src/auth/auth.service.ts` `findById()` (lines 83-93)
**Apply to:** `AccountsController` (every route) and `AccountsService` (every repository query)
```typescript
// decorator — reused as-is, no new decorator needed
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user.userId;
  },
);
```
Every `AccountsService` method takes `userId` as its first parameter and includes it directly in the `where` clause (never a post-fetch `if` check) — per PITFALLS.md Pitfall 3.

### Auth guard
**Source:** `src/auth/guards/jwt-auth.guard.ts` (existing, reused unmodified)
**Apply to:** `AccountsController` via `@UseGuards(JwtAuthGuard)`

### Global validation/serialization (no per-module setup)
**Source:** `src/app.module.ts` lines 47-83 (`APP_PIPE` ValidationPipe with `whitelist`/`forbidNonWhitelisted`/`transform`, `APP_INTERCEPTOR` `ClassSerializerInterceptor` + `ResponseInterceptor`)
**Apply to:** All Accounts DTOs/controllers automatically — no module-level wiring needed, matches how `AuthController` already relies on this.

### Money as decimal string, never float
**Source:** PITFALLS.md Pitfall 1 (no code analog exists yet in this codebase — first module to touch money)
**Apply to:** `Account.balance` column (`type: 'decimal'`), `CreateAccountDto.balance` (validated as decimal-string regex, not `@IsNumber()`), `AccountResponseDto.balance` (kept as `string`, never `parseFloat`'d).

### Soft delete
**Source:** no existing analog (`User` entity has no soft-delete) — new pattern established by D-03, to be followed by later modules once they reference `accounts.id`.
**Apply to:** `Account.deletedAt` column + `deletedAt: IsNull()` filter on every `find`/`findOne` in `AccountsService`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `Account.balance` decimal-string validation regex | DTO validation detail | transform | No prior DTO in the codebase validates a money field — `RegisterDto`/`LoginDto` only validate email/password strings. Pattern sourced directly from PITFALLS.md Pitfall 1 guidance, not an existing file. |
| Soft-delete (`deletedAt`) filtering | model/service pattern | CRUD | `User`/`RefreshToken` entities use hard deletes only (`RefreshToken` is revoked via `revokedAt`, a related but distinct concept — see `auth.service.ts` `logout()`/`refresh()` for the closest partial analog to "flag instead of delete"). |

## Metadata

**Analog search scope:** `src/auth/**`, `src/app.module.ts`, `src/database/migrations/**`, `test/*.e2e-spec.ts`
**Files scanned:** 15 (all of `src/auth/`) + `app.module.ts` + 3 migrations + `test/` directory listing
**Pattern extraction date:** 2026-09-12
