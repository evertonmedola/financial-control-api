---
phase: "04"
slug: "transactions-transfers"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-09-14"
---

# Phase 04 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| client → POST /transactions | untrusted request body; JWT proves identity but every field (`amount`, `type`, `accountId`, `categoryId`) is untrusted input | monetary amount, account/category refs |
| client → GET/PATCH/DELETE /transactions/:id | untrusted `:id` path parameter and PATCH body | transaction id, description/date |
| client → POST /transfers | untrusted request body; `fromAccountId`/`toAccountId`/`amount` all untrusted | monetary amount, two account refs |
| client → DELETE /transfers/:id | untrusted `:id` path parameter | transfer id |
| TransactionsController/TransfersController → Service layer | `userId` crosses here sourced only from `@CurrentUser()`, never from the request body | authenticated user id |
| TransactionsService/TransfersService → AccountsService/CategoriesService | `accountId`/`categoryId` cross here, validated against the caller's own `userId` before being trusted (ownership-chain) | account/category ownership check |
| Service layer → PostgreSQL | parameterized TypeORM `QueryRunner`/repository calls only — no raw string concatenation | monetary balance mutations |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-04-01 | Tampering | CreateTransactionDto.amount (sign injection) | high | mitigate | `@Matches` regex structurally forbids a leading `-`; sign derived exclusively from `type` server-side | closed |
| T-04-02 | Spoofing / IDOR | POST /transactions accountId/categoryId | high | mitigate | both refs validated via `accountsService.findOne(userId,...)`/`categoriesService.findOne(userId,...)` before mutation — cross-tenant 404, never 403/201 | closed |
| T-04-03 | Tampering | CreateTransactionDto.type (transfer smuggling) | medium | mitigate | `@IsIn([INCOME, EXPENSE])` rejects `'transfer'` with 400 | closed |
| T-04-04 | Repudiation / Data Corruption | AccountsService.adjustBalance race | critical | mitigate | `pessimistic_write` row lock inside a `QueryRunner` transaction serializes concurrent mutations | closed |
| T-04-05 | Information Disclosure | TransactionResponseDto | low | mitigate | explicit-construction response DTO never spreads the raw entity | closed |
| T-04-06 | Denial of Service | POST /transactions | low | accept | covered by existing global `ThrottlerModule` default (100 req/60s) | closed (accepted) |
| T-04-07 | Spoofing / IDOR | GET/PATCH/DELETE /transactions/:id | high | mitigate | every query scoped by `(id, userId, deletedAt IS NULL)`; ownership mismatch → 404 | closed |
| T-04-08 | Tampering | PATCH /transactions/:id | high | mitigate | `UpdateTransactionDto` excludes `amount`/`accountId`/`categoryId`; `forbidNonWhitelisted:true` rejects them with 400 | closed |
| T-04-09 | Repudiation / Data Corruption | DELETE /transactions/:id concurrent double-reversal | critical | mitigate | transaction row pessimistic-locked inside the same `QueryRunner` transaction as the balance reversal; second concurrent DELETE finds nothing | closed |
| T-04-10 | Tampering | Transfer-id smuggled into /transactions/:id | medium | mitigate | `findOne`'s `type: In([INCOME, EXPENSE])` filter structurally excludes transfer rows | closed |
| T-04-11 | Repudiation | DELETE /transactions/:id | low | accept | soft-delete (`deletedAt`) preserves a row-level trace; no separate audit-log table required | closed (accepted) |
| T-04-12 | Spoofing / IDOR | POST /transfers fromAccountId/toAccountId | high | mitigate | both legs validated via `accountsService.findOne(userId,...)` before mutation | closed |
| T-04-13 | Tampering | CreateTransferDto.amount (sign injection) | high | mitigate | same structural no-minus-sign regex as CreateTransactionDto | closed |
| T-04-14 | Repudiation / Data Corruption | Two-account concurrent transfer race + deadlock | critical | mitigate | both accounts locked via `adjustBalance`'s `pessimistic_write` in a fixed ascending-id order regardless of direction | closed |
| T-04-15 | Repudiation / Data Corruption | DELETE /transfers/:id concurrent double-reversal | critical | mitigate | transfer row pessimistic-locked inside the same `QueryRunner` transaction as both balance reversals | closed |
| T-04-16 | Information Disclosure | TransferResponseDto | low | mitigate | explicit-construction response DTO never spreads the raw entity | closed |
| T-04-17 | Elevation of Privilege | Transfer bypassing category-spend exclusion | medium | mitigate | `categoryId` structurally `null` on every transfer row, enforced by migration's `CHK_transactions_type_shape` check constraint | closed |
| T-04-18 | Tampering | Full Transactions/Transfers module (rollup) | high | mitigate | 04-04's checklist pass re-confirmed T-04-01..T-04-17 un-regressed by the full test suite | closed |
| T-04-19 | Repudiation / Data Corruption | `TransactionsService.update()` PATCH-vs-DELETE race (found by 04-REVIEW.md, CR-01) | critical | mitigate | fixed in `e018b1a`: scoped `repository.update({id,userId,deletedAt:IsNull()}, dto)` — `affected===0` → 404 instead of resurrecting a concurrently soft-deleted row. Re-confirmed live by direct source re-inspection (`src/transactions/transactions.service.ts:109-129`) and a clean full-suite re-run (50/50 unit, 130/130 e2e) | closed |
| T-04-20 | Tampering | Self-transfer guard bypass via mixed-case UUID (found by 04-REVIEW.md, WR-01) | medium | mitigate | fixed in `a96d57e`: UUID casing normalized before the self-transfer guard and lock-order sort in `TransfersService` | closed |
| T-04-21 | Repudiation / Data Corruption | `AccountsService.update()`/`remove()` same resurrection pattern as T-04-19 (found by 04-REVIEW.md, WR-02) | high | mitigate | fixed in `c73fcee`: identical scoped-update pattern applied to `AccountsService.update()`/`remove()` | closed |
| T-04-22 | Denial of Service | `AccountsService.adjustBalance()` unhandled Postgres overflow on `numeric(12,2)` (found by 04-REVIEW.md, WR-03) | medium | mitigate | fixed in `defdbf1`: `isWithinDecimalRange` checked against the `numeric(12,2)` ceiling before `save()`, returning a controlled 400 instead of an unhandled 500 | closed |

*Status: open · closed · open — below {block_on} threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-04-01 | T-04-06 | DoS on POST /transactions covered by the existing global rate limit (100 req/60s); a tighter per-endpoint override was judged unnecessary for an authenticated-only endpoint at this scale | 04-01-PLAN.md (plan-time) | 2026-09-14 |
| AR-04-02 | T-04-11 | Soft-delete (`deletedAt`) is judged sufficient row-level trace for a personal-finance API; no separate audit-log table required for v1 | 04-02-PLAN.md (plan-time) | 2026-09-14 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-14 | 22 | 22 | 0 | Claude (gsd-secure-phase, retroactive incorporation of 04-REVIEW.md findings T-04-19..T-04-22) |

**Non-blocking follow-up (not a threat, tracked for completeness):** T-04-19's fix (CR-01) has no dedicated regression test for the specific PATCH-racing-DELETE interleaving, unlike the equivalent DELETE-vs-DELETE case (T-04-09) which does. The mitigation itself is structurally sound and verified in source — this is a test-coverage gap, not an open threat.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-14
