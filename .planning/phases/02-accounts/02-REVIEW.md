---
phase: 02-accounts
reviewed: 2026-09-12T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/accounts/accounts.controller.ts
  - src/accounts/accounts.module.ts
  - src/accounts/accounts.service.spec.ts
  - src/accounts/accounts.service.ts
  - src/accounts/dto/account-response.dto.ts
  - src/accounts/dto/create-account.dto.ts
  - src/accounts/dto/update-account.dto.ts
  - src/accounts/entities/account.entity.ts
  - src/app.module.ts
  - src/database/migrations/1789300000000-CreateAccounts.ts
  - test/accounts-cross-tenant.e2e-spec.ts
  - test/accounts.e2e-spec.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-09-12T00:00:00Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

The Accounts module is well-structured and its IDOR mitigation (404-never-403, `userId`-scoped `findOne` used as the single gate before every mutation) is correctly implemented and covered by a dedicated cross-tenant e2e suite. The balance-lock (`UpdateAccountDto` omitting `balance`/`type`, enforced by the global `forbidNonWhitelisted` pipe) and the soft-delete convention (`deletedAt` filtering in every read path, never a hard `.delete()`/`.remove()`) both hold up under inspection and are exercised by both unit and e2e tests.

No Critical/security-bypass findings were found. Two Warnings were found around input-validation gaps that let malformed-but-plausible client input reach the database layer and surface as an uncaught 500 instead of a clean 400/404, plus three minor Info-level maintainability items (index-naming drift risk for future `migration:generate` runs, missing unit coverage for two service methods, and a whitespace-only account name being accepted).

## Warnings

### WR-01: `:id` route params are never format-validated, so a malformed id triggers a raw DB error (500) instead of 400/404

**File:** `src/accounts/accounts.controller.ts:44,53,66` (root cause in `src/accounts/accounts.service.ts:32-40`)

**Issue:** `@Param('id') id: string` accepts any string with no `ParseUUIDPipe` (or DTO-level `@IsUUID()`) validation. `AccountsService.findOne()` passes this raw string straight into a TypeORM `where: { id, userId, deletedAt: IsNull() }` clause against a `uuid` column. For a non-UUID value (e.g. `GET /accounts/not-a-uuid`), Postgres raises `invalid input syntax for type uuid`, which surfaces as an unhandled `QueryFailedError` — not an `HttpException` — so it falls through to the generic `catch()` branch in `HttpExceptionFilter` and returns a bare 500 instead of the expected 400 (bad request format) or 404 (matching the "unknown/foreign id → 404" philosophy already established for `findOne`). This path is untested — no test in `accounts.e2e-spec.ts`/`accounts-cross-tenant.e2e-spec.ts` sends a non-UUID id.

**Fix:**
```ts
// accounts.controller.ts
import { ParseUUIDPipe } from '@nestjs/common';
// ...
@Get(':id')
async findOne(
  @CurrentUser() userId: string,
  @Param('id', ParseUUIDPipe) id: string,
): Promise<AccountResponseDto> { ... }

// apply the same to update() and remove()
```

### WR-02: `CreateAccountDto.balance` regex doesn't bound magnitude to the column's `precision(12, scale 2)`, allowing a DB overflow error to surface as 500

**File:** `src/accounts/dto/create-account.dto.ts:27-29` (column definition: `src/accounts/entities/account.entity.ts:38`)

**Issue:** The `@Matches(/^-?\d+(\.\d{1,2})?$/)` pattern validates decimal *shape* (integer part + up to 2 decimals) but places no upper bound on the number of integer digits. The `balance` column is `decimal(12,2)`, which allows at most 10 digits before the decimal point. A value like `"12345678901.00"` (11 integer digits) passes DTO validation, then fails at the database with a `numeric field overflow` `QueryFailedError` — again not an `HttpException`, so it surfaces as a bare 500 instead of a 400 telling the client the value is out of range.

**Fix:**
```ts
@Matches(/^-?\d{1,10}(\.\d{1,2})?$/, {
  message: 'balance deve ser uma string decimal com até 10 dígitos inteiros e até 2 casas decimais',
})
balance!: string;
```
(Keep the integer-digit cap in sync with the column's `precision` if that ever changes.)

## Info

### IN-01: Entity-level `@Index()` on `userId` will not match the migration's explicit index name, risking drift on a future `migration:generate`

**File:** `src/accounts/entities/account.entity.ts:25` vs `src/database/migrations/1789300000000-CreateAccounts.ts:26-28`

**Issue:** The migration explicitly creates `IDX_accounts_user_id`, but the entity's bare `@Index()` decorator (no explicit name) will cause TypeORM to expect its own default-computed index name when it inspects entity metadata (e.g. during a future `typeorm migration:generate` run). Since the actual DB index name doesn't match what TypeORM would generate from the decorator, a future auto-generated migration could propose dropping/recreating this index unnecessarily.

**Fix:** Give the decorator an explicit name that matches the migration:
```ts
@Index('IDX_accounts_user_id')
@Column({ name: 'user_id' })
userId!: string;
```

### IN-02: `update()` and `findAll()` have no unit-test coverage in `accounts.service.spec.ts`

**File:** `src/accounts/accounts.service.spec.ts`

**Issue:** Only `create`, `adjustBalance`, `findOne`, and `remove` are unit-tested. `update()` — the method enforcing the balance/type lock via `Object.assign(account, dto)` after an ownership-scoped `findOne()` — and `findAll()` — which enforces the soft-delete filter and stable `createdAt ASC` ordering — have no dedicated unit tests. e2e coverage exists for both, but there's no fast unit-level regression net if the query/patch logic changes.

**Fix:** Add `describe('update', ...)` and `describe('findAll', ...)` blocks mirroring the existing `findOne`/`remove` test structure, asserting the repository is called with the expected `where`/`order` clauses and that `Object.assign` only ever touches whitelisted fields.

### IN-03: A whitespace-only `name` is accepted at creation and update

**File:** `src/accounts/dto/create-account.dto.ts:11-14`, `src/accounts/dto/update-account.dto.ts:16-20`

**Issue:** `@MinLength(1)` counts whitespace characters, so `name: " "` (a single space) satisfies validation and is persisted as-is — an account with an effectively blank display name.

**Fix:** Trim before length validation, e.g. add `@Transform(({ value }) => typeof value === 'string' ? value.trim() : value)` from `class-transformer` ahead of the existing decorators, so `" "` is normalized to `""` and correctly rejected by `MinLength(1)`.

---

_Reviewed: 2026-09-12T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
