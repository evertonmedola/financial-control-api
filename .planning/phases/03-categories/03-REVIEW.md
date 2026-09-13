---
phase: 03-categories
reviewed: 2026-09-13T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/app.module.ts
  - src/categories/categories.controller.ts
  - src/categories/categories.module.ts
  - src/categories/categories.service.spec.ts
  - src/categories/categories.service.ts
  - src/categories/dto/category-response.dto.ts
  - src/categories/dto/create-category.dto.ts
  - src/categories/dto/update-category.dto.ts
  - src/categories/entities/category.entity.ts
  - src/database/migrations/1789400000000-CreateCategories.ts
  - test/categories.e2e-spec.ts
  - test/categories-cross-tenant.e2e-spec.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-09-13
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

The Categories module closely mirrors the existing, previously-reviewed Accounts module (same controller/service/DTO/migration shape, same soft-delete and ownership-check conventions), and the bulk of it is solid: tenant scoping is consistently applied (`userId` in every `where`), `findOne` uses the generic 404-not-403 pattern for IDOR resistance, the DTO layer correctly locks `type` against PATCH via `forbidNonWhitelisted`, and the migration's partial unique index is a sound DB-level enforcement mechanism with good test coverage for the concurrent-insert race.

The most significant finding is that `CategoriesService.update()` does not reuse the unique-violation handling that `create()` has — so a PATCH that renames a category into collision with an existing (name, type) pair for the same user throws an uncaught `QueryFailedError` that surfaces as a generic 500 instead of the `409 Conflict` the API contract establishes elsewhere. This code path is also untested (no e2e/unit test exercises a duplicate-producing PATCH), so it slipped through.

Secondary issues: no `:id` format validation before hitting the DB (malformed UUIDs 500 instead of 404), and `name` is neither trimmed nor checked for whitespace-only content, which can be used to trivially defeat the per-user (name, type) uniqueness the migration's D-03 partial index is specifically designed to guarantee.

## Critical Issues

### CR-01: `update()` doesn't catch the unique-violation that `create()` explicitly handles — PATCH-to-duplicate-name 500s instead of 409

