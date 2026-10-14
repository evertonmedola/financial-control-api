---
phase: quick-261014-fqj-validation-4xx
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
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
  - src/common/validators/is-money-string.decorator.ts
  - src/common/validators/is-money-string.decorator.spec.ts
  - src/common/swagger/api-error-responses.decorator.ts
  - test/accounts.e2e-spec.ts
  - test/budgets.e2e-spec.ts
  - test/transactions.e2e-spec.ts
  - test/transfers.e2e-spec.ts
autonomous: true
requirements: [ACCT-01, ACCT-02, ACCT-04, TXN-02, TXN-03, TXN-05, BUD-01]

estimate:
  tokens: 80000
  raw_tokens: 80000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A non-UUID :id on GET/PATCH/DELETE /accounts/:id, GET/PATCH/DELETE /transactions/:id and DELETE /transfers/:id returns 400 (the only :id routes that exist); the Swagger entry of each of those routes lists 400"
    - "POST /accounts with a balance whose integer part has 11 or more digits (positive or negative) returns 400, not a Postgres numeric field overflow 500; 9999999999.99 and -9999999999.99 are still accepted and round-trip exactly"
    - "Every input DTO field mapping to a decimal(12,2) column (Account.balance, Transaction.amount incl. transfers, Budget.limit on create and PATCH) goes through ONE shared decorator; the four previously copy-pasted regexes are gone and keep byte-identical accept/reject behavior and messages"
    - "A balance mutation that would leave a numeric(12,2) range (+/-9999999999.99) through POST /transactions, POST /transfers, DELETE /transactions/:id (revert) or DELETE /transfers/:id (revert) returns a controlled 400, rolls back every leg, and never a 500; PATCH /transactions/:id never touches the balance"
    - "DELETE /accounts/:id returns 409 with a static Portuguese message while at least one transaction with deleted_at IS NULL references the account via account_id, from_account_id or to_account_id (scoped to the same user_id); the account remains; with only soft-deleted transactions the soft delete proceeds exactly as today (200, {} payload)"
    - "A cross-tenant DELETE /accounts/:id still returns 404 (ownership check runs before the live-transaction count); the 409 body carries no ids, counts, SQL or stack"
  artifacts:
    - path: "src/common/validators/is-money-string.decorator.ts"
      provides: "IsMoneyString decorator + POSITIVE_MONEY_REGEX / SIGNED_MONEY_REGEX with the 10-integer-digit cap in one place"
    - path: "src/accounts/accounts.service.ts"
      provides: "remove() with the live-transaction ConflictException guard; adjustBalance overflow guard (unchanged behavior) using the shared range constant"
    - path: "test/transactions.e2e-spec.ts"
      provides: "overflow-through-adjustBalance e2e for create and delete-revert (positive and negative side)"
    - path: "test/transfers.e2e-spec.ts"
      provides: "overflow-through-adjustBalance e2e for transfer create and delete-revert incl. rollback of the first-locked leg"
  key_links:
    - from: "CreateAccountDto.balance / CreateTransactionDto.amount / CreateTransferDto.amount / CreateBudgetDto.limit / UpdateBudgetDto.limit"
      to: "IsMoneyString (shared)"
      via: "decorator + Swagger pattern taken from the exported regex source"
    - from: "AccountsService.remove"
      to: "Repository<Transaction> registered via TypeOrmModule.forFeature in AccountsModule"
      via: "count() with a three-branch where array (account_id / from_account_id / to_account_id), each branch userId + deletedAt IsNull"
    - from: "TransactionsService.create/remove, TransfersService.create/remove"
      to: "AccountsService.adjustBalance BadRequestException"
      via: "try/catch + rollbackTransaction + rethrow inside the QueryRunner transaction"
---

<objective>
Three 4xx fixes on the already checked-out branch fix/validation-4xx (do NOT create or switch branches), one atomic commit per item, code and its tests together:

1. Validate every `:id` route param as a UUID in the accounts, transactions and transfers controllers, matching categories/budgets.
2. Cap every input DTO field that maps to a decimal(12,2) column at 10 integer digits through one shared decorator, and prove (unit + e2e) that balance overflow through adjustBalance is a controlled 4xx on every write path.
3. DELETE /accounts/:id returns 409 while any non-deleted transaction references the account.

Purpose: remove client-triggerable raw 500s (malformed id, numeric overflow) and stop soft-deleting an account that still carries live transaction history.
Output: 3 commits, shared validator + specs, extra e2e coverage, a SUMMARY.md (not committed) containing the pre-change overflow table, the adjustBalance path audit, the security-review report and the manual test checklist.

Source coverage audit (quick task: no CONTEXT.md/RESEARCH.md exists; sources are the orchestrator task spec + ROADMAP/REQUIREMENTS refs):
- GOAL / SPEC-1 (ParseUUIDPipe on accounts, transactions, transfers; Swagger 400; e2e) -> Task 1
- GOAL / SPEC-2a (enumerate DTOs + report pre-change behavior) -> Task 2 step 1 + SUMMARY
- GOAL / SPEC-2b (shared 10-digit limit, negatives down to -9999999999.99) -> Task 2
- GOAL / SPEC-2c (adjustBalance overflow confirmed end to end: transactions, transfers, update, delete-revert) -> Task 2 (unit + e2e)
- GOAL / SPEC-3 (409 on live transactions, scoped, no circular dependency, Swagger 409, docs, e2e i/ii/iii, unit) -> Task 3
- REQ ACCT-01, ACCT-02, ACCT-04, TXN-02, TXN-03, TXN-05, BUD-01 -> refined (not changed) by Tasks 1-3
- RESEARCH / CONTEXT: none for this quick task. No item is deferred or unplanned.
Tracer-first note: the orchestrator fixed exactly three tasks in a fixed order; each is already a self-contained vertical slice (controller->pipe->400, DTO->validator->service->DB, service->repo->409), so no separate tracer task is added.
</objective>

