# Architecture Research

**Domain:** Personal finance API — NestJS modular monolith on AWS (ECS Fargate + ALB + RDS)
**Researched:** 2026-09-11
**Confidence:** MEDIUM-HIGH (patterns cross-checked against AWS official docs (docs.aws.amazon.com, repost.aws) and multiple independent NestJS community sources; no single point of failure in sourcing)

## Standard Architecture

### System Overview

Two architectural layers matter here and they map to the project's own incremental build order: the **application layer** (NestJS modular monolith, ships identically whether run locally or in AWS) and the **infrastructure layer** (AWS topology, only exists from Phase 3 onward). Keep them decoupled — the app should never need to know it's running in ECS vs. `npm run start:dev`; that's what env-var-driven config and Secrets Manager-as-env-vars achieve.

```
┌───────────────────────────── AWS (VPC) ──────────────────────────────────┐
│                                                                            │
│   PUBLIC SUBNETS (2 AZ)              PRIVATE SUBNETS (2 AZ)              │
│  ┌──────────────────┐               ┌───────────────────────────┐       │
│  │  Application      │  443/80      │  ECS Fargate Service       │       │
│  │  Load Balancer     ├─────────────►│  (1+ tasks, target group)  │       │
│  │  (public-facing)   │              │  Nest app container        │       │
│  └────────┬───────────┘               └────────────┬────────────┘       │
│           │                                          │ 5432               │
│  ┌────────▼───────────┐                              │                    │
│  │  NAT Gateway        │  (outbound only,             ▼                    │
│  │  (egress for tasks) │   for ECR pulls, etc.) ┌───────────────────┐     │
│  └──────────────────────┘                        │  RDS PostgreSQL    │     │
│                                                     │  (private, Multi-AZ│     │
│                                                     │   optional)         │     │
│                                                     └───────────────────┘     │
└────────────────────────────────────────────────────────────────────────────┘
        ▲                                                     ▲
        │ deploys new task def / image                        │ injects at task start
┌───────┴───────────┐                                 ┌───────┴────────────┐
│ GitHub Actions      │──push image──► ECR              │ Secrets Manager     │
│ (build → push → deploy)                                │ (DB creds, JWT secret)│
└────────────────────┘                                 └─────────────────────┘

┌───────────────────────── NestJS Application (inside the container) ──────┐
│  AuthModule → Guards → Controllers → Services → Repositories → TypeORM   │
│  Accounts │ Categories │ Transactions │ Budgets │ Reports │ Auth (modules)│
└────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| ALB | TLS termination, public entry point, routes to ECS target group, runs health checks | AWS Application Load Balancer, HTTPS listener (ACM cert), one target group per ECS service |
| ECS Fargate service | Runs the containerized Nest app, no server management, scales task count | Fargate launch type, `awsvpc` network mode, task placed in private subnet |
| RDS PostgreSQL | Durable relational storage, only reachable from ECS security group | Single-AZ for cost in v1, private subnet group, no public accessibility |
| Secrets Manager | Holds DB credentials and JWT signing secret outside of code/image | Referenced via `secrets` (not `environment`) in the ECS task definition, injected as env vars at container start |
| ECR | Private Docker image registry | One repository per service, tagged by git SHA + `latest` |
| GitHub Actions | CI/CD: build, test, push image, deploy | Workflow triggered on push to `main`, uses `aws-actions/amazon-ecs-deploy-task-definition` |
| NestJS modules (Accounts/Categories/Transactions/Budgets/Reports/Auth) | Own a single business domain end-to-end (controller → service → entity) | One module folder per domain under `src/` |
| AuthModule + Guards | Authenticates requests, extracts `userId` from JWT, makes it available to controllers | `JwtAuthGuard` + `@CurrentUser()` decorator reading `request.user.sub` |

## Recommended Project Structure

```
src/
├── main.ts                     # Bootstrap, global pipes/filters/interceptors
├── app.module.ts                # Root module, imports all domain modules
├── config/                     # @nestjs/config setup + Joi/Zod env schema
│   └── env.validation.ts
├── auth/                       # Domain module: registration, login, JWT issuance
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── strategies/              # JwtStrategy, LocalStrategy (passport)
│   ├── guards/                  # JwtAuthGuard
│   ├── decorators/              # @CurrentUser()
│   └── dto/
├── accounts/                    # Domain module: bank/wallet/credit-card accounts
│   ├── accounts.module.ts
│   ├── accounts.controller.ts
│   ├── accounts.service.ts
│   ├── dto/
│   └── entities/
├── categories/                  # Domain module: user-defined income/expense categories
├── transactions/                # Domain module: entries + transfers (references accounts, categories)
├── budgets/                     # Domain module: monthly budget per category (references categories)
├── reports/                     # Domain module: read-only aggregation across the above
├── common/                      # Cross-cutting: response interceptor, exception filters,
│                                 #   base pagination DTO, decorators shared by >1 module
└── database/                    # TypeORM data source config + migrations/
    └── migrations/
