---
gsd_state_version: "1.0"
current_phase: 08
current_phase_name: AWS Infrastructure
status: executing
stopped_at: Phase 8 context gathered
last_updated: "2026-09-23T17:45:40.208Z"
last_activity: 2026-09-23
last_activity_desc: Phase 07 complete, transitioned to Phase 8
state_head: 9bc77d1ccbaa3de3c966298e915f509158ca3476
progress:
  total_phases: 9
  completed_phases: 0
  total_plans: 26
  completed_plans: 22
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-22)

**Core value:** A API funciona localmente, com segurança tratada como requisito central (não como extra), e evolui em etapas incrementais claras até chegar a um deploy AWS completo e auditável.
**Current focus:** Phase 07 — Containerization

## Current Position

Phase: 08 (AWS Infrastructure) — READY TO EXECUTE
Plan: Not started
Status: Ready to execute
Last activity: 2026-09-23 — Phase 07 complete, transitioned to Phase 8

Progress: [████████████████████] 8/8 plans ([░░░░░░░░░░] 0%)

## Performance Metrics

**Velocity:**

- Total plans completed: 22
- Average duration: - min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 5 | - | - |
| 02 | 3 | - | - |
| 03 | 3 | - | - |
| 04 | 4 | - | - |
| 05 | 2 | - | - |
| 06 | 3 | - | - |
| 07 | 2 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 50min | 2 tasks | 33 files |
| Phase 01 P02 | 19min | 2 tasks | 5 files |
| Phase 01 P03 | 20min | 2 tasks | 9 files |
| Phase 01 P04 | 35min | 2 tasks | 4 files |
| Phase 01 P05 | 15min | 2 tasks | 1 files |
| Phase 02 P01 | 30min | 2 tasks | 10 files |
| Phase 02 P02 | 40min | 2 tasks | 6 files |
| Phase 02 P03 | 20min | 2 tasks | 1 files |
| Phase 03 P03-02 | 12min | 2 tasks | 6 files |
| Phase 03 P03-03 | 12min | 2 tasks | 1 files |
| Phase 04 P03 | 40min | 2 tasks | 9 files |
| Phase 04 P04 | 14min | 2 tasks | 2 files |
| Phase 05 P01 | 45min | 2 tasks | 16 files |
| Phase 05 P02 | 20min | 2 tasks | 1 files |
| Phase 06 P01 | 8min | 2 tasks | 9 files |
| Phase 06 P02 | 15min | 2 tasks | 8 files |
| Phase 06 P03 | 12min | 2 tasks | 1 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: Domain phases (1-6) sequenced strictly by data dependency (auth → accounts/categories → transactions/transfers → budgets → reports), matching research SUMMARY.md's dependency analysis.
- Roadmap: Infrastructure phases (7-9: Containerization, AWS Infrastructure, CI/CD) placed after all domain phases, per PROJECT.md's explicit constraint to never skip the incremental order (API local → containerização → AWS → CI/CD).
- Roadmap: INFRA-01..04 (labeled v2 in REQUIREMENTS.md) are included as Phases 7-9 of this roadmap, since PROJECT.md's core value explicitly requires reaching a full AWS deployment, not just the local API.
- [Phase 01]: Global ValidationPipe/ClassSerializerInterceptor/ResponseInterceptor registered as APP_PIPE/APP_INTERCEPTOR DI providers in AppModule (not imperatively in main.ts) so e2e tests share identical behavior with production bootstrap
- [Phase 01]: Discrete DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME env vars chosen over a single DATABASE_URL, matching docker-compose.yml service vars one-to-one
- [Phase 01]: [Phase 01-02]: Extracted configureApp(app) in src/main.ts (helmet, CORS allowlist, global exception filter) reused by both bootstrap() and e2e tests, since these three concerns have no DI-provider equivalent unlike ValidationPipe/interceptors
- [Phase 01]: [Phase 01-02]: Added git.allow_default_branch_commits: true to .planning/config.json to match this project's already-established branching_strategy: "none" single-branch convention
- [Phase 01]: [Phase 01-03]: issueTokenPair(userId) extracted as shared private helper (login + refresh both use it) to avoid duplicating token-issuance logic
- [Phase 01]: [Phase 01-03]: SHA-256 (not argon2) chosen for refresh-token-at-rest hashing — high-entropy random secret, no dictionary to defend against
- [Phase 01]: [Phase 01-03]: security-review Skill invocation couldn't run (no origin remote for git diff) — checklist applied manually instead; flagged gap: /auth/refresh and /auth/logout have no rate limiting yet (deferred, D-06 scoped throttling to login/register only)
- [Phase 01]: [Phase 01-04]: ThrottlerGuard registered as a plain provider + useExisting alias onto APP_GUARD (not bare useClass), so it's addressable by TestingModuleBuilder.overrideProvider() in e2e tests — Nest stores bare useClass APP_GUARD providers under an internal randomly-generated DI token every compile(), which testing overrides cannot target at all
- [Phase 01]: [Phase 01-05]: Client-supplied-override sweep tests assert 400 (not silently-ignored 200) for POST endpoints, since global forbidNonWhitelisted:true rejects unexpected DTO fields — a stronger proof of no-override than checking the field was merely ignored
- [Phase 01]: [Phase 01-05]: Reuse-detection cross-tenant test asserts refresh_tokens table state directly (A's full family revoked, B's sibling row unrevoked) rather than relying solely on HTTP response codes
- [Phase 01]: Post-execution code review (before phase close-out) found and fixed 3 critical bugs the plan-time work missed: migrations used `uuid_generate_v4()` with no `uuid-ossp` extension installed (fails on any fresh DB — switched to native `gen_random_uuid()`), `ms`/`@types/ms` were undeclared phantom transitive dependencies, and `AuthService.refresh()` had a TOCTOU race allowing concurrent reuse of the same refresh token (closed via a single atomic conditional `UPDATE`). All 5 warning-level findings also fixed. See 01-REVIEW.md/01-REVIEW-FIX.md.
- [Phase 02]: [Phase 02-01]: AccountsService.adjustBalance() is intentionally unrouted this phase (throws 'not implemented until Phase 4') — establishes the single write-path signature ARCHITECTURE.md requires before Phase 4's TransactionsService exists to call it
- [Phase 02]: [Phase 02-01]: JwtAuthGuard moved to controller level (not per-route as in AuthController) since every Accounts route requires auth and there is no public register/login-equivalent in this module
- [Phase 02]: [Phase 02-02]: UpdateAccountDto narrowed to name-only (no type field), unlike 02-PATTERNS.md's draft — D-01's balance-sign-by-type meaning would be silently misrepresented by a post-creation type change (prohibition P2)
- [Phase 02]: [Phase 02-02]: DELETE /accounts/:id returns 200 + {} mirroring AuthController.logout()'s empty-envelope convention, not a bare 204
- [Phase 02]: [Phase 02-03]: security-review Skill invocation couldn't run (no origin remote for git diff) — checklist applied manually against 02-01/02-02's STRIDE registers instead; no new gaps found
- [Phase 03]: [Phase 03]: [Phase 03-01]: D-03 uniqueness enforced at the database level via a partial unique index, not application-layer validation — Concurrent duplicate creates resolve deterministically (one 201, one 409, never both, never a 500) — service only translates the resulting Postgres 23505 error into a 409, closing any TOCTOU race
- [Phase 03]: [Phase 03]: [Phase 03-01]: Removed GET /categories list-count cross-checks from 03-01's e2e tests (Rule 3 deviation) — That endpoint is CAT-02 scope owned by 03-02-PLAN.md and doesn't exist yet — the 201-then-409 status sequence alone is sufficient proof of non-duplication, since a Postgres unique-violation aborts the INSERT entirely
- [Phase 03]: [Phase 03-02]: UpdateCategoryDto narrowed to name-only (no type field) — D-02's type-locked-after-creation rule enforced entirely via DTO-layer omission plus global forbidNonWhitelisted:true, mirroring UpdateAccountDto exactly
- [Phase 03]: [Phase 03-02]: DELETE /categories/:id returns 200 + {} (not 204), mirroring AccountsController.remove()'s established empty-envelope convention for response-shape consistency across domain modules
- [Phase 04]: [Phase 04]: [Phase 04-03]: Both accounts' lock order for a transfer is computed once as [fromAccountId, toAccountId].sort() and reused identically by create() and remove() — guarantees direction-independent deadlock avoidance (Pitfall 2) and exact-inverse reversal
- [Phase 04]: [Phase 04]: [Phase 04-03]: TransfersService.remove locks the transfer row via type: TransactionType.TRANSFER in its WHERE clause, symmetric to 04-02's type: In([INCOME, EXPENSE]) exclusion — a transaction id 404s through /transfers/:id and vice versa
- [Phase 04]: Phase 4 close-out: integration-level precision proof (12 sequential alternating transactions, exact 40.62 balance), full 177-test combined regression suite green, security-review checklist applied to Transactions/Transfers + adjustBalance with explicit concurrency-mitigation re-verification — Mirrors 03-03's close-out pattern; no production code changes needed, checklist found no new gaps beyond what 04-01/04-02/04-03 already closed
- [Phase 04]: UAT re-verification (post-review) found 04-VERIFICATION.md was stale — written before the 4 code-review fixes (CR-01/WR-01/02/03) landed. Re-verified live: all 4 fixes confirmed in source, full suite re-run clean (50/50 unit, 130/130 e2e), VERIFICATION.md and covered_digest updated to reflect fixed state, and a retroactive 04-SECURITY.md incorporated the 4 review findings as threats T-04-19..T-04-22 (all closed) alongside the plan-time STRIDE register — threats_open: 0
- [Phase 05]: [Phase 05-01]: Budgets tracer proves TransactionsService.sumByCategoryExcludingTransfers (first grouped read-side aggregation) correctly excludes TRANSFER rows from category spend, reusing Phase 4's TXN-04 exclusion rule in a read path for the first time
- [Phase 05]: [Phase 05-01]: Fixed test-authoring bug — literal '11111111-1111-1111-1111-111111111111' is not a valid UUID (wrong variant nibble); replaced with a proper v4 UUID in the nonexistent-categoryId IDOR test
- [Phase 05]: [Phase 05-02] Cross-tenant IDOR suite confirmed BudgetsService/Controller (from 05-01) already enforce ownership correctly on every route and on create-time categoryId reference — no production code fix needed; full 65/65 unit + 146/146 e2e suite green, security-review checklist found zero new gaps
- [Phase 06]: [Phase 06-01]: sumByCategoryForDateRangeExcludingTransfers added as a new, parallel TransactionsService method (not a signature change) — existing sumByCategoryExcludingTransfers verified byte-identical via git diff, zero regression risk to Budgets' Phase-5 aggregation
- [Phase 06]: [Phase 06-01]: A category soft-deleted after transactions referencing it still exist is silently skipped from the category-summary output, consistent with every other list/aggregate endpoint's soft-delete exclusion convention
- [Phase 06]: AccountsModule wired into ReportsModule; net-balance nets assets vs cartao_credito debt via decimal.util.ts (REP-02)
- [Phase 06]: getMonthBounds/getPreviousMonthBounds kept private to ReportsService (not shared with BudgetsService's differently-parameterized bounds helper), computing REP-03's current/previous month comparison with correct January rollover
- [Phase 06]: [Phase 06-03]: Cross-tenant isolation for plain-GET-with-no-:id Reports routes is entirely list-scoping/aggregation-scoping, proven with a dedicated two-user suite under identically-named categories on both tenants — No :id route exists in ReportsController, so there is no foreign-id-404 case to test — userId comes only from @CurrentUser()

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 8 (AWS Infrastructure): Fargate task sizing has no validated numeric starting point — start conservative and load-test rather than assuming vCPU/memory values from research.
- Phase 9 (CI/CD): OIDC role scoping needs careful IAM policy design — a recurring failure mode noted in research pitfalls.
- [Phase 4, non-blocking] No dedicated regression test exists for the PATCH-racing-DELETE interleaving that CR-01 fixed (`TransactionsService.update()`), unlike the equivalent DELETE-vs-DELETE case which has one. The mitigation is confirmed correct in source; a follow-up test would guard against a future regression of this exact class of bug.
- Local dev note (not a code issue): default `PORT=3000` can collide with an unrelated Docker container on this machine (a separate personal project, `medolai-api`) — if `npm run start` fails with `EADDRINUSE`, override with `PORT=<free-port> npm run start` rather than assuming the app is broken.
- [Phase 5, non-blocking] No dedicated regression test proves an INCOME transaction posted against a DESPESA-category budget is excluded from `spent` (the `type = EXPENSE` filter in `sumByCategoryExcludingTransfers` is correct by inspection and by the passing transfer-exclusion e2e test, but that specific INCOME-vs-DESPESA case has no test of its own).
- Repo has no `origin` git remote configured — `workflow.use_worktrees` was set to `false` (2026-09-22) since the harness-worktree fork-base check can never resolve `origin/HEAD` without one. All phase execution now runs sequentially on `master` in the main checkout.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-09-23T14:56:04.280Z
Stopped at: Phase 8 context gathered
Resume file: .planning/phases/08-aws-infrastructure/08-CONTEXT.md
