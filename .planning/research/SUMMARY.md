# Project Research Summary

**Project:** FinancialControl (personal finance/budgeting API)
**Domain:** Personal finance / budgeting REST API — NestJS + PostgreSQL on AWS (ECS Fargate + ALB + RDS + Secrets Manager + GitHub Actions CI/CD)
**Researched:** 2026-09-11
**Confidence:** MEDIUM-HIGH

## Executive Summary

This is a NestJS + PostgreSQL personal finance tracking API (accounts, categories, transactions, monthly budgets, reports) with an explicit dual purpose: real personal use and a hands-on AWS learning vehicle (ECS Fargate, ALB, RDS, Secrets Manager, GitHub Actions CI/CD). Experts building this domain converge on a small set of well-established patterns: typed accounts (including credit cards modeled as liabilities), a transaction model with an explicit `INCOME | EXPENSE | TRANSFER` discriminator so transfers can be excluded from spend/budget totals, and monthly category budgets computed live as `remaining = limit - spent`. The stack should be NestJS v11.2.x (not the 2-week-old v12), TypeORM 1.1.x, Node 24 LTS, and TypeScript 6.0.3 — all verified directly against npm registry data, not just community opinion.

The recommended approach is a modular monolith — one NestJS module per business domain (auth, accounts, categories, transactions, budgets, reports) — with strict `userId`-scoped multi-tenancy enforced at the controller/service boundary, never via `Request` injection into services. On AWS, the shape is standard three-tier: ALB (public) → ECS Fargate (private subnet) → RDS PostgreSQL (private subnet, no public access), with secrets injected via ECS task-definition `secrets` (Secrets Manager), never baked into images or CI logs, and migrations run as an explicit CI/CD pipeline step — never `synchronize: true`, never migrations-on-boot in a horizontally-scaled service.

The key risks cluster into two groups. Financial-correctness risks: money represented as floating-point numbers (must use `decimal`/integer-cents, never raw `number` math), and transfers/balance updates lacking transactional atomicity + row locking (must wrap in a DB transaction with pessimistic locking, verified by concurrent-request tests). Security/infra risks: IDOR from trusting client-supplied IDs instead of scoping every query by `userId` (the single most-repeated pitfall across research, applies to every module), RDS accidentally left publicly accessible, secrets leaking into Docker layers or CI logs, and ECS health-check misconfiguration causing crash loops on first deploy. All of these are well-documented, addressable patterns — not blockers — but each needs to be designed in from the start of the relevant phase rather than retrofitted.

## Key Findings

### Recommended Stack

NestJS v11.2.3 (not v12, which is only 2 weeks old and ESM-first/still settling) with TypeORM 1.1.1 (the new post-0.3.x major, actively maintained), Node.js 24.x (current Active LTS — Node 20 is EOL as of April 2026), and TypeScript 6.0.3 (TS 7.0's native compiler has no stable programmatic API yet, so `nest build`/`ts-jest` don't support it). Supporting libraries: `@nestjs/config` + `zod` for fail-fast env validation, `class-validator`/`class-transformer` for DTOs, `@nestjs/jwt` + `@nestjs/passport` for auth, `bcrypt` (or `argon2` for stronger KDF) for password hashing, `@nestjs/terminus` for ALB-facing health checks, `@nestjs/throttler` + `helmet` for basic hardening. All core version/compatibility claims were verified directly against the npm registry (HIGH confidence); AWS integration patterns cross-checked against official AWS docs.

**Core technologies:**
- NestJS ^11.2.3: backend framework — mature, CommonJS, full ecosystem compatibility (v12 too new)
- TypeORM ^1.1.1: ORM — new major line, actively maintained, `@nestjs/typeorm` peer-compatible
- PostgreSQL 16/17 (RDS): primary datastore — matches project constraint
- Node.js 24.x: runtime — current Active LTS, Node 20 is EOL
- TypeScript ^6.0.3: compiler — last classic-compiler release with a stable programmatic API that Nest toolchain depends on

### Expected Features

The feature set for a personal finance/budgeting API is well-precedented (YNAB, Monarch Money, Actual Budget, EveryDollar). Table-stakes features map directly onto PROJECT.md's stated scope; the main technical subtlety is that transfers must be a first-class transaction type from day one (not retrofitted) so budget/spend calculations can correctly exclude them — this is the single most-cited correctness pattern across the competitor research.

