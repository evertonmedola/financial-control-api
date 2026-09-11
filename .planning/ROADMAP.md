# Roadmap: Controle Financeiro Pessoal — API

## Overview

The API is built as nine focused, sequential phases that follow the project's explicit incremental order: a secure multi-tenant foundation, then each domain capability as its own vertical slice (accounts → categories → transactions/transfers → budgets → reports), and only once the API is functionally complete locally does the roadmap move into infrastructure — containerization, then AWS provisioning, then CI/CD automation. Every phase delivers something a human can verify by calling the API; nothing is deployed to AWS until the domain logic is proven and testable on a developer machine.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Authentication & Multi-Tenant Foundation** - Users can sign up, log in via JWT, and every later module inherits a proven per-user data isolation pattern
- [ ] **Phase 2: Accounts** - Users can manage typed financial accounts with balances that always match their transaction history
- [ ] **Phase 3: Categories** - Users can organize income and expenses with their own custom categories
- [ ] **Phase 4: Transactions & Transfers** - Users can record income/expenses and transfer money between accounts atomically, with decimal-safe amounts
- [ ] **Phase 5: Budgets** - Users can set monthly category limits and see accurate consumed/remaining amounts
- [ ] **Phase 6: Reports** - Users can retrieve category, consolidated-balance, and month-over-month reports
- [ ] **Phase 7: Containerization** - The API runs identically in a Docker container as it does locally
- [ ] **Phase 8: AWS Infrastructure** - The API runs on AWS behind an ALB with a private RDS database and Secrets Manager credentials
- [ ] **Phase 9: CI/CD Pipeline** - Every push to main is automatically tested, built, and deployed to AWS with no static AWS keys

## Phase Details

### Phase 1: Authentication & Multi-Tenant Foundation

**Goal**: Users can create an account, log in securely, and trust that their data is isolated from every other user — establishing the ownership-check pattern every later module reuses.
**Mode**: mvp
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04
**Success Criteria** (what must be TRUE):

  1. A visitor can sign up with email and password; the password is never stored or returned in plain text (hashed with bcrypt/argon2).
  2. A registered user can log in with correct credentials and receive a JWT; incorrect credentials are rejected.
  3. Requests to protected endpoints without a valid JWT are rejected, with no server-side session lookup required to validate the token (stateless).
  4. A user's JWT only ever grants access to that user's own data — verified via a protected endpoint that never returns another user's information, establishing the `{id, userId}`-scoped query pattern reused by every later module.

**Plans**: 1/5 plans executed

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Walking Skeleton tracer: NestJS scaffold + Postgres, register, login, JWT guard, protected route, response hardening

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 01-02-PLAN.md — Transport-level security hardening: helmet, explicit CORS, sanitized error responses
- [ ] 01-03-PLAN.md — Refresh token lifecycle: issuance, rotation, reuse detection, logout (D-02/D-04)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 01-04-PLAN.md — Rate limiting on /auth/login and /auth/register (D-06)

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 01-05-PLAN.md — Cross-tenant regression suite + security-review checklist close-out

### Phase 2: Accounts

**Goal**: Users can manage their financial accounts (checking, savings, wallet, credit card) with balances that accurately reflect their transaction history.
**Mode**: mvp
**Depends on**: Phase 1
**Requirements**: ACCT-01, ACCT-02, ACCT-03, ACCT-04
**Success Criteria** (what must be TRUE):

  1. A user can create an account of any supported type (corrente, poupança, carteira, cartão de crédito) with an initial balance.
  2. A user can list, view, update, and delete only their own accounts — never another user's.
  3. A credit card account's balance represents amount owed (a liability), not amount held.
  4. An account's balance always equals the sum of its transaction history, with no drift between the stored and derived value.

**Plans**: TBD

Plans:

- [ ] 02-01: TBD

### Phase 3: Categories

**Goal**: Users can organize their finances with their own custom income/expense categories.
**Mode**: mvp
**Depends on**: Phase 1
**Requirements**: CAT-01, CAT-02
**Success Criteria** (what must be TRUE):

  1. A user can create a custom category tagged as either receita (income) or despesa (expense).
  2. A user can list, view, update, and delete only their own categories.

**Plans**: TBD

Plans:

- [ ] 03-01: TBD

### Phase 4: Transactions & Transfers

**Goal**: Users can record income, expenses, and transfers between their accounts, with money handled precisely and transfers kept separate from spending.
**Mode**: mvp
**Depends on**: Phase 2, Phase 3
**Requirements**: TXN-01, TXN-02, TXN-03, TXN-04, TXN-05
**Success Criteria** (what must be TRUE):

  1. A user can create an income/expense transaction with amount, date, description, account, and category, and can list, view, update, and delete only their own transactions.
  2. A user can transfer money between two of their own accounts in one operation, with both account balances updating atomically — never left half-updated, even under concurrent requests.
  3. Transfers never appear in category spend totals or budget consumption — only income/expense transactions do.
  4. Monetary amounts round-trip exactly across create/list/update with no floating-point rounding drift.