<execution_context>
@D:/FinancialControl/.claude/gsd-core/workflows/execute-plan.md
@D:/FinancialControl/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/skills/security-review/SKILLS.md
@src/accounts/accounts.controller.ts
@src/accounts/accounts.service.ts
@src/common/decimal.util.ts
@src/categories/categories.controller.ts

<hard_rules>
HARD RULES for the executor (verbatim from the orchestrator; they override anything else in this plan):
- Never read or print .env.
- Never run INSERT/UPDATE/DELETE or e2e against the dev database. The dev DB runs in docker container financialcontrol-db-1 on 127.0.0.1:5433 - do not connect to it at all.
- The executor must NOT run e2e (test:e2e, the jest e2e config, e2e-local.sh, ci-gate-local.sh). The orchestrator runs infra/scripts/e2e-local.sh and infra/scripts/ci-gate-local.sh afterwards.
- Allowed local checks are only: `npx tsc -p tsconfig.build.json --noEmit`, `npx eslint` on touched files, and unit tests only (the jest unit config from package.json, rootDir src, which needs no DB; invoke as `npx jest <src paths>`, never with --config ./test/jest-e2e.json).
- No git push/rebase/stash/prune/reset --hard/checkout of other branches. Never use `git add -A` or `git add .` - stage only the exact files of each task.
- Do not touch .claude/settings.json or .planning/milestone.lock (modified/untracked on purpose; they must stay out of every commit).
- No timeout increases anywhere.
- Do not commit .planning docs (the orchestrator does it). The executor writes 261014-fqj-SUMMARY.md in the quick directory but leaves it unstaged.
- Commit messages must NOT assert causes that were not proven (describe what the change does, not "fixes the 500 caused by X"). Conventional-commit style matching git log, scope quick-261014-fqj.
Working location: D:/Financial-Control/FinancialControl, branch fix/validation-4xx. Do NOT run repo-wide `npm run format`/`npm run lint` (they rewrite unrelated files): run `npx eslint <touched files>` and, if it reports only prettier/prettier errors, `npx eslint --fix <those same touched files>`.
Security (CLAUDE.md requires the security-review checklist, .claude/skills/security-review/SKILLS.md, for every feature): error messages must not leak internals (no stack, SQL, table or constraint names, no ids/counts); the 409 must not reveal other users' data (the count is scoped by user_id and runs only after the ownership check); all queries stay TypeORM-parameterized; every touched input still passes through class-validator DTOs.
</hard_rules>