**Must have (table stakes):**
- Typed accounts (checking/savings/wallet/credit card) with current balance — credit card as liability
- User-defined categories (income/expense)
- Transaction CRUD (amount, date, description, account, category, type)
- Transfers between own accounts, excluded from budget/spend totals
- Monthly budget limit per category + spent/remaining calculation
- Category/period summary report, consolidated balance report, month-over-month comparison (all JSON-only, per PROJECT.md)
- Auth + per-user data isolation (JWT, multi-tenant)

**Should have (differentiators, v1.x):**
- Net worth tracking (near-free once credit cards are liability-signed)
- Budget rollover (YNAB-style unspent-carries-forward) — deliberate "add after validation," not baked into v1's budget model
- Category grouping/templates (Needs/Wants/Savings)

**Defer (v2+ / explicit anti-features):**
- Live bank sync (Plaid/Open Banking) — scope/security/compliance mismatch with a security-first solo project
- Multi-currency, shared/collaborative budgets, investment tracking, ML auto-categorization
- CSV import pipeline, front-end/dashboards/exports — explicitly out of scope per PROJECT.md v1

### Architecture Approach

Modular monolith: one NestJS module per business domain (auth, accounts, categories, transactions, budgets, reports), each owning its controller→service→entity vertically, with an explicit dependency direction (`transactions → accounts/categories`, `budgets → categories`, `reports → everything, read-only, nothing depends on reports`). On AWS: ALB (public subnets) → ECS Fargate (private subnets) → RDS PostgreSQL (private subnets, no public access); Secrets Manager feeds credentials via ECS task-definition `secrets` (not `environment`); GitHub Actions builds/pushes to ECR via OIDC (no static keys) and deploys via `amazon-ecs-deploy-task-definition`, with migrations run as a separate pipeline step before service update.

**Major components:**
1. NestJS domain modules (Accounts/Categories/Transactions/Budgets/Reports/Auth) — one module per business domain, controller→service→entity, `userId`-scoped everywhere
2. ECS Fargate service behind ALB — runs the containerized app in private subnets, health-gated rollout via `/health` (Terminus + TypeOrmHealthIndicator)
3. RDS PostgreSQL (private, no public access) — reachable only from the ECS task's security group (SG-to-SG, not CIDR)
4. Secrets Manager + ECS task-definition `secrets` — credentials/JWT secret injected at container start, never baked into the image
5. GitHub Actions CI/CD — test → build → OIDC-authenticated ECR push → explicit migration step → ECS task-definition update → rolling deploy

### Critical Pitfalls

1. **Money as floating-point** — use `decimal`/`numeric` columns or integer cents, never raw JS `number` arithmetic on money; enforce one representation project-wide in DTOs.
2. **Transfers/balance updates without transactional atomicity or row locking** — wrap every multi-account mutation in a DB transaction with pessimistic locking (`FOR UPDATE`), lock accounts in consistent order, verify with concurrent-request integration tests.
3. **IDOR — trusting client-supplied IDs** — every `findOne`/`update`/`delete` must scope by `{ id, userId }` in the query itself, return 404 not 403, and be covered by an automated cross-tenant test suite per module (accounts, categories, transactions, budgets).
4. **Budget consumed/remaining calculated incorrectly at edge cases** — must exclude transfers, use half-open date-range queries (not inclusive `BETWEEN`), compute from calendar-month bounds regardless of when the budget record was created; needs explicit edge-case tests (zero transactions, over 100%, mid-month creation, month-boundary timestamps).
5. **RDS publicly accessible / secrets baked into images or CI logs** — `PubliclyAccessible=false` and SG-scoped-to-ECS-only from day one; secrets only via ECS task-definition `secrets`, never Docker build `ARG`/`ENV` or CI `echo`.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation — Auth + Accounts + Categories
**Rationale:** Auth and per-user isolation must exist before any domain data; accounts and categories are foundational (nothing else works without them) and have no dependencies on each other.
**Delivers:** JWT auth (register/login/guard), `@CurrentUser()` pattern established, Account CRUD (typed, credit-card-as-liability), Category CRUD (income/expense).
**Addresses:** Table-stakes auth + account + category features from FEATURES.md.
**Avoids:** IDOR (Pitfall 3) — establish the `{id, userId}`-scoped query pattern and a shared "findOwnedOrFail" helper here so every later module reuses it; also decide money representation (decimal/cents, Pitfall 1) before the first migration.