**Plans**: TBD

Plans:

- [ ] 04-01: TBD

### Phase 5: Budgets

**Goal**: Users can set monthly spending limits per category and see exactly how much they've spent and have left.
**Mode**: mvp
**Depends on**: Phase 4
**Requirements**: BUD-01, BUD-02, BUD-03
**Success Criteria** (what must be TRUE):

  1. A user can set a monthly spending limit for a category.
  2. A user can view a category's consumed and remaining amounts for the month (`remaining = limit - spent`), correctly excluding transfers.
  3. When spending exceeds the limit, the response explicitly signals an over-budget state rather than silently returning a negative number.

**Plans**: TBD

Plans:

- [ ] 05-01: TBD

### Phase 6: Reports

**Goal**: Users can see clear, aggregated views of their financial activity — by category, across accounts, and over time.
**Mode**: mvp
**Depends on**: Phase 2, Phase 4
**Requirements**: REP-01, REP-02, REP-03
**Success Criteria** (what must be TRUE):

  1. A user can request a category/period spending summary (JSON) for any date range they choose.
  2. A user can request a single consolidated balance across all of their accounts (JSON).
  3. A user can request a month-over-month comparison (JSON) showing spending deltas per category.

**Plans**: TBD

Plans:

- [ ] 06-01: TBD

### Phase 7: Containerization

**Goal**: The API runs identically inside a Docker container as it does locally, ready to be deployed to any container platform.
**Mode**: mvp
**Depends on**: Phase 6
**Requirements**: INFRA-01
**Success Criteria** (what must be TRUE):

  1. The API builds into a production image via a multi-stage Docker build, with no dev dependencies or source in the final image.
  2. The containerized API starts, connects to PostgreSQL, and serves requests identically to the local (non-containerized) version.
  3. A health-check endpoint reports app and database connection status, ready for later use by an AWS load balancer.

**Plans**: TBD

Plans:

- [ ] 07-01: TBD

### Phase 8: AWS Infrastructure

**Goal**: The API runs in AWS on managed, secure infrastructure — reachable from the internet only through a load balancer, with the database and secrets never exposed.
**Mode**: mvp
**Depends on**: Phase 7
**Requirements**: INFRA-02
**Success Criteria** (what must be TRUE):

  1. The API is reachable over the internet only via the ALB; ECS tasks and RDS sit in private subnets with no public accessibility.
  2. Database credentials and the JWT secret are injected at container runtime from Secrets Manager — never present in the image, environment files, or CI logs.
  3. The ALB only routes traffic to ECS tasks that pass the `/health` check; an unhealthy task is automatically removed from rotation.

**Plans**: TBD

Plans:

- [ ] 08-01: TBD

### Phase 9: CI/CD Pipeline

**Goal**: Every push to main is automatically tested, built, and deployed to AWS without manual steps or long-lived AWS credentials.
**Mode**: mvp
**Depends on**: Phase 8
**Requirements**: INFRA-03, INFRA-04
**Success Criteria** (what must be TRUE):

  1. A push to main triggers a pipeline that runs tests, builds the Docker image, and pushes it to ECR using short-lived OIDC-federated credentials — no static AWS keys stored in GitHub.
  2. Database migrations run as an explicit, separate pipeline step before the service is updated — never on container boot, never via `synchronize: true`.
  3. A successful pipeline run results in the new version running on ECS with no manual intervention.

**Plans**: TBD

Plans:

- [ ] 09-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Authentication & Multi-Tenant Foundation | 1/5 | In Progress|  |
| 2. Accounts | 0/TBD | Not started | - |
| 3. Categories | 0/TBD | Not started | - |
| 4. Transactions & Transfers | 0/TBD | Not started | - |
| 5. Budgets | 0/TBD | Not started | - |
| 6. Reports | 0/TBD | Not started | - |
| 7. Containerization | 0/TBD | Not started | - |
| 8. AWS Infrastructure | 0/TBD | Not started | - |
| 9. CI/CD Pipeline | 0/TBD | Not started | - |

---
*Roadmap created: 2026-09-11*
*Granularity: fine (9 phases)*
*Scope note: Phases 1-6 cover all 21 v1 requirements. Phases 7-9 cover INFRA-01..04, formally tracked as v2 in REQUIREMENTS.md but pulled into this roadmap per PROJECT.md's explicit incremental order constraint ("API local funcionando → containerização → infraestrutura AWS → CI/CD, sem pular etapas") and the project's core value of reaching a full, auditable AWS deployment.*
