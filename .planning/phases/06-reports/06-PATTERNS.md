# Phase 6: Reports - Pattern Map

**Mapped:** 2026-09-22
**Files analyzed:** 8
**Analogs found:** 8 / 8 (no RESEARCH.md exists for this phase; research is disabled project-wide — CONTEXT.md is the sole upstream input)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/reports/reports.module.ts` | module | request-response | `src/budgets/budgets.module.ts` | exact (same cross-module read-only DI shape) |
| `src/reports/reports.controller.ts` | controller | request-response | `src/budgets/budgets.controller.ts` (route shape) + `src/transactions/transactions.controller.ts` (plain `findAll`) | role-match |
| `src/reports/reports.service.ts` | service | CRUD (read-only aggregation) | `src/budgets/budgets.service.ts` (orchestration) + `src/transactions/transactions.service.ts#sumByCategoryExcludingTransfers` (grouped SUM query) | exact for aggregation shape |
| `src/reports/dto/category-summary-query.dto.ts` | dto (query params) | request-response | none in-repo (first query-param DTO) — nearest shape is `src/budgets/dto/create-budget.dto.ts` (class-validator decorator style) | no analog — new pattern, use RESEARCH-free class-validator convention |
| `src/reports/dto/category-summary-response.dto.ts` | dto (computed response) | transform | `src/budgets/dto/budget-status.dto.ts` (computed, non-entity, `static build()`) | exact |
| `src/reports/dto/month-comparison-query.dto.ts` | dto (query params) | request-response | same as category-summary-query.dto.ts | no analog — new pattern |
| `src/reports/dto/month-comparison-response.dto.ts` | dto (computed response) | transform | `src/budgets/dto/budget-status.dto.ts` | exact |
| `src/reports/dto/net-balance-response.dto.ts` | dto (computed response) | transform | `src/budgets/dto/budget-status.dto.ts` | exact |
| `src/app.module.ts` (modified) | config | wiring | existing `imports: [...]` array registration of `BudgetsModule` | exact |

## Pattern Assignments

### `src/reports/reports.module.ts` (module)

**Analog:** `src/budgets/budgets.module.ts` (full file read above)

```typescript
import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CategoriesModule } from '../categories/categories.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    // Reports has NO entity of its own (CONTEXT.md: "no new entities beyond
    // DTOs") — no TypeOrmModule.forFeature() call here, unlike every prior
    // module. Read-only dependency on the three existing services, mirroring
    // BudgetsModule's Budgets -> Categories / Budgets -> Transactions
    // direction (05-PATTERNS.md discretion note, reused verbatim).
    AccountsModule,
    CategoriesModule,
    TransactionsModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  // Nothing downstream imports ReportsModule back.
  exports: [ReportsService],
})
export class ReportsModule {}
```

Register in `src/app.module.ts` exactly like `BudgetsModule` is registered (import line + `imports` array entry, alphabetically after `TransfersModule`/`BudgetsModule` — follow existing ordering).

---

### `src/reports/reports.controller.ts` (controller, request-response)

**Analog:** `src/budgets/budgets.controller.ts` (guard placement, DTO-mapping shape) + `src/transactions/transactions.controller.ts` (plain `@Get()` with no body)

**Imports pattern:**
```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReportsService } from './reports.service';
import { CategorySummaryQueryDto } from './dto/category-summary-query.dto';
import { CategorySummaryResponseDto } from './dto/category-summary-response.dto';
import { MonthComparisonQueryDto } from './dto/month-comparison-query.dto';
import { NetBalanceResponseDto } from './dto/net-balance-response.dto';
```

**Guard pattern** (from budgets.controller.ts lines 20-25) — controller-level guard, not per-route:
```typescript
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}
```

**Query-param route pattern** — no existing analog uses `@Query()` with a DTO in this codebase (every prior `@Get()` is param-less, e.g. `transactions.controller.ts` lines 34-42), but the global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` registered in `app.module.ts` (lines 81-88) applies uniformly to `@Query()` DTOs the same way it applies to `@Body()` DTOs — no extra wiring needed:
```typescript
@Get('category-summary')
async categorySummary(
  @CurrentUser() userId: string,
  @Query() query: CategorySummaryQueryDto,
): Promise<CategorySummaryResponseDto[]> {
  return this.reportsService.getCategorySummary(userId, query.from, query.to);
}

@Get('net-balance')
async netBalance(
  @CurrentUser() userId: string,
): Promise<NetBalanceResponseDto> {
  return this.reportsService.getNetBalance(userId);
}

@Get('month-comparison')
async monthComparison(
  @CurrentUser() userId: string,
  @Query() query: MonthComparisonQueryDto,
): Promise<MonthComparisonResponseDto[]> {
  return this.reportsService.getMonthComparison(userId, query.month);
}
```

Route naming (`category-summary`, `net-balance`, `month-comparison`) is Claude's Discretion per CONTEXT.md — kebab-case sub-paths under `/reports` mirror this codebase's existing single-noun resource convention (`/accounts`, `/categories`, `/transactions`, `/budgets`) extended to three GET-only sub-resources instead of forcing three separate top-level controllers.

---

### `src/reports/reports.service.ts` (service, read-only aggregation)

**Analog 1 — orchestration shape:** `src/budgets/budgets.service.ts#findAllWithStatus` (lines 118-145)