### Phase 2: Transactions + Transfers
**Rationale:** Requires accounts + categories to exist; the transaction model (with `INCOME|EXPENSE|TRANSFER` discriminator) must be designed correctly from the start since retrofitting transfer semantics later risks breaking budget exclusion logic.
**Delivers:** Transaction CRUD linked to account+category, transfer-between-accounts with atomic multi-account balance updates.
**Uses:** TypeORM `DataSource.transaction()` + pessimistic locking; decimal/cents money representation from Phase 1.
**Implements:** `Transactions → Accounts`, `Transactions → Categories` dependency direction from ARCHITECTURE.md.
**Avoids:** Transfer atomicity/locking (Pitfall 2) — dedicated concurrent-request integration tests required before this phase is done.

### Phase 3: Budgets + Reports
**Rationale:** Depends on transactions existing (for spend aggregation) and categories (budget target). Reports (category/period summary, consolidated balance, month-over-month) are read-only aggregations layered on top.
**Delivers:** Monthly budget CRUD per category, spent/remaining calculation, category/period summary report, consolidated balance report, month-over-month comparison.
**Addresses:** Core planning + reporting table-stakes features from FEATURES.md.
**Avoids:** Budget edge-case pitfall (Pitfall 4) — transfer exclusion, half-open date ranges, calendar-month-bounded calculation, explicit edge-case test suite (zero transactions, over-budget, mid-month creation).

### Phase 4: Containerization + Local AWS-shape Dev
**Rationale:** App logic should be complete and stable before introducing infrastructure concerns; Dockerfile design decisions here (no build-time secrets, migrations isolated from app `CMD`) prevent costly retrofits later.
**Delivers:** Multi-stage Dockerfile, docker-compose local Postgres setup, `/health` endpoint (Terminus + DB check).
**Avoids:** Secrets baked into image layers (Pitfall 6, structural half), migrations-on-boot pattern (Pitfall 8, structural half) — both finalized in Phase 5's pipeline.

### Phase 5: AWS Infrastructure (VPC, RDS, ECS, ALB)
**Rationale:** Provision the actual AWS topology once the containerized app is proven locally; this is the highest-density AWS-learning phase and the one with the most cross-checked pitfalls.
**Delivers:** VPC with public/private subnets, RDS (private, no public access), ECS Fargate service + task definition, ALB with health-checked target group, Secrets Manager entries.
**Avoids:** RDS public exposure (Pitfall 5), shared/overbroad security groups (Anti-Pattern 3), ECS health-check misconfiguration causing crash loops (Pitfall 7) — deliberately test the unhealthy path before marking this phase done.

### Phase 6: CI/CD Pipeline (GitHub Actions)
**Rationale:** Last phase — automates what was proven manually in Phase 5; depends on ECR/ECS/RDS already existing.
**Delivers:** GitHub Actions workflow: test → build → OIDC-authenticated ECR push → explicit migration step (separate from service update) → ECS task-definition render/deploy.
**Uses:** `aws-actions/configure-aws-credentials` (OIDC), `aws-actions/amazon-ecr-login`, `aws-actions/amazon-ecs-deploy-task-definition`.
**Avoids:** Long-lived AWS keys in repo secrets (Anti-Pattern 4), migrations racing across concurrent tasks (Pitfall 8), secrets echoed in CI logs (Pitfall 6).

### Phase Ordering Rationale