```

### Structure Rationale

- **One module per business domain, not per entity or per layer.** The skill convention (`nestjs-conventions`) already mandates this. It keeps a feature self-contained: deleting `reports/` deletes one folder, adding a feature means adding one module. Avoid a layered split (`controllers/`, `services/`, `dtos/` at the project root) — it forces every change to touch multiple far-apart folders and doesn't match how NestJS's own module system wants to be used.
- **`common/` stays small.** It's for truly cross-cutting concerns (response envelope interceptor, global exception filter, shared decorators). Domain logic never lives here — if two domains need to share business logic, that's a sign one domain should own it and the other should depend on it (e.g., `transactions` depends on `accounts` for balance updates, not the reverse).
- **`database/migrations/` is centralized, not per-module.** TypeORM's CLI expects one migrations directory; keeping it separate from `src/<domain>/entities/` makes the migration-review step (a security/data-integrity checkpoint) a single place to look.
- **`config/` validates env at boot, not at first use.** Matches the constraint that the app must not start with missing env vars — fail fast, especially important once ECS is involved (a task that crash-loops due to bad config produces confusing ALB "unhealthy target" symptoms rather than a clear startup error in logs).

## Architectural Patterns

### Pattern 1: userId-scoped multi-tenancy (controller-injected, never Request-in-service)

**What:** Every entity that belongs to a user carries a `userId` column. The authenticated user's id is extracted from the JWT by a guard, exposed via a `@CurrentUser()` param decorator, and passed explicitly into every service method call from the controller. Services never inject or read the `Request` object.

**When to use:** Every domain module in this project (accounts, categories, transactions, budgets, reports). This is the single most important pattern for this codebase — it's the difference between "isolated per user" and an IDOR vulnerability.

**Trade-offs:** Slightly more verbose method signatures (`findAll(userId: string)` instead of `findAll()`), but it makes the isolation boundary testable in plain unit tests (no need to mock `Request`/`ExecutionContext` in every service test) and impossible to accidentally bypass by forgetting a scope in a query builder chain — as long as the repository layer is also disciplined about always filtering by `userId`.

**Example:**
```typescript
// controller
@Get()
findAll(@CurrentUser() userId: string) {
  return this.accountsService.findAll(userId);
}

// service — every query is userId-scoped, no exceptions
async findAll(userId: string) {
  return this.accountsRepo.find({ where: { userId } });
}