Interfaces (stable, verified by the planner by reading the code; do not re-read to confirm):
- Global ValidationPipe (AppModule APP_PIPE): whitelist + forbidNonWhitelisted + transform. e2e apps are built from AppModule only (no HttpExceptionFilter, no main.ts); success bodies are wrapped as `{ data, timestamp }`; error bodies are not. Existing e2e style: `Test.createTestingModule({ imports: [AppModule] })` with the no-op ThrottlerGuard override, `request(app.getHttpServer())`, `.set('Authorization', ...)`, bodies cast with `as EnvelopeBody<T>`, DELETE success status is 200 with `{}` data (not 204).
- `AccountsService.adjustBalance(manager, userId, id, delta): Promise<Account>` locks the row (`pessimistic_write`, deletedAt IS NULL, userId scoped), computes `addDecimalStrings(balance, delta)`, throws `BadRequestException('A operação excede o limite máximo permitido para o saldo da conta')` when `isWithinDecimalRange(newBalance, '9999999999.99')` is false, else saves. Callers: `TransactionsService.create/remove` and `TransfersService.create/remove`, always inside `queryRunner.startTransaction()` with `catch -> rollbackTransaction -> throw`. `TransactionsService.update` never calls adjustBalance (UpdateTransactionDto = description/date only); no transfer update route exists.
- Transfers lock both accounts in ascending-id order (`[from, to].sort()` on lower-cased ids); on remove the same ascending order is used with first/second deltas swapped as needed. Tests that need to hit "overflow on the second-locked leg" must derive roles from the sorted ids.
- Routes that exist: accounts GET/PATCH/DELETE `:id`; transactions GET/PATCH/DELETE `:id`; transfers DELETE `:id` only (PATCH /transfers/:id is a 404 by design and has an existing test - leave it alone).
- Columns: accounts.balance, transactions.amount, budgets.limit are all numeric(12,2) (migrations 1789300000000, 1789500000000, 1789600000000). No other decimal column exists.
- Planner pre-read of validators (executor must re-confirm with grep and record in SUMMARY): CreateAccountDto.balance uses an unbounded integer part (accepted an overflowing value before this change -> Postgres numeric overflow -> unhandled 500). CreateTransactionDto.amount, CreateTransferDto.amount, CreateBudgetDto.limit and UpdateBudgetDto.limit already cap the integer part at 10 digits via a copy-pasted Matches regex (rejected with 400 before). UpdateAccountDto, UpdateTransactionDto and the reports query DTOs carry no decimal field. Existing e2e already covers the 11-digit amount for transactions (test/transactions.e2e-spec.ts, "overflows numeric(12,2)") and transfers (test/transfers.e2e-spec.ts, same title); budgets and accounts have none.
- No README/docs file lists the DELETE /accounts contract (README.md and infra/README.md have no accounts/409 text); the Swagger decorators ARE the contract doc.
- No new npm packages in this plan.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Validate every :id route param as a UUID in accounts, transactions, transfers (+ Swagger 400, e2e)</name>
  <files>src/accounts/accounts.controller.ts, src/transactions/transactions.controller.ts, src/transfers/transfers.controller.ts, test/accounts.e2e-spec.ts, test/transactions.e2e-spec.ts, test/transfers.e2e-spec.ts</files>
  <read_first>
    src/categories/categories.controller.ts (the exact pattern to copy: import list + pipe on each id param + ApiErrorResponses(400, ...));
    the three controllers above; test/categories.e2e-spec.ts "a malformed :id on GET/PATCH/DELETE returns 400" (the e2e shape to mirror);
    the top-level helpers/describe layout of each of the three e2e files you edit (read only the first ~100 lines and the describe you extend, using offset/limit).
  </read_first>
  <action>
    Hard rules in `<hard_rules>` apply. Mechanical task, no service logic.

    1. Controllers. In each of the three controllers add ParseUUIDPipe to the existing `@nestjs/common` import and pass it as the second argument of the id param decorator on EVERY route that has an `:id` segment, exactly as categories.controller.ts and budgets.controller.ts do. Routes: accounts findOne/update/remove (currently around lines 77/94/114), transactions findOne/update/remove (around 85/103/126), transfers remove (around 67). Keep parameter order, names and types unchanged.
    2. Swagger. The pipe now yields 400, so make `@ApiErrorResponses` list 400 on every one of those routes: accounts findOne -> (400, 401, 404) and remove -> (400, 401, 404); transactions findOne -> (400, 401, 404) and remove -> (400, 401, 404); transfers remove -> (400, 401, 404). The two PATCH routes (accounts, transactions) already list 400 - leave them. Do not add 409 here (Task 3 owns it).
    3. e2e. Add one `it` to each file, titled like the categories one ("a malformed :id ... returns 400, not a raw 500"), using the id string `not-a-uuid` and the file's existing authenticated `accessToken`:
       - test/accounts.e2e-spec.ts (inside the existing "list/view/update/delete" describe): GET, PATCH with body `{ name: 'Novo Nome' }`, DELETE -> each expects status 400.
       - test/transactions.e2e-spec.ts (inside the existing "list/view/update/delete transaction" describe): GET, PATCH with body `{ description: 'nova descricao' }`, DELETE -> each 400.
       - test/transfers.e2e-spec.ts (inside "delete transfer"): DELETE only -> 400. Do not touch the existing PATCH -> 404 test (no PATCH route exists by design).
       Assert `.status` with `toBe(400)` exactly as the categories test does. Do not run these e2e (hard rules); the orchestrator does.
    4. Run the verify command, fix findings, then commit only these six files: `git add` the six paths explicitly, then commit with message `fix(quick-261014-fqj): validate :id as UUID in accounts, transactions, transfers`.
  </action>
  <verify>
    <automated>npx tsc -p tsconfig.build.json --noEmit && npx eslint src/accounts/accounts.controller.ts src/transactions/transactions.controller.ts src/transfers/transfers.controller.ts test/accounts.e2e-spec.ts test/transactions.e2e-spec.ts test/transfers.e2e-spec.ts && for f in src/accounts/accounts.controller.ts src/transactions/transactions.controller.ts src/transfers/transfers.controller.ts; do a=$(grep -c "@Param('id'" $f); b=$(grep -c "@Param('id', ParseUUIDPipe)" $f); echo "$f total=$a piped=$b"; [ "$a" -gt 0 ] && [ "$a" = "$b" ] || exit 1; done</automated>
  </verify>
  <done>Every id param in the three controllers carries ParseUUIDPipe (accounts 3, transactions 3, transfers 1; count of piped params equals count of id params); Swagger lists 400 on all seven routes; three new e2e tests assert 400 for GET/PATCH/DELETE (accounts, transactions) and DELETE (transfers); tsc and ESLint are clean; one commit exists containing exactly the six files.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Shared 10-integer-digit money validator on every decimal(12,2) input DTO field + overflow-through-adjustBalance proof</name>
  <files>src/common/validators/is-money-string.decorator.ts, src/common/validators/is-money-string.decorator.spec.ts, src/common/decimal.util.ts, src/common/decimal.util.spec.ts, src/accounts/dto/create-account.dto.ts, src/transactions/dto/create-transaction.dto.ts, src/transfers/dto/create-transfer.dto.ts, src/budgets/dto/create-budget.dto.ts, src/budgets/dto/update-budget.dto.ts, src/accounts/accounts.service.ts, src/accounts/accounts.service.spec.ts, test/accounts.e2e-spec.ts, test/budgets.e2e-spec.ts, test/transactions.e2e-spec.ts, test/transfers.e2e-spec.ts</files>
  <read_first>
    the five DTO files above (current Matches regexes, messages, ApiProperty pattern/description);
    src/accounts/accounts.service.ts (adjustBalance and its ACCOUNT_BALANCE_MAX_ABS constant);
    src/common/decimal.util.ts and decimal.util.spec.ts (style of the existing unit tests; isWithinDecimalRange is currently untested);
    src/accounts/accounts.service.spec.ts (adjustBalance describe: mockManager with findOne/save);
    src/transactions/dto/update-transaction.dto.spec.ts (plainToInstance + validate style for DTO unit tests);
    src/transactions/transactions.service.ts and src/transfers/transfers.service.ts (create/remove: confirm each adjustBalance call sits inside try/catch -> rollbackTransaction -> rethrow, and that TransactionsService.update never calls adjustBalance);
    the e2e files you extend: test/accounts.e2e-spec.ts ("create account" describe), test/budgets.e2e-spec.ts (create/PATCH style, categories + budgets helpers), test/transactions.e2e-spec.ts (inline POST /accounts and POST /transactions style, existing overflow test near "overflows numeric(12,2)"), test/transfers.e2e-spec.ts (createAccount/getBalance/createTransfer helpers, beforeEach). Read slices with offset/limit.
    .claude/skills/security-review/SKILLS.md (checklist reported in SUMMARY).
  </read_first>
  <behavior>
    Unit, shared decorator (exercise the real DTOs with plainToInstance + validate, table-driven):
    - CreateAccountDto.balance (signed): '9999999999.99', '-9999999999.99', '0', '0.00', '-0.50', '1500.00' pass; '10000000000.00', '-10000000000.00', '12345678901', '99999999999.99', '1.234', '', 'abc', '+5', '.5', null and a JSON number 5 fail with a validation error on `balance`.
    - Positive kind (CreateTransactionDto.amount, CreateTransferDto.amount, CreateBudgetDto.limit, UpdateBudgetDto.limit when present): '9999999999.99', '0.01', '1234.56' pass; '0', '0.00', '-1.00', '10000000000.00', '1.234', null, number 5 fail; UpdateBudgetDto with `limit` omitted passes and `limit: null` fails (CR-02 behavior preserved).
    - The exported regexes' `.source` equals the strings the four old DTOs advertised in Swagger (positive: caret, negative lookahead for all-zero, 1-10 integer digits, optional 1-2 decimals, dollar; the signed one is the same without the lookahead and with an optional leading minus) so the OpenAPI output of those four fields is unchanged.
    - Boundary agreement: for '9999999999.99' and '-9999999999.99' both the validator accepts and `isWithinDecimalRange(value, NUMERIC_12_2_MAX_ABS)` is true; for '10000000000.00' and '-10000000000.00' both reject / false.
    Unit, decimal.util: isWithinDecimalRange true at 0, +/-max, false at +/-(max + 0.01), '-0.00' true.
    Unit, AccountsService.adjustBalance (characterization of the WR-03 guard): '9999999999.99' + '0.01' -> BadRequestException and save not called; '9999999998.99' + '1.00' -> saved with '9999999999.99'; '-9999999999.99' + '-0.01' -> BadRequestException, save not called; '-9999999998.99' + '-1.00' -> saved with '-9999999999.99'; the exception message equals the existing static Portuguese string (no ids, no numbers).
  </behavior>
  <reversibility rating="reversible">Stricter input validation on POST /accounts only (other fields already capped); no data or schema change; revert the commit to restore the old behavior.</reversibility>
  <action>
    Hard rules in `<hard_rules>` apply. Work red-first, then green. Commit once at the end of the task.

    1. Enumerate and record. Grep src for decimal columns (`decimal`/`numeric` in entities and migrations) and for money validators on every input DTO (Matches/IsDecimal/IsNumberString/IsNumber usage, plus every Create*/Update* DTO). Confirm or correct the planner pre-read in `<context>`; keep the final table (DTO field, column, validator before, accepted an 11-integer-digit value before: yes/no) for the SUMMARY. Do not assume - base each row on the validator text you read.
    2. RED. Write src/common/validators/is-money-string.decorator.spec.ts per `<behavior>` (table-driven with it.each; plainToInstance + validate on the real DTO classes, mirroring update-transaction.dto.spec.ts) and extend src/common/decimal.util.spec.ts and src/accounts/accounts.service.spec.ts with the isWithinDecimalRange and adjustBalance cases. Run `npx jest src/common src/accounts`: the decorator spec must fail (module does not exist yet) while the range/adjustBalance characterization tests pass against the unchanged production code.
    3. GREEN - shared validator. Create src/common/validators/is-money-string.decorator.ts exporting: a constant for the maximum integer digits (10); POSITIVE_MONEY_REGEX (no sign, not all-zero, at most 2 decimals, at most 10 integer digits - identical accept/reject set to the regex currently copy-pasted in the four DTOs); SIGNED_MONEY_REGEX (optional leading minus, zero allowed, at most 2 decimals, at most 10 integer digits); and the decorator factory IsMoneyString taking the kind ('positive' | 'signed') and the validation message, implemented as a thin wrapper over class-validator's Matches so null/undefined/non-string values keep failing exactly as before (UpdateBudgetDto relies on ValidateIf plus this failing for null). Build both regexes from the single digit-count constant so the limit lives in one place. Add a short doc comment naming numeric(12,2) as the reason for the cap. Also export NUMERIC_12_2_MAX_ABS ('9999999999.99') from src/common/decimal.util.ts and make AccountsService.adjustBalance import and use it in place of its local ACCOUNT_BALANCE_MAX_ABS constant (delete the local constant; keep its explanatory comment text attached to the import usage). No other change to adjustBalance.
    4. GREEN - DTOs. Replace the Matches decorator on CreateAccountDto.balance (kind signed), CreateTransactionDto.amount, CreateTransferDto.amount, CreateBudgetDto.limit and UpdateBudgetDto.limit (kind positive) with IsMoneyString. Keep the existing messages byte-identical for the four positive fields; for the account balance use the message "balance deve ser uma string decimal com até 2 casas decimais e no máximo 10 dígitos na parte inteira". Take each ApiProperty/ApiPropertyOptional `pattern` from the exported regex's `.source` instead of a hand-written string, update the account balance description to say max 10 integer digits (range -9999999999.99 to 9999999999.99, negative allowed, same for every account type), drop or reword DTO comments that describe the removed hand-written regex, and remove now-unused `Matches` imports. UpdateBudgetDto keeps its ValidateIf-based optional handling untouched. No DTO may keep a hand-written money regex.
    5. Overflow-through-adjustBalance audit (SPEC-2c). Re-read the create/remove methods of TransactionsService and TransfersService plus TransactionsService.update and confirm the planner conclusion: every adjustBalance call is inside the QueryRunner try block whose catch rolls back and rethrows, so the BadRequestException surfaces as 400 with all legs rolled back; update never touches balances. Record file/line evidence per path in the SUMMARY. If you find a path that can still end in a non-HttpException (500), fix it in this task and add a unit test for it; the planner found none, and the only unguarded entry to the overflow was the unbounded account balance input.
    6. e2e additions (written, not run). Follow each file's existing helper style; use unique names; assert exact balance strings via GET /accounts/:id.
       - test/accounts.e2e-spec.ts, "create account": (a) POST /accounts with balance '10000000000.00', '-10000000000.00' and '12345678901' -> each 400 (assert 400, never 500); (b) POST with balance '9999999999.99' and with '-9999999999.99' -> 201 and the response/GET balance round-trips exactly.
       - test/budgets.e2e-spec.ts: POST /budgets with limit '12345678901.00' -> 400; PATCH /budgets/:id with limit '12345678901.00' -> 400 and the stored limit unchanged; PATCH with limit '9999999999.99' -> 200. Reuse that file's despesa-category + budget creation style.
       - Amount 11-digit rejection for transactions and transfers is already covered by the existing e2e tests named above - do not duplicate them; just confirm they still use an 11-integer-digit amount.
       - test/transactions.e2e-spec.ts, new describe "balance overflow (numeric(12,2))" with inline account creation (balance set at creation is the fastest way to sit at the limit) and the file's existing categoryId: (A) account '9999999999.99': POST income '0.01' -> 400, balance still '9999999999.99'; account '9999999998.99' + income '1.00' -> 201 and balance '9999999999.99' (exact limit allowed). (B) account '-9999999999.99': POST expense '0.01' -> 400, balance unchanged; account '-9999999998.99' + expense '1.00' -> 201 and balance '-9999999999.99'. (C) delete-revert, positive side: account '9999999899.99'; POST expense '100.00' (balance '9999999799.99'); POST income '200.00' (balance '9999999999.99'); DELETE the expense -> 400 (revert would reach 10000000099.99), the expense still readable via GET /transactions/:id (200) and the balance still '9999999999.99'; then PATCH that expense with a new description -> 200 and balance unchanged (update path never touches the balance). (D) delete-revert, negative side: account '-9999999899.99'; POST income '100.00' ('-9999999799.99'); POST expense '200.00' ('-9999999999.99'); DELETE the income -> 400, balance unchanged, income still readable.
       - test/transfers.e2e-spec.ts, new describe "balance overflow (numeric(12,2))": add a helper that creates two accounts with balance '0.00' and returns their ids sorted ascending as lowId/highId (same sort the service uses), a helper that funds an account with an income POST /transactions of a given amount (needs one category created via POST /categories in the describe's beforeAll), and use the file's createAccount/getBalance/createTransfer helpers. (A) second-locked leg overflows, first leg must roll back: fund lowId '100.00' and highId '9999999999.99'; POST /transfers lowId -> highId '1.00' -> 400; lowId still '100.00', highId still '9999999999.99'; GET /transactions contains no transfer between the two. (B) first-locked leg overflows: fund lowId '9999999999.99' and highId '100.00'; POST /transfers highId -> lowId '1.00' -> 400; both balances unchanged. (C) negative side: account created with '-9999999999.99' transferring '0.01' to a normal account -> 400, both balances unchanged. (D) delete-revert overflow with rollback of the first leg: fund highId '9999999799.99'; POST /transfers highId -> lowId '100.00' (201: high '9999999699.99', low '100.00'); fund highId '300.00' (high '9999999999.99'); DELETE /transfers/:id -> 400, lowId back at '100.00' (rolled back), highId '9999999999.99', and the transfer still appears in GET /transactions.
    7. Verify, then commit only the task files (explicit `git add` of the paths in `<files>`; skip any listed path you ended up not modifying) with message `fix(quick-261014-fqj): limit decimal(12,2) inputs to 10 integer digits via shared validator; cover balance overflow paths`.
  </action>
  <verify>
    <automated>npx tsc -p tsconfig.build.json --noEmit && npx eslint src/common/validators/is-money-string.decorator.ts src/common/validators/is-money-string.decorator.spec.ts src/common/decimal.util.ts src/common/decimal.util.spec.ts src/accounts/dto/create-account.dto.ts src/transactions/dto/create-transaction.dto.ts src/transfers/dto/create-transfer.dto.ts src/budgets/dto/create-budget.dto.ts src/budgets/dto/update-budget.dto.ts src/accounts/accounts.service.ts src/accounts/accounts.service.spec.ts test/accounts.e2e-spec.ts test/budgets.e2e-spec.ts test/transactions.e2e-spec.ts test/transfers.e2e-spec.ts && npx jest src/common src/accounts src/transactions src/transfers src/budgets && [ -z "$(grep -rnE 'd\{1,10\}' src --include=*.ts | grep -v 'src/common/validators/' | grep -Ev ':[0-9]+:[[:space:]]*(//|\*)')" ] && for f in src/accounts/dto/create-account.dto.ts src/transactions/dto/create-transaction.dto.ts src/transfers/dto/create-transfer.dto.ts src/budgets/dto/create-budget.dto.ts src/budgets/dto/update-budget.dto.ts; do grep -v '^[[:space:]]*\(//\|\*\)' $f | grep -c "IsMoneyString(" | grep -qx 1 || { echo "missing IsMoneyString in $f"; exit 1; }; done</automated>
  </verify>
  <done>One shared IsMoneyString decorator guards Account.balance (signed) and Transaction.amount, transfer amount, Budget.limit create+PATCH (positive); no DTO keeps a hand-written money regex (comment-filtered grep is empty); unit specs for the decorator (all five DTO fields at the 10/11-digit boundary, null/number rejection, Swagger pattern equality), isWithinDecimalRange and the four adjustBalance boundary cases pass; e2e (written, run later by the orchestrator) cover 11-digit rejection for accounts and budgets (create + PATCH), exact-limit acceptance, and overflow-through-adjustBalance as 400 with rollback for transaction create, transaction delete-revert (both signs), transfer create (both lock positions, negative side) and transfer delete-revert; the SUMMARY lists which DTO accepted an overflowing value before the change; tsc, ESLint and the touched unit suites are green; one commit with exactly the task files.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: DELETE /accounts/:id returns 409 while the account has non-deleted transactions (service, module, Swagger, tests)</name>
  <files>src/accounts/accounts.service.ts, src/accounts/accounts.module.ts, src/accounts/accounts.controller.ts, src/common/swagger/api-error-responses.decorator.ts, src/accounts/accounts.service.spec.ts, test/accounts.e2e-spec.ts</files>
  <read_first>
    src/accounts/accounts.service.ts, src/accounts/accounts.module.ts (state after Task 2);
    src/transfers/transfers.module.ts (precedent: a module registering its own TypeOrmModule.forFeature([Transaction]) without importing the transactions module);
    src/transactions/entities/transaction.entity.ts (property names accountId / fromAccountId / toAccountId / deletedAt / userId);
    src/categories/categories.service.ts (ConflictException usage and Portuguese message style);
    src/accounts/accounts.service.spec.ts (module setup with getRepositoryToken mocks; the existing remove describe);
    test/accounts.e2e-spec.ts (helpers/interfaces at the top; existing delete tests; add a categories + transactions slice) and test/transfers.e2e-spec.ts (createTransfer shape: fromAccountId, toAccountId, amount, date, description).
  </read_first>
  <behavior>
    Unit, AccountsService.remove (mock Repository<Account> as today plus a mock Repository<Transaction> with `count`):
    - live transactions exist (count resolves 1): rejects with ConflictException whose message is exactly the static Portuguese string; accountsRepository.update is NOT called; count is called exactly once with a where ARRAY of three branches - one each for accountId, fromAccountId and toAccountId equal to the account id - and every branch also carries the caller's userId and deletedAt equal to IsNull().
    - no live transactions (count resolves 0): soft delete proceeds with the same scoped partial update as before ({ id, userId, deletedAt: IsNull() } -> { deletedAt: any Date }), no save/delete/remove call.
    - account not found / not owned (accountsRepository.findOne resolves null): rejects with NotFoundException and count is NEVER called (ownership check precedes the count, so another user's account cannot be probed through the 409).
    - count resolves 0 but the scoped update reports affected 0 (concurrent soft delete): still NotFoundException (existing WR-02 race test keeps passing).
    - the ConflictException message contains neither the account id nor any digit.
    e2e (accounts.e2e-spec.ts): (i) live expense on the account -> DELETE 409 and the account is still readable with the post-expense balance; (ii) create expense, DELETE the transaction (200), then DELETE the account -> 200 and a later GET is 404; (iii-to) account used only as to_account_id of a live transfer -> 409; (iii-from) the source account of the same transfer -> 409; both remain readable; (iv) after DELETE /transfers/:id (200) both accounts can be deleted (200).
  </behavior>
  <reversibility rating="reversible">API contract addition (new 409 on DELETE /accounts/:id); no schema or data change; revert the commit to restore the previous behavior.</reversibility>
  <action>
    Hard rules in `<hard_rules>` apply. Work red-first.

    1. RED. In src/accounts/accounts.service.spec.ts register a second mock provider via getRepositoryToken(Transaction) exposing a `count` jest.fn, expose it as a typed `jest.Mocked<Repository<Transaction>>` variable like the existing accountsRepository, default its count to resolve 0 in beforeEach so the existing remove/update tests keep their meaning, then add the cases from `<behavior>`. Run `npx jest src/accounts`: the new Conflict/ownership-order cases must fail before the implementation.
    2. GREEN - wiring. In src/accounts/accounts.module.ts extend the existing TypeOrmModule.forFeature call to register the Transaction entity next to Account, the same independent-registration precedent TransfersModule uses. This is the least invasive option: the accounts module must NOT import the transactions module or service and must not use forward references, so no circular dependency is introduced (TransactionsModule and TransfersModule already import AccountsModule). Update the explanatory comment on the module accordingly.
    3. GREEN - service. Inject Repository<Transaction> into AccountsService with InjectRepository(Transaction) (import the entity from the transactions entities folder - entity import only). In remove(): keep `findOne(userId, id)` first (404 for missing, soft-deleted or foreign accounts); then call transactionsRepository.count with a where array of three branches (accountId = id, fromAccountId = id, toAccountId = id), each with userId and deletedAt IsNull(); if the count is greater than zero throw ConflictException with the static message "Não é possível excluir a conta: existem transações vinculadas a ela" (no id, count, SQL or table name in the message); otherwise perform the existing scoped soft-delete update unchanged, including the affected===0 -> NotFoundException guard. Only parameterized TypeORM find options are used - no query strings. Update the method's comment to state the rule (live = deleted_at IS NULL; soft-deleted transactions do not block).
    4. Swagger. In src/accounts/accounts.controller.ts change the remove route to `@ApiErrorResponses(400, 401, 404, 409)` and add a `description` to its ApiOperation stating that deletion is rejected with 409 while any non-deleted income, expense or transfer (as source or destination) references the account. In src/common/swagger/api-error-responses.decorator.ts the 409 description currently says the resource already exists, which does not describe this route (the account exists but is still referenced): reword it to a neutral sentence (the request conflicts with the current state of the resource, for example it already exists or is still referenced) that still reads correctly for the existing auth, categories and budgets 409 routes. 409 is already an accepted DocumentedErrorStatus - no type change needed.
    5. Docs. Re-grep README.md, infra/README.md and any docs folder for a DELETE /accounts contract; the planner found none (Swagger is the contract doc), so edit a file only if the grep proves otherwise, and say which in the SUMMARY.
    6. e2e (written, not run). In test/accounts.e2e-spec.ts add the CategoryData/TransactionData/TransferData interfaces it needs and a new describe "delete account with transactions (409)" with a beforeAll that creates one despesa category with the shared accessToken. Implement (i), (ii), (iii-to), (iii-from), (iv) from `<behavior>`; use fresh accounts per test (corrente '100.00' / '0.00'), expense or transfer amount '10.00', date '2026-09-13'. For each 409 assert `.status` toBe(409), that `body.message` equals the static string, and that the body does not contain the account id.
    7. Verify, write 261014-fqj-SUMMARY.md in the quick directory (leave it unstaged): (a) the pre-change overflow table from Task 2, (b) the adjustBalance path audit with file/line evidence (transactions create / delete-revert, transfers create / delete-revert, update never calls adjustBalance), (c) behavior notes - leading-zero amounts such as 00000000001.00 are now rejected on account creation exactly as they already were for transactions; DELETE /transactions/:id on an account that is later soft-deleted can no longer happen because accounts with live transactions cannot be deleted; known limitation, not in scope: a transaction created concurrently in the narrow window between the count and the soft-delete update is not blocked (a locked check inside one DB transaction would close it - offer as follow-up), (d) the security-review checklist report in the project's format (applied / needs attention) covering DTO validation, parameterized queries, ownership scoping, no leaked internals, (e) commit hashes, (f) a manual test checklist per CLAUDE.md, and (g) the reminder that the orchestrator must now run infra/scripts/e2e-local.sh and infra/scripts/ci-gate-local.sh. Then commit only the six task files (explicit `git add`) with message `feat(quick-261014-fqj): reject DELETE /accounts/:id with 409 while non-deleted transactions reference the account`. Finish with `git status --short`: only .claude/settings.json (modified), .planning/milestone.lock and the unstaged .planning quick files may remain.
  </action>
  <verify>
    <automated>npx tsc -p tsconfig.build.json --noEmit && npx eslint src/accounts/accounts.service.ts src/accounts/accounts.module.ts src/accounts/accounts.controller.ts src/common/swagger/api-error-responses.decorator.ts src/accounts/accounts.service.spec.ts test/accounts.e2e-spec.ts && npx jest src/accounts src/transactions src/transfers src/reports src/budgets && grep -n "forFeature(\[Account, Transaction\])" src/accounts/accounts.module.ts && grep -n "ApiErrorResponses(400, 401, 404, 409)" src/accounts/accounts.controller.ts && [ -z "$(grep -rnE 'TransactionsModule|TransactionsService|forwardRef' src/accounts --include=*.ts | grep -Ev ':[0-9]+:[[:space:]]*(//|\*)')" ]</automated>
  </verify>
  <done>AccountsService.remove returns 409 (ConflictException, static Portuguese message, no ids/counts) when count over account_id / from_account_id / to_account_id with userId and deletedAt IS NULL is above zero, runs after the ownership 404, and otherwise soft-deletes exactly as before; AccountsModule registers Transaction through forFeature with no import of the transactions module or service (comment-filtered grep is empty); Swagger shows 409 on DELETE /accounts/:id with a description and the 409 wording is neutral; unit tests for all five remove cases pass; e2e (i)-(iv) are written; tsc, ESLint and the dependent unit suites are green; docs grep result recorded; one commit with exactly the six task files; SUMMARY.md written but not staged.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client -> route params | `:id` is attacker-controlled text that reaches uuid-typed Postgres columns |
| client -> request body | money fields (balance, amount, limit) are attacker-controlled decimal strings bound for numeric(12,2) |
| tenant A -> tenant B data | DELETE /accounts/:id could be used to probe whether another user's account has transactions |
| API -> client error bodies | exception messages cross the HTTP boundary |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-261014-01 | Denial of Service / Information disclosure | `:id` params on accounts, transactions, transfers | medium | mitigate | ParseUUIDPipe on every id param (Task 1) so malformed ids are rejected at the edge with 400 instead of reaching the database; e2e asserts 400 on each route |
| T-261014-02 | Denial of Service / Tampering | money inputs and balance mutations vs numeric(12,2) | medium | mitigate | Shared IsMoneyString caps the integer part at 10 digits on all five decimal input fields (Task 2); adjustBalance range guard already converts a would-be overflow into a controlled 400 inside the rolled-back QueryRunner transaction; unit + e2e prove every write path |
| T-261014-03 | Information disclosure | 400/409 messages | low | mitigate | Static Portuguese messages only (existing adjustBalance string, new 409 string, DTO messages); no stack, SQL, table/constraint names, ids or counts; global HttpExceptionFilter keeps unexpected errors generic |
| T-261014-04 | Information disclosure (cross-tenant IDOR) | DELETE /accounts/:id 409 | medium | mitigate | Ownership check (userId + deletedAt scoped findOne -> 404) runs before the live-transaction count; the count is also scoped by userId; unit test proves count is never reached for a foreign/missing account; existing cross-tenant e2e (404) stays valid |
| T-261014-05 | Tampering / Repudiation (ledger integrity) | soft-deleting an account that still has live transactions | medium | mitigate | 409 guard on account_id / from_account_id / to_account_id with deleted_at IS NULL (Task 3); tracks ACCT-04 (no drift between stored balance and its transactions) |
| T-261014-06 | Tampering | race between the live-transaction count and the soft-delete write | low | accept | Narrow window, single-user personal finance data; adjustBalance's row lock plus deletedAt IS NULL check already makes a create after the delete fail with 404; documented in SUMMARY with the locked-check follow-up option |

No package installs in this plan, so no T-{phase}-SC supply-chain entry or legitimacy checkpoint applies.
</threat_model>

<verification>
Executor (local, no DB, no e2e):
1. After each task: the task's `<verify>` command is green and `git show --stat HEAD` lists exactly that task's files.
2. After Task 3: `npx tsc -p tsconfig.build.json --noEmit`; `npx jest src` (full unit suite) green; `git log --oneline -3` shows the three fix/fix/feat commits on fix/validation-4xx; `git status --short` shows nothing staged and only the pre-existing .claude/settings.json and .planning/milestone.lock (plus unstaged .planning quick files).
Orchestrator (afterwards, not the executor): `bash infra/scripts/e2e-local.sh` then `bash infra/scripts/ci-gate-local.sh`. Expected: all existing e2e still pass (no existing test deletes an account that has live transactions - the only account deletes are in accounts.e2e-spec.ts and reports.e2e-spec.ts on transaction-free accounts, and the cross-tenant one expects 404), plus the new tests from Tasks 1-3.
</verification>

<success_criteria>
- Three commits, in order, each containing only its task's files and its own tests; commit messages describe the change without asserting unproven causes.
- A non-UUID :id yields 400 on every existing :id route of accounts, transactions, transfers; Swagger lists 400.
- One shared validator enforces the 10-integer-digit cap on Account.balance (signed, down to -9999999999.99) and Transaction/transfer amount and Budget.limit (create + PATCH); an 11-digit input is a 400 for every field; balance overflow through adjustBalance is a 400 with full rollback on every write path.
- DELETE /accounts/:id returns 409 for live transactions on any side (account_id, from_account_id, to_account_id), proceeds when only soft-deleted ones exist, keeps 404 for foreign accounts, and is documented in Swagger.
- SUMMARY.md (unstaged) carries the pre-change DTO overflow table, the path audit, the security-review report and the manual test checklist; no hard rule was violated (no .env read, no dev DB access, no e2e run, no forbidden git operation).
</success_criteria>

<output>
Create `.planning/quick/261014-fqj-branch-fix-validation-4xx-parseuuidpipe-/261014-fqj-SUMMARY.md` when done (unstaged; the orchestrator commits .planning docs).
</output>
