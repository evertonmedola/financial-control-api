---
phase: quick-261001-k0j-credit-card-balance
plan: 01
subsystem: reports/accounts
tags: [credit-card, net-balance, swagger, tests]
requires: []
provides:
  - "getNetBalance as a uniform decimal-string sum of all account balances (card debt = negative balance)"
affects: [reports, accounts, swagger-docs]
key-files:
  modified:
    - src/reports/reports.service.ts
    - src/reports/reports.service.spec.ts
    - src/accounts/accounts.service.spec.ts
    - src/transactions/transactions.service.spec.ts
    - src/accounts/dto/account-response.dto.ts
    - src/accounts/dto/create-account.dto.ts
    - src/reports/dto/net-balance-response.dto.ts
    - src/reports/reports.controller.ts
    - test/reports.e2e-spec.ts
    - test/accounts.e2e-spec.ts
    - .planning/PROJECT.md
  created:
    - test/credit-card.e2e-spec.ts
decisions:
  - "Credit-card balance follows the same sign convention as every account (negative = open debt); net balance is a plain sum (option B; supersedes Phase 2 D-01 and Phase 6 per-type netting)"
status: complete
requirements: [ACCT-03, REP-02]
commits: 3
plan_head_before: 7275d912e3d4c6370d1464d8e2766b491eb117e7
actuals:
  tasks: 3
  commits: 3
---

# Quick 261001-k0j: Credit card balance semantics (option B) Summary

`ReportsService.getNetBalance` is now a plain sum of every non-deleted account balance, so a cartao_credito at 0.00 charged R$ 100 reads -100.00 and nets -100.00; a payment (transfer corrente -> card) moves the card toward 0.00 without changing the net balance.

## Commits (branch fix/credit-card-balance-semantics)

| Task | Hash | Message |
| ---- | ---- | ------- |
| 1 (tracer) | 87eaefa | fix(quick-261001-k0j): net balance is a uniform sum, card debt = negative balance |
| 2 | 7f31ce1 | test(quick-261001-k0j): card payment reduces debt; type-agnostic balance regression guards |
| 3 | 68f326a | docs(quick-261001-k0j): Swagger/DTO wording and decision log - negative card balance = open debt |

## What changed

- `getNetBalance`: removed `AccountType` branching, `assets`/`debt` locals and the unused `subtractDecimalStrings`/`AccountType` imports; folds balances with `addDecimalStrings` only. Still sourced from `accountsService.findAll(userId)` (userId + deletedAt IS NULL scoped).
- Unit tests: negative card (-300.00 -> net 700.00), all-card debt (-150.00), positive card balance added (120.00), 0.00 card (100.00), all-asset and empty cases unchanged. Red proof: 3 of 15 failed against the old implementation before the fix, 15/15 after.
- New `test/credit-card.e2e-spec.ts`: tracer (card 0.00 + R$100 expense -> account -100.00, net -100.00) and payment scenario (card -100.00 / net 900.00; transfer 40.00 -> card -60.00, corrente 960.00, net 900.00; transfer 60.00 -> card 0.00, corrente 900.00, net 900.00).
- `test/reports.e2e-spec.ts` uses a '-300.00' card; `test/accounts.e2e-spec.ts` retitled, rows `['cartao_credito','0.00']` and `['cartao_credito','-500.00']` added.
- Regression guards: `adjustBalance` on a CARTAO_CREDITO account (0.00 -> -100.00 -> 0.00) and `TransactionsService.create` expense/income on a card (-100.00 / 100.00). No production code changed in the write path.
- Swagger/DTO text (account response, create account incl. code comment, net-balance response, controller summary) now says negative card balance = open debt. `grep -rniE 'amount owed|valor devido' src test` is clean.
- `.planning/PROJECT.md` key-decision row replaced with the option B decision (Quick 261001-k0j).

## Verification (real output)

- Unit: `npm test` -> Test Suites: 10 passed, 10 total; Tests: 99 passed, 99 total.
- Build: `npm run build` (nest build) compiled with no errors.
- ESLint on every changed .ts file: 0 errors (only the pre-existing `no-unsafe-argument` warnings that every supertest e2e file in this repo emits).
- E2E EXECUTED against a throwaway PostgreSQL 16 container (port 5499, migrations applied, env vars passed inline, no .env created, nothing committed; container removed afterwards; the user's dev DB on 5433 was not touched):
  - `npm run test:e2e -- credit-card reports accounts transfers transactions` (path patterns also matched the cross-tenant specs): Test Suites: 9 passed, 9 total; Tests: 92 passed, 92 total.
  - Full e2e serial, `npm run test:e2e -- --runInBand`: Test Suites: 17 passed, 17 total; Tests: 173 passed, 173 total.
  - Full e2e in default parallel mode against the single shared throwaway DB was flaky in this environment: one run 7 suites failed / 24 tests failed, another run 3 tests failed, a third had no visible failures; the failing suites differed between runs (auth, categories, cross-tenant, transactions, accounts) and each passes in isolation and serially. This is parallel-worker contention on one shared DB, not related to the changed code (all failing specs were in files this task did not alter or only touched in unrelated tests); not investigated further. `bash infra/scripts/ci-gate-local.sh` was not run.

## Deviations from Plan

None - plan executed as written. (Environment note only: e2e DB was a self-started throwaway container rather than an existing .env.)

## Dev-data note for the user (local DB only)

The repo has no seed script, seed SQL or data migrations, so nothing in the repo needed migrating and no applied migration was touched. Any credit-card row in your LOCAL database created under the old convention (positive balance meaning "I owe X") will now read as a positive asset, and cards that also received expenses were moved in the opposite direction of their convention, so the stored number is unreliable. Fix by hand on the local DB only: `UPDATE accounts SET balance = -<real outstanding> WHERE id = '<card id>';` or delete the card and recreate it with a negative initial balance. The AWS stack is throwaway-data-only, so no production migration is planned.

## Known Stubs

None.

## Threat Flags

None (no new endpoints, inputs or trust boundaries; DTO validators untouched). T-quick-01 mitigated: data source remains `accountsService.findAll(userId)`; cross-tenant reports e2e stays green.

## Self-Check: PASSED

- Commits 87eaefa, 7f31ce1, 68f326a exist on fix/credit-card-balance-semantics; `git rev-list --count 7275d91..HEAD` = 3.
- test/credit-card.e2e-spec.ts exists; only the 12 planned files changed; main checkout D:/FinancialControl untouched.