async findOne(userId: string, id: string) {
  const account = await this.accountsRepo.findOne({ where: { id, userId } });
  if (!account) throw new NotFoundException(); // 404, not 403 — don't leak existence
  return account;
}
```

At v1 scale (single personal-use + portfolio project, one PostgreSQL instance, no cross-tenant queries needed), this discipline-based row-level pattern is the right level of complexity. Do **not** reach for Postgres Row-Level Security (RLS) or per-tenant schemas here — that's solving a problem (hundreds of tenants, compliance-driven isolation) this project doesn't have yet, and it would fight the "ship the local API first" constraint.

### Pattern 2: Modular monolith with explicit module dependency direction

**What:** Each domain module exports only what other modules genuinely need (e.g., `AccountsModule` exports `AccountsService` so `TransactionsModule` can inject it to update balances on a transfer). Modules don't reach into each other's repositories directly.

**When to use:** Whenever a cross-domain operation exists — the two real ones in this project are (a) transactions updating account balances, and (b) budgets/reports reading across categories + transactions.

**Trade-offs:** Requires deciding dependency direction up front. Recommended direction for this domain: `Transactions → Accounts`, `Transactions → Categories`, `Budgets → Categories`, `Reports → Transactions/Budgets/Accounts` (read-only). Nothing should depend on `Reports` or `Auth` (besides the global guard). If this direction is violated (e.g., `Accounts` importing `Transactions`), that's a signal of a boundary problem worth stopping and reconsidering.

**Example:**
```typescript
// transactions.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([Transaction]), AccountsModule, CategoriesModule],
  providers: [TransactionsService],
  controllers: [TransactionsController],
})
export class TransactionsModule {}
```

### Pattern 3: Migrate-before-deploy, not synchronize-on-boot

**What:** Database schema migrations run as an explicit step in the CI/CD pipeline (or as a one-off ECS task/command) **before** the new application version starts receiving traffic — never via TypeORM's `synchronize: true`, and never by letting every replica run migrations independently on boot.

**When to use:** From the moment RDS enters the picture (Phase 3+). Locally with Docker Compose, running migrations on container start is fine because there's one instance. Once ECS can run 2+ tasks (even just during a rolling deploy, briefly 2 tasks exist simultaneously), concurrent migration execution risks race conditions.

**Trade-offs:** Adds one more pipeline step to design (who runs `migration:run`, with what credentials, against which target). The payoff is avoiding a class of deploy-time bugs that are hard to reproduce locally and directly threaten data integrity — a bad trade for a financial-data app.

## Data Flow

### Request Flow (runtime, once deployed)

```
Client (HTTPS)
    ↓
ALB (443, ACM cert, routes / to target group)
    ↓ HTTP (private, port 3000)
ECS Fargate task (Nest app)
    ↓
Global pipes (ValidationPipe) → JwtAuthGuard (verifies token, attaches req.user)
    ↓
Controller (@CurrentUser() userId extracted) → Service (userId-scoped business logic)
    ↓
TypeORM Repository → RDS PostgreSQL (private subnet, only ECS SG can reach port 5432)
    ↓
Response envelope interceptor (consistent ResponseDto shape) → Client
```

### Secrets Flow (deploy time / task start)

```
Secrets Manager (DB credentials, JWT secret)
    ↓ referenced by ARN in ECS task definition `secrets` block
ECS Fargate agent resolves secrets at task launch
    ↓ injected as environment variables into the container
NestJS @nestjs/config reads process.env, validates against Joi/Zod schema at boot
    ↓ app refuses to start if required secrets are missing
```

### CI/CD Flow (on push to main)

```
git push (main)
    ↓
GitHub Actions workflow triggers
    ↓