**File:** `src/categories/categories.service.ts:66-74`
**Issue:** `create()` wraps `save()` in a try/catch that translates a Postgres `23505` (unique-violation on `UQ_categories_user_id_name_type`) into a friendly `ConflictException` (409). `update()` performs the exact same kind of write — `Object.assign(category, dto); return this.categoriesRepository.save(category);` — against the same unique index (only `name` is mutable via PATCH, but that's exactly the column the index covers), yet has no equivalent try/catch. If a client PATCHes a category's `name` to a value that collides with another (non-deleted) category of the same `type` for the same user, the raw `QueryFailedError` propagates uncaught, is not an `HttpException`, and is swallowed by the global `HttpExceptionFilter`'s catch-all branch — the client receives a generic `500 Internal server error` instead of the `409 Conflict` that the identical scenario produces on `create()`. This is an inconsistent, incorrect API contract for the same underlying constraint, and it is completely untested — `test/categories.e2e-spec.ts`'s PATCH tests only cover the type-locked-400 case and the name-only-200 case, never a PATCH that collides with an existing category.
**Fix:** Extract the try/catch into a shared private helper and use it from both `create()` and `update()`:
```typescript
async update(
  userId: string,
  id: string,
  dto: UpdateCategoryDto,
): Promise<Category> {
  const category = await this.findOne(userId, id);
  Object.assign(category, dto);
  return this.saveOrThrowConflict(category);
}

private async saveOrThrowConflict(category: Category): Promise<Category> {
  try {
    return await this.categoriesRepository.save(category);
  } catch (error) {
    if (this.isUniqueViolation(error)) {
      throw new ConflictException(
        'já existe uma categoria com esse nome para este tipo',
      );
    }
    throw error;
  }
}
```
And update `create()` to call `this.saveOrThrowConflict(category)` as well. Add an e2e test: create two categories of the same `type` with different names, then PATCH the second one's `name` to match the first's — expect `409`.

## Warnings

### WR-01: No `:id` format validation — a malformed id returns 500, not 404

**File:** `src/categories/categories.controller.ts:43-50, 52-60, 65-72`
**File:** `src/categories/categories.service.ts:53-61`
**Issue:** `findOne`, `update`, and `remove` all pass the raw `@Param('id') id: string` straight into a TypeORM `where: { id, userId, ... }` against a `uuid`-typed column, with no `ParseUUIDPipe` or manual format check anywhere in the route chain. A request like `GET /categories/not-a-uuid` causes Postgres to reject the query with `invalid input syntax for type uuid` (`22P02`), which surfaces as an uncaught `QueryFailedError`. That error is not an `HttpException`, so `HttpExceptionFilter`'s catch-all path returns a generic `500` instead of the `404` a malformed/unknown id should logically produce — this is an easily-triggered edge case (any client typo, or a scanner probing routes) that currently degrades to a server error.
**Fix:** Add `@Param('id', ParseUUIDPipe) id: string` on each `:id` route in `CategoriesController`, which makes NestJS reject non-UUID ids with a clean `400` before the service/repository is ever reached.

### WR-02: `name` is not trimmed and whitespace-only names are not rejected — trivially defeats the D-03 uniqueness guarantee

**File:** `src/categories/dto/create-category.dto.ts:4-8`
**File:** `src/categories/dto/update-category.dto.ts:12-16`
**Issue:** `@IsString() @MinLength(1) @MaxLength(100)` only rejects the literal empty string; it does not trim whitespace or reject whitespace-only values. Two consequences: (1) a name of `' '` (or any string of only spaces) passes validation and is persisted, producing a category with a functionally-empty display name; (2) because the partial unique index is on the literal `name` column, `"Alimentação"` and `"Alimentação "` (or `" Alimentação"`) are treated as distinct rows — a user (or the client app) can trivially create what looks like a duplicate category by adding leading/trailing whitespace, undermining the exact guarantee the migration's D-03 comment and the `UQ_categories_user_id_name_type` index are built to provide.
**Fix:** Trim and re-validate in both DTOs, e.g. via `class-transformer`:
```typescript
@Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
@IsString()
@MinLength(1)
@MaxLength(100)
name!: string;
```
(Requires `transform: true` on the pipe, which `AppModule`'s global `ValidationPipe` already sets — but note the transform pipeline order: `@Transform` runs class-transformer independent of `class-validator`'s decorators, so confirm order with a quick unit test asserting `'  Comida  '` is stored as `'Comida'`.)

### WR-03: `isUniqueViolation()` matches on error code alone, not the specific constraint — brittle once a second unique index exists

**File:** `src/categories/categories.service.ts:85-92`
**Issue:** `isUniqueViolation` treats any Postgres `23505` as "duplicate name for this type" and reports the same fixed message. Today `categories` has exactly one unique constraint (`UQ_categories_user_id_name_type`), so this is correct by coincidence. The moment a second unique constraint is ever added to this table (e.g. a future feature), any violation of that unrelated constraint will be silently mis-reported to the client as "já existe uma categoria com esse nome para este tipo," which is misleading and will be confusing to debug.
**Fix:** Check the constraint name, not just the error code:
```typescript
private isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION &&
    (error as { constraint?: string }).constraint ===
      'UQ_categories_user_id_name_type'
  );
}
```

## Info

### IN-01: `CategoriesService.update()` and `findAll()` have no unit-test coverage

**File:** `src/categories/categories.service.spec.ts:1-123`
**Issue:** The spec file covers `create()` (happy path + conflict) `findOne()` (happy path + 404), and `remove()`, but has no `describe('update', ...)` or `describe('findAll', ...)` block at all. `update()` in particular is the method with the ownership-check-then-`Object.assign`-then-`save()` pattern most worth unit-testing in isolation (and is exactly the method missing the CR-01 fix's error handling) — it's currently only exercised indirectly through e2e tests.
**Fix:** Add unit tests mirroring the existing `create`/`findOne` style: `update()` merges `dto` into the entity found via ownership-scoped `findOne` and persists it; `update()` propagates `NotFoundException` when the underlying `findOne` throws; `findAll()` calls `find()` with `{ userId, deletedAt: IsNull() }` and `order: { createdAt: 'ASC' }`.

### IN-02: Category name uniqueness is case-sensitive

**File:** `src/database/migrations/1789400000000-CreateCategories.ts:32-34`
**Issue:** The partial unique index compares `name` using Postgres's default (case-sensitive) collation, so `"Mercado"` and `"mercado"` are treated as distinct categories for the same user/type. This may be intentional, but given D-03's stated intent ("a user cannot have two ... categories with the same (name, type)"), it's worth an explicit decision record confirming case-sensitivity is desired rather than an oversight — user-facing category pickers are a classic spot where visually-near-duplicate entries cause confusion.
**Fix:** No code change required if intentional; otherwise consider a `citext` column or a functional index on `lower(name)` and document the decision.

### IN-03: Redundant explicit index drops in migration `down()`

**File:** `src/database/migrations/1789400000000-CreateCategories.ts:37-44`
**Issue:** `down()` explicitly drops `UQ_categories_user_id_name_type` and `IDX_categories_user_id` before `DROP TABLE "categories"`. Dropping the table already drops all of its indexes, so these two statements are dead weight (harmless, but add noise and a place for the drop order to silently go stale if a future migration edit reorders things).
**Fix:** Optional simplification — drop the two explicit `DROP INDEX` statements and rely on `DROP TABLE`'s cascade of its own indexes; only keep them if there's a project convention requiring explicit symmetric up/down statements (worth confirming against the Accounts migration, which does the same thing, before changing either).

---

_Reviewed: 2026-09-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