- Domain logic (Phases 1–3) is sequenced strictly by data dependency: auth/accounts/categories → transactions/transfers → budgets/reports, matching the dependency graph in FEATURES.md exactly.
- Infrastructure (Phases 4–6) is deliberately built after the app is functionally complete and testable locally — this avoids debugging business logic and AWS networking simultaneously, and matches PROJECT.md's own stated incremental priority (API first, AWS second).
- Transfers are placed in Phase 2 (not deferred) specifically because retrofitting the `TRANSFER` type after budgets/reports exist risks breaking the spend-exclusion invariant — this ordering directly reflects the FEATURES.md dependency notes and PITFALLS.md Pitfall 2/4 guidance.
- IDOR-safe patterns are established once in Phase 1 (shared ownership-check helper) rather than repeated ad hoc per module, since PITFALLS.md flags this as a "must be verified module-by-module" risk best solved with shared infrastructure early.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Transactions + Transfers):** concurrency/locking implementation details (TypeORM pessimistic locking + queryRunner patterns) are sparsely documented (LOW-confidence community sources in PITFALLS.md) — worth a `--research-phase` pass to firm up the exact locking/transaction code pattern before implementation.
- **Phase 5 (AWS Infrastructure):** VPC/subnet/security-group wiring and ECS/ALB health-check tuning are areas where defaults commonly mismatch real app behavior (Pitfall 7) — worth research-phase treatment even though AWS docs are HIGH confidence, since the specific numeric tuning (grace periods, task sizing) is project-specific.
- **Phase 6 (CI/CD):** OIDC role scoping and migration-as-separate-pipeline-step wiring benefit from a research pass, since getting IAM policy scope wrong is a recurring failure mode noted in PITFALLS.md.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** NestJS auth/CRUD scaffolding is extremely well-documented (official docs + project's own `nestjs-conventions` skill already lock the pattern).
- **Phase 3 (Budgets + Reports):** aggregation-query pattern is straightforward once the transaction model exists; main risk is edge-case test coverage, not unknown technique.
- **Phase 4 (Containerization):** multi-stage Dockerfile for Node/NestJS is a well-established, widely-documented pattern.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions/compatibility verified directly against npm registry `engines`/`peerDependencies`; AWS integration patterns cross-checked across multiple 2026 sources |
| Features | MEDIUM | Web search cross-checked across multiple independent competitor sources (YNAB, Monarch, Actual Budget, EveryDollar, Copilot, PocketSmith); no official domain spec, but strong convergence across sources |
| Architecture | MEDIUM-HIGH | AWS networking/health-check patterns verified against official AWS docs (HIGH); NestJS modular-monolith structure corroborated by multiple community sources (MEDIUM) and the project's own locked conventions (HIGH) |
| Pitfalls | MEDIUM (AWS) / LOW-MEDIUM (TypeORM/NestJS specifics) | AWS networking/health-check pitfalls verified against official AWS docs; TypeORM locking/decimal-handling pitfalls corroborated across multiple community sources but not officially documented — verify against actual TypeORM 1.1.x behavior during implementation |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **TypeORM 1.x pessimistic locking API specifics:** most locking guidance sourced is LOW confidence (community gists, old GitHub issues predating the 1.x line) — validate the exact `queryRunner`/`lock` API against TypeORM 1.1.1 docs during Phase 2 planning, not just carry forward 0.3.x-era examples.
- **NestJS v12 migration timing:** deliberately deferred; revisit in a future milestone once the ecosystem (Swagger CLI plugin, ts-jest, TypeScript 7 programmatic API) has caught up — not a v1 gap, but worth flagging in PROJECT.md as a known future decision point.
- **Fargate task sizing:** research recommends "measure, don't guess" but no concrete numeric starting point was validated — Phase 5 planning should start conservative and load-test rather than assume a specific vCPU/memory value from research alone.
- **Argon2 vs bcrypt final decision:** stack research defaults to bcrypt for simplicity but flags argon2 as the stronger OWASP-recommended choice — worth a deliberate decision during Phase 1 planning rather than defaulting silently.

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view <pkg> versions/dist-tags/engines/peerDependencies`) — direct version/compatibility verification
- AWS official docs (docs.aws.amazon.com, repost.aws) — ECS Fargate networking, ALB health checks, private subnet patterns
- Project's own locked conventions: `.claude/skills/nestjs-conventions/SKILLS.md`, `.claude/skills/security-review/SKILLS.md`

### Secondary (MEDIUM confidence)
- InfoQ / Trilon — NestJS v12 roadmap and release analysis
- TypeORM 1.0 official blog + upgrade guide (typeorm.io)
- YNAB, Monarch Money, Actual Budget, EveryDollar, Copilot Money, PocketSmith — competitor feature/transfer/budget-model documentation
- NestJS modular architecture best-practice articles (Level Up Coding, Encore Cloud)

### Tertiary (LOW confidence)
- Community Medium articles on TypeORM decimal handling and Docker secret leakage — directionally correct, cross-checked against official TypeORM issue tracker, but recommend re-verifying exact API/behavior against the pinned TypeORM 1.1.1 version during implementation
- Community gists on TypeORM pessimistic locking — validate against current TypeORM 1.x docs before relying on code samples verbatim

---
*Research completed: 2026-09-11*
*Ready for roadmap: yes*