1. Install deps → run unit/integration tests → fail fast if red
2. Build multi-stage Docker image
3. Authenticate to ECR (OIDC role, no long-lived AWS keys in GH secrets — see Anti-Patterns)
4. docker push to ECR (tag: git SHA)
5. Run pending TypeORM migrations against RDS (separate step, before service update)
6. Render new ECS task definition (new image tag) → register revision
7. Update ECS service to new task definition → ECS performs rolling deployment
8. ALB health checks gate traffic shift to new tasks
```

### Key Data Flows

1. **Transfer between accounts:** Controller receives `{ fromAccountId, toAccountId, amount }` scoped to `userId` → service wraps both balance updates + the transaction record insert in a single TypeORM transaction (`queryRunner` or `DataSource.transaction()`) so a partial failure never leaves accounts out of sync.
2. **Budget consumed/remaining:** Reports/Budgets service aggregates `Transactions` filtered by `userId + categoryId + date range`, computed on read (no denormalized running total in v1 — correctness over premature optimization at this scale).
3. **Auth:** Register/login issues a JWT (short-lived access token is enough for v1, no refresh-token rotation needed yet) signed with a secret sourced from Secrets Manager in AWS / `.env` locally — the signing mechanism is identical in both environments, only the secret's origin changes.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Personal use / portfolio demo (this project's actual target) | Single Fargate task, Single-AZ RDS (`db.t4g.micro` or similar), no autoscaling — optimize for cost and for having every AWS concept (ALB, VPC, Secrets Manager, ECS) visible and explainable, not for headroom |
| If it ever needed 1k–100k users | ECS Service Auto Scaling (target tracking on CPU/ALB request count), RDS Multi-AZ for failover, read replica for `reports` module once read load separates from write load |
| 100k+ users (out of scope, noted for completeness) | Split `reports` into its own service reading from a replica or a denormalized read model; consider moving from JWT-in-API to Cognito for centralized auth at that point (the project's own Key Decisions already flag Cognito as a future evolution) |

### Scaling Priorities

1. **First real constraint at this project's scale:** not throughput — it's operational clarity. A single Fargate task behind an ALB, one RDS instance, migrations run in CI. Optimize for "I can explain every component in an interview and on the Cloud Practitioner exam," not for handling load this project won't see.
2. **Second constraint, if usage ever grew:** report/aggregation queries scanning full transaction history per request. Mitigate with indexes on `(userId, categoryId, date)` before reaching for caching or read replicas.

## Anti-Patterns

### Anti-Pattern 1: `synchronize: true` against RDS

**What people do:** Leave TypeORM's `synchronize: true` on because it's convenient in early local development, and forget to gate it behind `NODE_ENV`.
**Why it's wrong:** Against a real database it silently alters/drops columns based on whatever the entity classes currently look like, with no migration history and no rollback — a direct threat to financial data integrity.
**Do this instead:** `synchronize: false` everywhere except a throwaway local dev DB if desired; generate and review migrations (`typeorm migration:generate`) from day one, even in Phase 1.

### Anti-Pattern 2: Services reading `Request`/`ExecutionContext` directly for `userId`

**What people do:** Inject `@Req() request` (or `REQUEST` scope) into services to grab `request.user.id` wherever it's needed, skipping the controller.
**Why it's wrong:** Makes services request-scoped (performance cost — a new instance per request instead of a singleton) and makes the multi-tenant boundary implicit and easy to forget in a new method, which is exactly how IDOR bugs get introduced in a codebase like this.
**Do this instead:** The skill convention already forbids this — controller extracts `userId` via `@CurrentUser()`, passes it explicitly as the first argument to every service method.

### Anti-Pattern 3: One shared security group for ALB, ECS, and RDS

**What people do:** For speed, put ALB, ECS tasks, and RDS all in the same security group with broad inbound rules.
**Why it's wrong:** Collapses the network segmentation that's the actual point of putting RDS in a private subnet — a single misconfigured rule then exposes the database directly to the internet-facing tier.
**Do this instead:** Three security groups with least-privilege chaining: `alb-sg` (443/80 from `0.0.0.0/0`) → `ecs-sg` (app port, only from `alb-sg`) → `rds-sg` (5432, only from `ecs-sg`). This is also a natural thing to narrate for the Cloud Practitioner study goal.

### Anti-Pattern 4: Long-lived AWS access keys stored as GitHub Actions secrets

**What people do:** Create an IAM user with an access key/secret pair and paste them into GitHub repo secrets for the deploy workflow.
**Why it's wrong:** Long-lived credentials in CI are a standing secret-leak risk (exposed in logs, forked-PR workflow runs, or a compromised Action) and violate least-privilege/rotation practice.
**Do this instead:** Configure GitHub's OIDC provider in AWS IAM and assume a scoped deploy role per workflow run (`aws-actions/configure-aws-credentials` with `role-to-assume`, no static keys). Worth calling out explicitly in the CI/CD phase since the project's security-review checklist already flags "segredos fora do código."

### Anti-Pattern 5: Every ECS task/replica running migrations on boot

**What people do:** Put `typeorm migration:run` in the container's entrypoint so "migrations just happen" on every deploy.
**Why it's wrong:** During a rolling deployment (or any moment with >1 task), multiple containers can race to run the same migration concurrently, which TypeORM's own issue tracker documents as a real source of duplicate-write bugs on ECS specifically.
**Do this instead:** Run migrations as one explicit CI/CD pipeline step (or a one-off ECS `RunTask`) before updating the service to the new task definition, not inside the app's normal boot path.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| RDS PostgreSQL | TypeORM `DataSource` via env-driven connection config, credentials from Secrets Manager | Never publicly accessible; connect only from ECS SG |
| AWS Secrets Manager | ECS task definition `secrets` block (ARN reference), resolved at task launch into env vars | Locally, the equivalent is a `.env` file (validated by the same Joi/Zod schema) — code path for reading config is identical |
| ECR | `docker push`/`pull` via GitHub Actions using OIDC-assumed role | One repo per app; tag by git SHA for traceable rollbacks |
| GitHub Actions | Workflow triggered on push to `main`, uses official `aws-actions/*` actions | Keep test-then-build-then-deploy as separate jobs/steps so a test failure never reaches the push-to-ECR step |
| (Future, out of scope now) S3 + Lambda + SES for CSV import | Not built in this milestone | Architecture leaves room: `transactions` module's service layer should accept transactions from any source (API body today, a Lambda-invoked internal call later) rather than being tightly coupled to the HTTP controller |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Auth ↔ everything else | `JwtAuthGuard` applied globally (or per-controller) + `@CurrentUser()` decorator | Only integration point; no module calls `AuthService` directly for business logic |
| Transactions ↔ Accounts | Direct service injection (`AccountsService.adjustBalance()`) inside a DB transaction | Balance mutation only ever happens through `AccountsService`, never via raw repository access from `TransactionsService` |
| Transactions ↔ Categories | Direct service injection, read-only (validate category belongs to `userId` before assigning) | |
| Budgets ↔ Categories | Direct service injection, read-only | |
| Reports ↔ Transactions/Budgets/Accounts | Read-only aggregation queries, no writes | Reports module should never be a dependency of any other module |

## Sources

- [Amazon ECS task networking options for Fargate — AWS Docs](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html) — HIGH (official AWS documentation)
- [Run Amazon ECS tasks on Fargate in a private subnet — AWS re:Post Knowledge Center](https://www.repost.aws/knowledge-center/ecs-fargate-tasks-private-subnet) — HIGH (official AWS knowledge base)
- [Health checks for Application Load Balancer target groups — AWS Docs](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html) — HIGH (official AWS documentation)
- [Troubleshoot health check failures for Amazon ECS tasks on Fargate — AWS re:Post](https://repost.aws/knowledge-center/ecs-fargate-health-check-failures) — HIGH
- [aws-actions/amazon-ecs-deploy-task-definition — GitHub](https://github.com/aws-actions/amazon-ecs-deploy-task-definition) — HIGH (official AWS GitHub Action)
- [Automatic migrations are causing issues when running our app on an ECS cluster — typeorm/typeorm#3400](https://github.com/typeorm/typeorm/issues/3400) — MEDIUM (community issue thread, but corroborates the migration race-condition pitfall directly)
- [NestJS and Modular Architecture: Principles and Best Practices — Level Up Coding](https://levelup.gitconnected.com/nest-js-and-modular-architecture-principles-and-best-practices-806c2cb008d5) — MEDIUM (community best-practices article, consistent with NestJS official module documentation)
- [NestJS Project Structure Best Practices — Encore Cloud](https://encore.dev/articles/nestjs-project-structure-best-practices) — MEDIUM
- Project's own established conventions: `.claude/skills/nestjs-conventions/SKILLS.md` — HIGH (authoritative for this codebase)

---
*Architecture research for: NestJS personal finance API on AWS ECS Fargate*
*Researched: 2026-09-11*
