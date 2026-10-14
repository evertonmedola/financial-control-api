---
phase: quick-261014-fqj-validation-4xx
plan: 01
subsystem: api-validation
tags: [nestjs, validation, parseuuidpipe, numeric-overflow, soft-delete, swagger]
requires: []
provides:
  - ":id UUID validation on accounts, transactions, transfers"
  - "shared IsMoneyString decorator (10 integer digits) for every decimal(12,2) input"
  - "409 on DELETE /accounts/:id while live transactions reference the account"
affects: [accounts, transactions, transfers, budgets, swagger]
tech-stack:
  added: []
  patterns:
    - "single shared money validator wrapping class-validator Matches"
    - "independent TypeOrmModule.forFeature([Transaction]) in AccountsModule (TransfersModule precedent), no circular import"
key-files:
  created:
    - src/common/validators/is-money-string.decorator.ts
    - src/common/validators/is-money-string.decorator.spec.ts
  modified:
    - src/accounts/accounts.controller.ts
    - src/accounts/accounts.module.ts
    - src/accounts/accounts.service.ts
    - src/accounts/accounts.service.spec.ts
    - src/accounts/dto/create-account.dto.ts
    - src/budgets/dto/create-budget.dto.ts
    - src/budgets/dto/update-budget.dto.ts
    - src/transactions/dto/create-transaction.dto.ts
    - src/transactions/transactions.controller.ts
    - src/transfers/dto/create-transfer.dto.ts
    - src/transfers/transfers.controller.ts
    - src/common/decimal.util.ts
    - src/common/decimal.util.spec.ts
    - src/common/swagger/api-error-responses.decorator.ts
    - test/accounts.e2e-spec.ts
    - test/budgets.e2e-spec.ts
    - test/transactions.e2e-spec.ts
    - test/transfers.e2e-spec.ts
key-decisions:
  - "Account.balance input now capped at 10 integer digits through the same decorator as the other money fields"
  - "AccountsModule registers Transaction independently instead of importing TransactionsModule (avoids circular dependency)"
  - "409 message is static Portuguese text with no id/count/SQL"
requirements-completed: [ACCT-01, ACCT-02, ACCT-04, TXN-02, TXN-03, TXN-05, BUD-01]
status: complete
commits: 3
plan_head_before: 4105abdabfa408428e0795209c53d00c682d108f
actuals:
  tokens: 16500
  tasks: 3
  commits: 3
duration: single session
completed: 2026-10-14
---

# Phase quick-261014-fqj Plan 01: 4xx validation fixes Summary

A non-UUID `:id` is now a 400 on every accounts/transactions/transfers route, all five `decimal(12,2)` input fields share one 10-integer-digit validator (closing an unbounded `Account.balance`), and `DELETE /accounts/:id` returns 409 while non-deleted transactions reference the account.

## Commits (branch fix/validation-4xx)

| Task | Commit | Message |
| ---- | ------ | ------- |
| 1 | 42b3703 | fix(quick-261014-fqj): validate :id as UUID in accounts, transactions, transfers |
| 2 | 6521918 | fix(quick-261014-fqj): limit decimal(12,2) inputs to 10 integer digits via shared validator; cover balance overflow paths |
| 3 | 4d7f944 | feat(quick-261014-fqj): reject DELETE /accounts/:id with 409 while non-deleted transactions reference the account |

## What was verified locally (no DB, no e2e)

- `npx tsc -p tsconfig.build.json --noEmit`: clean after each task.
- `npx eslint` on every touched file: 0 errors. (e2e files carry the pre-existing `no-unsafe-argument` warnings from `request(app.getHttpServer())`; `--quiet` was used for the errors-only view. Two prettier/type-assertion errors in my new code were fixed with `eslint --fix`.)
- `npx jest src` (full unit suite): 11 suites, 215 tests, all passing at the end of Task 3.
- Task-specific verify greps: piped `@Param('id')` count equals total per controller (3/3, 3/3, 1/1); no hand-written `\d{1,10}` outside `src/common/validators`; exactly one `IsMoneyString(` per DTO; `forFeature([Account, Transaction])` and `ApiErrorResponses(400, 401, 404, 409)` present; no `TransactionsModule|TransactionsService|forwardRef` in `src/accounts` outside comments.
- RED-first confirmed: the decorator spec and the new `isWithinDecimalRange` tests failed before the implementation, the adjustBalance characterization tests passed against unchanged production code, and the two Conflict cases failed before `remove()` was changed.
- Extra check: `tsc -p tsconfig.json --noEmit --rootDir .` (typechecks spec and e2e files). Only pre-existing errors remain (TS2783 in four `*.service.spec.ts` files and one in `test/categories.e2e-spec.ts:276`); none in code touched by this plan.

