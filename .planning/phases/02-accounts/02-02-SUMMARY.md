---
phase: 02-accounts
plan: 02
subsystem: api
tags: [nestjs, typeorm, postgres, accounts, soft-delete, idor, e2e-testing]

requires:
  - phase: 02-accounts
    provides: "AccountsService.create(), Account entity (decimal balance, deletedAt column), AccountsModule/Controller scaffold from 02-01"
provides:
  - "GET /accounts — list caller's own non-deleted accounts, createdAt-ascending order"
  - "GET /accounts/:id — view a single owned account, 404 on any ownership mismatch"
  - "PATCH /accounts/:id — rename only; balance/type rejected 400 (forbidNonWhitelisted)"
  - "DELETE /accounts/:id — soft delete (deletedAt), excluded from subsequent reads, idempotent 404 on repeat"
  - "test/accounts-cross-tenant.e2e-spec.ts — dedicated two-user IDOR suite for the Accounts module"
affects: [02-accounts (02-03), 04-transactions-transfers]

actuals:
  tokens: 5900
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "findOne() is the shared ownership-check gate — update()/remove() both call it first, so mutation never happens before the 404 check (Pitfall 3)"
    - "Soft delete via deletedAt timestamp + deletedAt IsNull() filter on every find/findOne — never .delete()/.remove() on the repository (D-03)"
    - "PATCH body-shape lock (balance/type) enforced entirely by DTO field omission + global forbidNonWhitelisted:true — no manual guard code in the service"

key-files:
  created:
    - src/accounts/dto/update-account.dto.ts
    - test/accounts-cross-tenant.e2e-spec.ts
  modified:
    - src/accounts/accounts.service.ts
    - src/accounts/accounts.controller.ts
    - src/accounts/accounts.service.spec.ts
    - test/accounts.e2e-spec.ts

key-decisions:
  - "UpdateAccountDto narrows 02-PATTERNS.md's draft (which included an optional `type` field) to `name` only — D-01 makes balance-sign meaning depend on type, so a post-creation type change would misrepresent an existing balance with no conversion path (prohibition P2)"
  - "DELETE /accounts/:id returns 200 + {} (mirroring AuthController.logout()'s empty-envelope convention), not a bare 204, for response-shape consistency across the codebase"

patterns-established:
  - "Ownership-check-before-mutation: every write method (update/remove) calls findOne(userId, id) first and lets its NotFoundException propagate, rather than a separate existence check"

requirements-completed: []  # ACCT-02/03/04 also referenced by 02-03 (not yet executed); requirements.ready-ids reported 0/3 ready this run

coverage:
  - id: D1
    description: "A user can list, view, and update (name only) their own accounts; every cross-tenant GET/PATCH/DELETE attempt returns 404, never 200/403 (ACCT-02, Pitfall 3)"
    requirement: "ACCT-02"
    verification:
      - kind: e2e
        ref: "test/accounts-cross-tenant.e2e-spec.ts#GET/PATCH/DELETE with B's account id and A's token returns 404"
        status: pass
      - kind: e2e
        ref: "test/accounts-cross-tenant.e2e-spec.ts#GET /accounts for A never includes any of B's account ids"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /accounts on a fresh user returns 200 with an empty array; repeated calls with no writes return a stable createdAt-ascending order"
    verification:
      - kind: e2e
        ref: "test/accounts.e2e-spec.ts#GET /accounts on a freshly-registered user with zero accounts returns 200 with an empty array"
        status: pass
      - kind: e2e
        ref: "test/accounts.e2e-spec.ts#GET /accounts returns accounts ordered by createdAt ascending, stable across repeated calls"
        status: pass
    human_judgment: false
  - id: D3
    description: "Two accounts with identical name/type/balance for the same user remain two separate rows — no merge, no rejection"
    verification:
      - kind: e2e
        ref: "test/accounts.e2e-spec.ts#two accounts with identical name/type/balance for the same user remain two separate rows"
        status: pass
    human_judgment: false
  - id: D4
    description: "PATCH /accounts/:id rejects any body containing `balance` or `type` with 400; a name-only PATCH leaves balance byte-identical (D-02, prohibition P2, ACCT-04 no-drift)"
    requirement: "ACCT-04"
    verification:
      - kind: e2e
        ref: "test/accounts.e2e-spec.ts#PATCH /accounts/:id rejects a body containing `balance` with 400"
        status: pass
      - kind: e2e
        ref: "test/accounts.e2e-spec.ts#PATCH /accounts/:id rejects a body containing `type` with 400"
        status: pass
      - kind: e2e
        ref: "test/accounts.e2e-spec.ts#PATCH /accounts/:id with only {name} succeeds 200 and leaves balance byte-identical"
        status: pass
    human_judgment: false
  - id: D5
    description: "DELETE /accounts/:id soft-deletes (sets deletedAt), excludes the account from GET /accounts and GET /accounts/:id (404), and never removes the row; a second DELETE returns 404 not a second 200 (D-03)"
    verification:
      - kind: unit
        ref: "src/accounts/accounts.service.spec.ts#remove sets deletedAt and calls .save() — never a hard-delete repository method"
        status: pass
      - kind: e2e
        ref: "test/accounts.e2e-spec.ts#DELETE /accounts/:id soft-deletes: excludes the account from GET /accounts and GET /accounts/:id (404)"
        status: pass
      - kind: e2e
        ref: "test/accounts.e2e-spec.ts#a second DELETE /accounts/:id on an already-deleted account returns 404, not a second 200"
        status: pass
    human_judgment: false
  - id: D6
    description: "AccountsService.findOne throws NotFoundException (404, never 403) on any ownership mismatch"
    verification:
      - kind: unit
        ref: "src/accounts/accounts.service.spec.ts#findOne throws NotFoundException when the repository returns null"
        status: pass
    human_judgment: false