**Analog 2 — grouped SUM query to extend:** `src/transactions/transactions.service.ts#sumByCategoryExcludingTransfers` (lines 210-242, reproduced above) — this is the exact query to parallel for REP-01 and REP-03. The existing method signature takes `categoryIds: string[]` (used by Budgets, which already knows which categories have a budget); Reports needs the summary across **all** the user's expense categories in a date range, so the service will need either:
- a new `TransactionsService` method (e.g. `sumByCategoryExcludingTransfersForAllCategories(userId, startDate, endDate)` dropping the `categoryIds IN (...)` filter and instead grouping by whatever categories actually have matching rows — since empty categories are omitted per CONTEXT.md's "Empty Category Rows" decision, no `categoryIds` allowlist is even needed), or
- reuse the existing method by first calling `CategoriesService.findAll(userId)` to get every category id, then passing that full list in (mirrors Budgets' own pattern of resolving ids before calling the aggregation).

Either is a legitimate, small extension of the existing method — do not reinvent the grouped-`SUM...GROUP BY` query pattern itself; the `type = EXPENSE`, `deletedAt IS NULL`, and `date BETWEEN` clauses (lines 230-237) are directly reusable/parallel-able for REP-01's arbitrary date range and REP-03's two fixed month ranges (current + previous, computed the same way `getCurrentMonthBounds()` at lines 152-161 computes bounds — but parameterized by the requested `?month=` instead of `new Date()`, and called twice with different bounds for REP-03).

**Net balance pattern (REP-02):** No SUM-across-accounts analog exists yet. Read directly from `AccountsService.findAll(userId)` (accounts.service.ts lines 37-42, already excludes soft-deleted), then reduce using `decimal.util.ts`'s exact-arithmetic helpers — never `parseFloat`/`Number()`:
```typescript
import { addDecimalStrings, subtractDecimalStrings } from '../common/decimal.util';
import { AccountType } from '../accounts/entities/account.entity';

async getNetBalance(userId: string): Promise<NetBalanceResponseDto> {
  const accounts = await this.accountsService.findAll(userId);
  let assets = '0.00';
  let debt = '0.00';
  for (const account of accounts) {
    if (account.type === AccountType.CARTAO_CREDITO) {
      debt = addDecimalStrings(debt, account.balance);
    } else {
      assets = addDecimalStrings(assets, account.balance);
    }
  }
  return NetBalanceResponseDto.build(subtractDecimalStrings(assets, debt));
}
```
This mirrors `decimal.util.ts`'s own documented convention (lines 1-9: BigInt-cents, never float) and the account-type enum defined in `src/accounts/entities/account.entity.ts` lines 10-15 (`CORRENTE`, `POUPANCA`, `CARTEIRA` = assets; `CARTAO_CREDITO` = debt, per CONTEXT.md's "Balance Netting" decision).

**Error handling / date-range validation (REP-01):** No existing analog validates a `from`/`to` query pair — enforce in the DTO layer via `class-validator`'s `@IsDateString()` (400 on malformed dates is automatic via the global `ValidationPipe`), then a service-level or DTO-level cross-field check for `from > to` throwing `BadRequestException`, mirroring `AccountsService.adjustBalance`'s `BadRequestException` pattern (accounts.service.ts lines 127-131) for a controlled 400 instead of an unhandled error.

---

### `src/reports/dto/category-summary-query.dto.ts` / `month-comparison-query.dto.ts` (query-param DTOs)

**No analog exists** — this codebase has no prior `@Query()` DTO (every existing `@Get()` route in Accounts/Categories/Transactions/Budgets controllers is param-less). Follow the same `class-validator` decorator style used in `src/budgets/dto/create-budget.dto.ts` (lines 1-16) and `src/transactions/dto/create-transaction.dto.ts`'s date field, applying it to query strings instead of body fields:
```typescript
import { IsDateString } from 'class-validator';

export class CategorySummaryQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
```
```typescript
import { Matches } from 'class-validator';

export class MonthComparisonQueryDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'month deve estar no formato YYYY-MM',
  })
  month!: string;
}
```
Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` (app.module.ts lines 81-88) already covers `@Query()` binding — `forbidNonWhitelisted: true` means an unexpected extra query param (e.g. `?from=...&to=...&foo=bar`) is rejected with 400, consistent with every existing body DTO's behavior.

---

### `src/reports/dto/category-summary-response.dto.ts`, `month-comparison-response.dto.ts`, `net-balance-response.dto.ts` (computed response DTOs)

**Analog:** `src/budgets/dto/budget-status.dto.ts` (full file above) — the established shape for a **computed, non-entity** response: plain field declarations + a `static build(...)` factory doing the arithmetic, never a `fromEntity()` (there is no backing entity).

```typescript
// category-summary-response.dto.ts
export class CategorySummaryResponseDto {
  categoryId!: string;
  categoryName!: string;
  total!: string;

  static build(categoryId: string, categoryName: string, total: string): CategorySummaryResponseDto {
    const dto = new CategorySummaryResponseDto();
    dto.categoryId = categoryId;
    dto.categoryName = categoryName;
    dto.total = total;
    return dto;
  }
}
```

```typescript
// month-comparison-response.dto.ts — deltaPercent deliberately omitted (CONTEXT.md, deferred)
import { subtractDecimalStrings } from '../../common/decimal.util';

export class MonthComparisonResponseDto {
  categoryId!: string;
  categoryName!: string;
  currentMonthTotal!: string;
  previousMonthTotal!: string;
  delta!: string;

  static build(
    categoryId: string,
    categoryName: string,
    currentMonthTotal: string,
    previousMonthTotal: string,
  ): MonthComparisonResponseDto {
    const dto = new MonthComparisonResponseDto();
    dto.categoryId = categoryId;
    dto.categoryName = categoryName;
    dto.currentMonthTotal = currentMonthTotal;
    dto.previousMonthTotal = previousMonthTotal;
    // Pitfall-4-class rule (BudgetStatusDto's "never null/undefined/NaN"):
    // subtractDecimalStrings never divides, so there is no zero-division
    // edge case here at all — delta is always safely computable.
    dto.delta = subtractDecimalStrings(currentMonthTotal, previousMonthTotal);
    return dto;
  }
}
```

```typescript
// net-balance-response.dto.ts
export class NetBalanceResponseDto {
  balance!: string;

  static build(balance: string): NetBalanceResponseDto {
    const dto = new NetBalanceResponseDto();
    dto.balance = balance;
    return dto;
  }
}
```

---

## Shared Patterns

### Auth guard
**Source:** `src/budgets/budgets.controller.ts` lines 20-25 (`@UseGuards(JwtAuthGuard)` at controller level)
**Apply to:** `ReportsController` — every route requires authentication, identical to all four prior domain controllers.

### userId scoping
**Source:** every service's `findOne(userId, ...)`/`findAll(userId)` signature (e.g. `accounts.service.ts` lines 37-55) — `userId` always comes from `@CurrentUser()`, never client input.
**Apply to:** every `ReportsService` method — pass `userId` through to `AccountsService.findAll`, `CategoriesService.findAll`, and `TransactionsService`'s aggregation method.

### Exact decimal arithmetic
**Source:** `src/common/decimal.util.ts` (`addDecimalStrings`, `subtractDecimalStrings`, `isGreaterThanDecimalString`)
**Apply to:** net-balance summation, delta computation. Never `parseFloat`/`Number()`/float math anywhere in `reports.service.ts` or its DTOs.

### Soft-delete exclusion
**Source:** `IsNull()` on `deletedAt` in every repository query across Accounts/Categories/Transactions (e.g. `accounts.service.ts` line 39, `transactions.service.ts` line 76, 237)
**Apply to:** Reports reads nothing directly via a repository of its own — it delegates to `AccountsService.findAll`, `CategoriesService.findAll`, and `TransactionsService`'s aggregation, all of which already apply this filter internally. No new soft-delete logic needed in Reports itself, but the executor must confirm the extended/new `TransactionsService` aggregation method it calls also carries `deletedAt IS NULL` (as line 237 does).

### Controlled 400 over unhandled error
**Source:** `AccountsService.adjustBalance` (`accounts.service.ts` lines 127-131), `TransactionsService.sumByCategoryExcludingTransfers`'s empty-array guard (`transactions.service.ts` lines 216-220)
**Apply to:** `from > to` validation (REP-01) and malformed `?month=` (REP-03, though `@Matches()` at the DTO layer already rejects most malformed input before it reaches the service).

### Response envelope / serialization
**Source:** global `ResponseInterceptor` + `ClassSerializerInterceptor` (`app.module.ts` lines 89-94) — automatic for every controller, no per-file pattern needed.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/reports/dto/category-summary-query.dto.ts` | dto | request-response | First `@Query()`-bound DTO in the codebase — no prior GET route accepts query params. Resolved above by extending the existing `class-validator` body-DTO convention to query strings; global `ValidationPipe` already covers `@Query()` binding with no extra wiring. |
| `src/reports/dto/month-comparison-query.dto.ts` | dto | request-response | Same reason as above. |

## Metadata

**Analog search scope:** `src/budgets/`, `src/transactions/`, `src/accounts/`, `src/categories/`, `src/app.module.ts`, `src/common/decimal.util.ts`
**Files scanned:** 11 (full reads, no partial/offset reads needed — all files under 250 lines)
**Pattern extraction date:** 2026-09-22