## NOT verified (e2e is not allowed for the executor)

None of the new or existing e2e tests were run. The orchestrator must run `bash infra/scripts/e2e-local.sh` and `bash infra/scripts/ci-gate-local.sh`. New e2e written: malformed `:id` (accounts, transactions, transfers); account 11-digit balance rejection (+/-) and exact-limit round trip; budget 11-digit limit on create and PATCH plus exact-max PATCH; transaction create/delete-revert overflow on both signs and PATCH not touching the balance; transfer create overflow (second-locked leg with rollback of the first, first-locked leg, negative side) and delete-revert overflow with rollback; account delete 409 cases (i)-(iv).

## Pre-change overflow table (Task 2 step 1)

Decimal columns (grep of entities/migrations): `accounts.balance`, `transactions.amount`, `budgets.limit`, all `numeric(12,2)` (migrations 1789300000000, 1789500000000, 1789600000000). No other decimal column exists.

| DTO field | Column | Validator before | Accepted an 11-integer-digit value before? |
| --------- | ------ | ---------------- | ------------------------------------------ |
| CreateAccountDto.balance | accounts.balance | `Matches(/^-?\d+(\.\d{1,2})?$/)` (unbounded integer part) | YES (reached Postgres: numeric field overflow, unhandled 500) |
| CreateTransactionDto.amount | transactions.amount | `Matches(/^(?!0+(\.0{1,2})?$)\d{1,10}(\.\d{1,2})?$/)` | No (400) |
| CreateTransferDto.amount | transactions.amount | same copy-pasted regex | No (400) |
| CreateBudgetDto.limit | budgets.limit | same copy-pasted regex | No (400) |
| UpdateBudgetDto.limit | budgets.limit | same regex behind `ValidateIf(value !== undefined)` | No (400) |

UpdateAccountDto, UpdateTransactionDto and the reports query DTOs carry no decimal field. This confirms the planner pre-read. After the change all five fields use `IsMoneyString` (`signed` for balance, `positive` for the rest); the four positive fields keep byte-identical regex source and messages (asserted in the spec), and the Swagger `pattern` is taken from the exported regex `.source`. The signed account pattern changed from `^-?\d+...` to `^-?\d{1,10}...` by design. Existing e2e for 11-digit transaction and transfer amounts (`12345678901.00`) were confirmed to still use an 11-integer-digit value.

## adjustBalance path audit (Task 2 step 5)

Every `adjustBalance` call is inside `queryRunner.startTransaction()` with a `catch -> rollbackTransaction -> throw error` wrapper, so the guard's `BadRequestException` surfaces as 400 with all legs rolled back:

| Path | adjustBalance call | try/catch rollback + rethrow |
| ---- | ------------------ | ---------------------------- |
| TransactionsService.create | src/transactions/transactions.service.ts:45 | :60-62 |
| TransactionsService.remove (revert) | :183 | :193-195 |
| TransfersService.create | src/transfers/transfers.service.ts:72 and :78 | :99-101 |
| TransfersService.remove (revert) | :149 and :155 | :165-167 |
| TransactionsService.update | never calls adjustBalance (DTO is description/date only; updates via scoped `repository.update`) | n/a |

No path was found that can end in a non-HttpException for overflow; no extra production fix was needed. The remaining unguarded entry (unbounded account balance input) is closed by the shared validator. Unit characterization of the guard added in `accounts.service.spec.ts` (limit inclusive on both signs, static message with no id or digits) and `isWithinDecimalRange` boundaries in `decimal.util.spec.ts`.

## Behavior notes

- Leading-zero amounts such as `00000000001.00` are now rejected on account creation exactly as they already were for transactions (11 integer digits).
- A transaction can no longer outlive its account: accounts with live transactions cannot be deleted, so the case of `DELETE /transactions/:id` hitting a soft-deleted account can no longer arise through the API.
- Known limitation (accepted, T-261014-06): a transaction created concurrently in the narrow window between the count and the soft-delete update is not blocked. `adjustBalance` locks the account row with `deletedAt IS NULL`, so a create after the delete fails with 404. A locked check inside one DB transaction would close the window; offered as a follow-up.
- The docs grep (README.md, infra/README.md, any `.md` outside .planning) found no DELETE /accounts contract text; Swagger is the contract, so no doc file was edited. The 409 description in `ERROR_DESCRIPTIONS` was reworded to a neutral sentence and the DELETE route gained an `ApiOperation` description.