duration: ~40min
completed: 2026-09-12
status: complete
---

# Phase 2 Plan 02: List/View/Update/Delete Accounts Summary

**Full CRUD for Accounts — findOne-gated ownership checks on every read/write, soft-delete via `deletedAt` (D-03), and a DTO-shape lock (no `balance`/`type` fields) that makes PATCH body-tampering a 400 for free via global `forbidNonWhitelisted`.**

## Performance
- **Duration:** ~40min
- **Started:** 2026-09-12
- **Completed:** 2026-09-12
- **Tasks:** 2
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- Delivered ACCT-02's full behavior: a user can now list, view, update the name of, and soft-delete only their own accounts — every cross-tenant GET/PATCH/DELETE attempt against another user's account returns 404, proven by a dedicated `test/accounts-cross-tenant.e2e-spec.ts` mirroring Phase 1's IDOR suite structure. (ACCT-02 is shared with 02-03's frontmatter and is not marked complete in REQUIREMENTS.md until that sibling plan also lands — `requirements.ready-ids` correctly reported 0/3 ready this run.)
- Extended ACCT-04's "no drift" guarantee: `balance` and `type` remain permanently locked after creation — `UpdateAccountDto` physically omits both fields, so the existing global `ValidationPipe({forbidNonWhitelisted: true})` rejects any attempt to include them with 400, with zero manual guard code.
- Implemented D-03 soft delete: `remove()` sets `deletedAt` and calls `.save()`, never a hard-delete repository method; every `find`/`findOne` filters `deletedAt IS NULL`, so a deleted account disappears from all reads but the row (and the FK Phase 4's transactions table will need) survives.
- Covered every edge-probe called out in the plan's `must_haves`: empty list, stable createdAt-ascending ordering across repeated calls, duplicate-content adjacency (two identical accounts stay two rows), and delete-twice idempotency (second DELETE returns 404, not a second 200).

## Task Commits
1. **Task 1: List/view/update/delete — soft delete, immutable balance, type-lock (D-02, D-03)** - `7106f53` (feat)
2. **Task 2: Cross-tenant isolation suite + full CRUD e2e coverage (Pitfall 3)** - `a3785e4` (test)

## Files Created/Modified
- `src/accounts/dto/update-account.dto.ts` - `UpdateAccountDto`: `name` only, no `balance`/`type`
- `src/accounts/accounts.service.ts` - added `findAll()`, `findOne()`, `update()`, `remove()`, all `userId`+`deletedAt`-scoped
- `src/accounts/accounts.controller.ts` - added `GET /accounts`, `GET /accounts/:id`, `PATCH /accounts/:id`, `DELETE /accounts/:id`
- `src/accounts/accounts.service.spec.ts` - added `findOne`/`remove` unit tests (NotFoundException case, soft-delete-not-hard-delete assertion)
- `test/accounts-cross-tenant.e2e-spec.ts` - new dedicated two-user IDOR suite (GET/PATCH/DELETE ownership-mismatch → 404, list-isolation)
- `test/accounts.e2e-spec.ts` - extended with empty-list, ordering, adjacency, balance/type-lock, no-drift, soft-delete-exclusion, and delete-twice-idempotency cases

## Decisions Made
See `key-decisions` in frontmatter — `UpdateAccountDto` deliberately narrower than 02-PATTERNS.md's draft (no `type` field); `DELETE` returns `200 {}` matching `AuthController.logout()`'s established convention rather than a bare `204`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] ESLint `unbound-method` errors on new code**
- **Found during:** Task 1 (pre-commit lint pass on new/modified files, following the same hygiene precedent set in 02-01's SUMMARY)
- **Issue:** `AccountsController.findAll()`'s `accounts.map(AccountResponseDto.fromEntity)` passed the static method as an unbound reference (`@typescript-eslint/unbound-method`); `accounts.service.spec.ts`'s `remove()` test asserted `expect(accountsRepository.delete).not.toHaveBeenCalled()` on a raw mocked-method reference, tripping the same rule.
- **Fix:** Wrapped the controller's map callback in an arrow function (`accounts.map((account) => AccountResponseDto.fromEntity(account))`); rewrote the test assertions using the `.mock.calls.length` pattern already established in `auth.service.spec.ts`/`accounts.service.spec.ts`'s `create()` test instead of `toHaveBeenCalledWith`/`toHaveBeenCalled()` on a raw method reference.
- **Files modified:** `src/accounts/accounts.controller.ts`, `src/accounts/accounts.service.spec.ts`.
- **Verification:** `npx eslint` on all touched files reports 0 errors; `npm run test -- accounts.service.spec.ts` still green after the rewrite.
- **Commit:** `7106f53`.

**2. [Rule 3 - Blocking issue] Prettier formatting violations in new test files**
- **Found during:** Task 2 (pre-commit lint pass on the two test files)
- **Issue:** `npx eslint` reported `prettier/prettier` formatting errors (line-wrapping of multi-line object literals and chained `.map()` calls) in both `test/accounts-cross-tenant.e2e-spec.ts` and `test/accounts.e2e-spec.ts`, alongside the same pre-existing `no-unsafe-argument` warnings on `app.getHttpServer()` already present in every e2e spec in this codebase (not fixed — out of scope, pre-existing).
- **Fix:** Ran `npx eslint --fix` on both files, which resolved all formatting errors with no behavior change.
- **Files modified:** `test/accounts-cross-tenant.e2e-spec.ts`, `test/accounts.e2e-spec.ts`.
- **Verification:** `npx eslint` reports 0 errors (48 pre-existing `no-unsafe-argument` warnings remain, same as `test/cross-tenant.e2e-spec.ts`); `npm run test:e2e -- accounts-cross-tenant.e2e-spec.ts` (4/4 pass) and `npm run test:e2e -- accounts.e2e-spec.ts` (21/21 pass) both green after the fix.
- **Commit:** `a3785e4`.

**Total deviations:** 2 auto-fixed (both lint/blocking). **Impact on plan:** None on scope or acceptance criteria — both were incidental to keeping the plan's own verification commands passing cleanly; no production behavior changed as a result of either fix.

## Issues Encountered
None beyond the two deviations above. Docker Desktop / local Postgres were already running from the prior plan's session, so no environment setup was needed this time.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
`AccountsService`/`AccountsController` now expose the complete CRUD surface (`create`/`findAll`/`findOne`/`update`/`remove`) with `userId`+`deletedAt`-scoped queries throughout. `ACCT-04`'s "no drift" guarantee is now proven for every write path this phase controls (creation is the only path that ever sets `balance`; PATCH cannot touch it). `ACCT-02`/`ACCT-03`/`ACCT-04` are not yet marked complete in `REQUIREMENTS.md` — all three are shared with sibling plan 02-03 still in progress; `requirements.ready-ids` correctly reported 0/3 ready this run. Ready for 02-03. Phase 4's `TransactionsService` can rely on soft-deleted accounts still existing as FK targets (D-03) once it starts calling the reserved `adjustBalance()` stub established in 02-01.

---
*Phase: 02-accounts*
*Completed: 2026-09-12*

## Self-Check: PASSED

All 6 created/modified source files and this SUMMARY.md confirmed present on disk; both commits (`7106f53`, `a3785e4`) confirmed present in `git log --all`.