## Deviations from Plan

### Auto-fixed / environment

**1. [Rule 3 - Blocking] node_modules was empty in the checkout**
- **Found during:** Task 1 verify (`tsc` could not find the `jest` and `node` type definitions).
- **Issue:** `D:/Financial-Control/FinancialControl/node_modules` existed but was empty, so no local check could run.
- **Fix:** ran `npm ci --no-audit --no-fund` (lockfile-exact, 804 packages, no new package or version change; `node_modules` is gitignored). This is not a package substitution. Flagged because the orchestrator's `e2e-local.sh` also requires `node_modules` to be present. Note: a stray Python invocation in one of my commands hung and was moved to the background; it had no effect on the repo.
- **Files modified:** none tracked.

**2. [Rule 3 - Blocking] Swagger constants not importable**
- **Found during:** Task 2 GREEN run. `@nestjs/swagger/dist/constants` is not exported by the package.
- **Fix:** the spec uses the literal metadata key `'swagger/apiModelProperties'` (commented).
- **Commit:** 6521918.

Otherwise the plan was executed as written. No auth gates. Messages match the plan's commit text.

## Known Stubs

None.

## Threat Flags

None. No new endpoint or auth path; the only new surface is the 409 on an existing route, covered by T-261014-03/04/05.

## Security-review checklist (project format)

Applied:
- Input validation: every touched input still passes through class-validator DTOs; `:id` params go through `ParseUUIDPipe` (T-261014-01); money fields share `IsMoneyString` with a 10-integer-digit cap (T-261014-02). Global `ValidationPipe` (whitelist, forbidNonWhitelisted) untouched.
- Parameterized queries: the new count uses TypeORM find options (`where` array with `IsNull()`), no query strings or raw SQL.
- Ownership / tenant scoping: `findOne(userId, id)` (404 for missing, soft-deleted or foreign) runs before the count; the count is scoped by `userId`; the unit test proves `count` is never reached for a missing or foreign account (T-261014-04).
- No leaked internals: the 409 and 400 messages are static Portuguese strings; no ids, counts, SQL, table or constraint names (unit test asserts no id and no digit in the 409 message; e2e asserts the body does not contain the account id) (T-261014-03).
- Secrets: nothing touched; `.env` not read; dev database not contacted.

Needs attention (follow-up, not blocking):
- Race between the live-transaction count and the soft-delete update (accepted, T-261014-06).

## Manual test checklist (CLAUDE.md: before advancing)

1. Run `bash infra/scripts/e2e-local.sh` then `bash infra/scripts/ci-gate-local.sh`; all e2e must pass including the new ones.
2. `GET/PATCH/DELETE /accounts/not-a-uuid`, `GET/PATCH/DELETE /transactions/not-a-uuid`, `DELETE /transfers/not-a-uuid` each return 400 (not 500).
3. `POST /accounts` with balance `10000000000.00`, `-10000000000.00`, `12345678901` returns 400; `9999999999.99` and `-9999999999.99` return 201 and round-trip exactly.
4. `POST /budgets` and `PATCH /budgets/:id` with limit `12345678901.00` return 400; `9999999999.99` is accepted on PATCH.
5. On an account at `9999999999.99`: `POST /transactions` income `0.01` returns 400, balance unchanged; same on the negative side with an expense.
6. Delete-revert overflow: `DELETE /transactions/:id` and `DELETE /transfers/:id` return 400 when the revert would leave the range, with the row still readable and balances unchanged (including the first-locked leg of a transfer rolled back).
7. `DELETE /accounts/:id` with a live expense, or as source/destination of a live transfer, returns 409 with the static message; after deleting those transactions/transfers it returns 200; another user's account id still returns 404.
8. Open `/api/docs`: DELETE /accounts/{id} lists 400, 401, 404, 409 with the new description; the six routes that gained `ParseUUIDPipe` list 400.

## Self-Check: PASSED

- Created files exist: `src/common/validators/is-money-string.decorator.ts`, `src/common/validators/is-money-string.decorator.spec.ts`.
- Commits found in `git log`: 42b3703, 6521918, 4d7f944.
- `git status --short`: only `.claude/settings.json` (modified), `.planning/milestone.lock` and the unstaged `.planning/quick/261014-fqj-...` directory remain.
