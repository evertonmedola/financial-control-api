# Pitfalls Research

**Domain:** Personal finance API — NestJS + TypeORM + PostgreSQL, deployed on AWS (ECS Fargate + ALB + RDS + Secrets Manager + GitHub Actions CI/CD)
**Researched:** 2026-09-11
**Confidence:** MEDIUM (AWS networking/health-check findings cross-checked against official AWS docs; TypeORM/NestJS findings corroborated across multiple independent community sources but not officially documented as "pitfalls" — treat as MEDIUM-LOW and verify against this project's actual TypeORM/NestJS versions during implementation)

## Critical Pitfalls

### Pitfall 1: Money stored/computed as JavaScript floating-point numbers

**What goes wrong:**
Account balances, transaction amounts, and budget totals are declared as TypeORM `number` fields (or PostgreSQL `float`/`double precision`), or the `numeric`/`decimal` column's string value returned by TypeORM/pg is silently coerced back into a JS `number` (e.g. via `parseFloat`, `+value`, or arithmetic like `balance + amount`). Over many transactions, rounding errors accumulate — a balance ends up as `1234.5600000000004` instead of `1234.56`, or two decimal-equal values compare as unequal.

**Why it happens:**
JavaScript has one numeric type (IEEE-754 double). PostgreSQL's `numeric`/`decimal` type is arbitrary precision and TypeORM correctly returns it as a **string** to avoid this exact loss — but that string is inconvenient to do math with, so it's tempting to convert it to `number` at the boundary and never look back. `pg` money type is also a trap: it's currency-locked and not meant for multi-currency or precise application-level math.

**How to avoid:**
- Use `type: 'decimal'` (or `numeric`) columns in TypeORM, **not** `float`/`double`/`money`.
- Never let a raw `number` represent money in application code. Either:
  - Store as **integer minor units (cents)** — `amount_cents: number` (safe: transaction amounts fit far under `Number.MAX_SAFE_INTEGER`), simplest for a personal finance app with no fractional-cent requirements, or
  - Use a decimal library (`decimal.js`, `big.js`) consistently at every arithmetic boundary if you keep `numeric` columns as strings.
- Pick **one** representation project-wide and enforce it in DTOs (validate as string matching `/^\d+(\.\d{1,2})?$/` or as integer cents) — mixing float `number` in DTOs with `decimal` in the DB is the actual failure mode, not just the DB layer.
- Add a unit test that runs 1000+ sequential additions of `0.1`-style amounts and asserts the final balance is exact.

**Warning signs:**
- Any `parseFloat`, unary `+`, or arithmetic operator (`+`, `-`) applied directly to a value that came from a `decimal` column.
- Balance/report totals that don't match manual sums by a fraction of a cent in tests.
- DTOs typed as `@IsNumber() amount: number` for money fields.

**Phase to address:** Phase covering Contas/Transações (accounts/transactions) data model — decide the money representation before the first migration is written, since changing column type later is a breaking migration.

---

### Pitfall 2: Transfers and balance updates without transactional atomicity or row locking

**What goes wrong:**
A transfer between two accounts is implemented as two separate `update()` calls (debit account A, credit account B) without wrapping both in a database transaction. If the process crashes or the second update fails between the two calls, money disappears from A without appearing in B (or vice versa). Separately, even inside a transaction, if two concurrent transfers touch the same account without row locking, a lost-update race condition can occur: both requests read the same starting balance, both write their own updated balance, and one write silently overwrites the other.

**Why it happens:**
NestJS services often call repository methods (`this.accountRepo.update(...)`) individually because it's the simplest code to write, and it works fine in manual testing where requests are sequential. The bug only appears under concurrency (two simultaneous requests against the same account) or partial failure, so it passes casual review and even most integration tests.

**How to avoid:**
- Wrap every multi-row financial mutation (transfer, or any operation touching more than one account/balance) in a single TypeORM `QueryRunner` transaction (`dataSource.transaction(...)` or manual `queryRunner.startTransaction()`), with commit/rollback on error.
- Use pessimistic row locking (`SELECT ... FOR UPDATE`, i.e. TypeORM's `lock: { mode: 'pessimistic_write' }`) when reading the account rows inside the transaction, so concurrent transfers against the same account serialize instead of racing.
- Lock accounts in a **consistent order** (e.g. by ascending `id`) when a transfer touches two accounts, to avoid deadlocks between two transfers going in opposite directions.
- Prefer computing the new balance with an atomic SQL update (`UPDATE accounts SET balance = balance - :amount WHERE id = :id AND balance >= :amount`) combined with a check on affected row count, as a second line of defense against overdraft and lost updates.
- Write an integration test that fires N concurrent transfer requests against the same account pair and asserts the final balance is exactly what's expected (no test in isolation will catch this — it must be concurrent).

**Warning signs:**
- Transfer logic that calls two separate repository `save`/`update` calls not wrapped in `manager.transaction()`.
- No `FOR UPDATE` / pessimistic lock anywhere near balance mutation code.
- No test that runs concurrent requests against the same account.

**Phase to address:** Phase implementing Transferências (transfers) — this is the single highest-risk piece of business logic in the whole project and deserves dedicated integration tests before being marked done.

---

### Pitfall 3: IDOR — trusting client-supplied IDs instead of scoping every query by authenticated userId

**What goes wrong:**
An endpoint like `GET /transactions/:id` or `PATCH /accounts/:id` fetches the resource by primary key alone (`this.repo.findOneBy({ id })`) without checking that the resource's `userId` matches the authenticated user. Any logged-in user can then read or modify another user's financial data just by guessing/incrementing an ID. This is explicitly called out as a top risk in this project's own `security-review` skill, and it's the single most common vulnerability class in multi-tenant CRUD APIs — because the "happy path" code (fetch by ID) works perfectly for the user's own data in every manual test.

**Why it happens:**
NestJS's standard scaffolding pattern encourages `findOneBy({ id })` in services, and the ownership check is an extra line that's easy to forget — especially on update/delete endpoints added later, or on nested resources (e.g. a budget's category, a transaction's account) where the direct foreign key isn't the URL param.

**How to avoid:**
- Per this project's own conventions (already documented in `PROJECT.md`): controllers extract `userId` from the JWT and pass it explicitly to every service method — services never read `Request` directly. Enforce that **every** `findOne`/`update`/`delete` in a service takes `userId` as a required parameter and includes it in the `where` clause: `findOneBy({ id, userId })`, not `findOneBy({ id })` followed by a manual ownership check after the fact (which is easy to skip and easy to get wrong on the negative branch — e.g. returning the resource anyway, or throwing a 403 that leaks existence of another user's record instead of a 404).
- For nested resources (transaction → account, budget → category), verify the **whole ownership chain**, not just the top-level entity's `userId` — a transaction could reference an account that belongs to a different user if the account lookup on create/update isn't also scoped by `userId`.
- Return `404 Not Found` (not `403 Forbidden`) when a resource exists but belongs to another user, to avoid confirming the ID's existence to an attacker.
- Write a dedicated test suite ("cross-tenant isolation") that creates two users, has user A attempt every mutating and read endpoint against user B's resource IDs, and asserts every one returns 404. This test class should exist per module (accounts, categories, transactions, budgets) and be added to the Definition of Done for every phase that adds a new module.
- Consider a base repository/service helper (e.g. `findOwnedOrFail(id, userId)`) so the check can't be forgotten — do this once, early, rather than repeating the pattern by hand in six modules.

**Warning signs:**
- Any `findOneBy({ id })`, `findOne({ where: { id } })`, or raw `WHERE id = $1` without `userId` in the same clause.
- Ownership checked with an `if` after fetch instead of in the query itself (still exploitable if the `if` is missing on just one branch, and leaks existence via timing/behavior differences).
- No automated cross-tenant test suite.

**Phase to address:** Every module phase (accounts, categories, transactions, budgets, reports) — this isn't a one-time fix, it's a pattern that must be verified module-by-module. Recommend adding "cross-tenant IDOR test passes" as an explicit UAT/DoD item on every module's phase, not just a one-time security phase.

---

### Pitfall 4: Budget "consumed vs remaining" calculated incorrectly at edge cases

**What goes wrong:**
Budget-vs-actual calculations look correct in the demo case (one category, current month, positive amounts) but break on: transfers being counted as expenses (a transfer between accounts is not spending and must be excluded from budget consumption); a transaction edited or deleted after the budget period closes (stale/cached "consumed" totals not recalculated); timezone-boundary bugs where a transaction made at 23:50 local time on the last day of the month is attributed to the wrong month because the query uses UTC date boundaries; and partial/mid-month budget creation (a budget created on the 15th showing "0% consumed" when transactions already exist for days 1–14, or vice versa, depending on whether the query filters by budget creation date instead of calendar month).

**Why it happens:**
Budget math is usually implemented as a live aggregate query (`SUM(amount) WHERE category_id = X AND date BETWEEN start AND end`) written once against the happy-path test data, and the date-boundary/timezone/transfer-exclusion edge cases only surface with real usage over multiple months — which won't show up until the project has been running for a while, by which point wrong historical numbers already eroded user trust in the reports feature.

**How to avoid:**
- Explicitly exclude transfer-type transactions from any "spent" aggregation used for budget consumption (this requires transactions to have a clear type discriminator: income/expense/transfer).
- Standardize on storing and querying dates with explicit timezone handling — decide once whether the "month" boundary is UTC or the user's local timezone, and apply it consistently in every date-range query (`date >= :start AND date < :end`, half-open intervals, never `BETWEEN` with an inclusive end-of-day literal that's easy to get off-by-one).
- Compute "consumed" always from calendar month bounds, independent of when the budget record itself was created — a budget for "September" should reflect all September transactions in that category, whether the budget was set up on day 1 or day 20.
- Write edge-case tests explicitly: category with zero transactions (0% not divide-by-zero crash), category over 100% of budget (should not clamp/hide overage), transaction on the exact last millisecond of the month, a transfer between two accounts of the same user (verify it does NOT count as expense).

**Warning signs:**
- Budget queries that don't filter out `type = 'transfer'`.
- Date range queries using string comparison or `BETWEEN` with literal date strings instead of half-open datetime ranges.
- No test for the "budget created mid-month" or "zero transactions" case.

**Phase to address:** Phase implementing Orçamentos (budgets) — write these edge cases into that phase's UAT checklist explicitly, since they won't surface in casual manual testing.

---

### Pitfall 5: RDS reachable from the public internet (defeats the entire network security model)

**What goes wrong:**
The RDS instance is created with `PubliclyAccessible = true` (sometimes the default in the console wizard, or left over from a "let me just connect from my laptop to debug" moment), and/or its security group allows inbound `0.0.0.0/0` on port 5432 instead of only the ECS task's security group. This exposes the database with real financial data directly to internet scanners, independent of any application-level security.

**Why it happens:**
During initial development it's genuinely convenient to connect from a local machine (psql, DBeaver, TypeORM CLI for migrations) directly to RDS, so `PubliclyAccessible = true` gets flipped on "just for now" and never reverted before the first real deployment. Console defaults and quick-start guides often default to public accessibility to minimize setup friction.

**How to avoid:**
- Set `publicly_accessible = false` on the RDS instance from the start (this project's `security-review` skill already requires this — treat it as non-negotiable, not a later hardening pass).
- Restrict the RDS security group's inbound rule to **only** the ECS task's security group as source (not a CIDR block, not "anywhere"), per this project's checklist.
- For local development/migration access, use one of: an SSH bastion/jump host, AWS Systems Manager Session Manager port forwarding, or a VPN — never temporarily flip `PubliclyAccessible` to `true`.
- Verify with the AWS CLI/console after every infra change: `aws rds describe-db-instances` and confirm `PubliclyAccessible: false`, as part of the phase's "what to test before advancing" checklist (already a process requirement in this project).
- Also confirm ECS/RDS are in the same VPC (cross-VPC networking failures are a related but non-security pitfall — see Integration Gotchas below).

**Warning signs:**
- `terraform plan` / CDK synth / console showing `publicly_accessible: true` or a security group ingress rule with `0.0.0.0/0`.
- Being able to `psql` into the RDS endpoint from a home network without a bastion/tunnel.

**Phase to address:** AWS infrastructure phase (RDS setup) — this is the single item in the security checklist most likely to regress silently after being fixed once (e.g. someone re-enables it to debug and forgets to revert), so it should also be part of any later infra-change verification checklist.

---

### Pitfall 6: Secrets baked into Docker image layers or GitHub Actions logs instead of injected at runtime

**What goes wrong:**
Database credentials or JWT secrets end up inside the built Docker image (via a build-time `ARG`/`ENV`, a `.env` file `COPY`'d into the image, or a debug `RUN echo $DB_PASSWORD` step) or printed in plaintext in GitHub Actions run logs. Even if a later Docker layer deletes the file, the secret persists in the image's layer history and can be extracted by anyone who pulls the image (e.g. from a misconfigured-public ECR repo, or by any AWS principal with `ecr:GetDownloadUrlForLayer`). Log-printed secrets sit in GitHub's log storage (and in this project's own checklist: "Nenhum dado sensível... em log do CloudWatch" applies equally to CI logs).

**Why it happens:**
It's tempting to pass secrets as Docker build args for convenience (`docker build --build-arg DB_PASSWORD=...`), or to echo an environment variable while debugging a CI failure and forget to remove the line before merging. Multi-stage Dockerfiles reduce final image size but don't erase build-time secrets from history unless BuildKit's `--secret` mount (not `ARG`) is used specifically.
Additionally, npm/yarn install steps that need a private registry token are a common accidental-echo point (`RUN npm install` failing verbosely can dump env vars into logs via some CI configurations).

**How to avoid:**
- Never pass DB credentials, JWT secret, or any credential as a Docker build `ARG`/`ENV`. The application should read all secrets from environment variables injected at **container runtime** by the ECS task definition's `secrets` block (pulling from Secrets Manager), never baked in at build time — this project's checklist already mandates Secrets Manager, so the CI/CD pipeline must actually respect that boundary end-to-end (build the image with zero secrets present, inject only at ECS task run).
- If build-time secrets are ever genuinely needed (e.g. a private npm registry token), use Docker BuildKit's `--secret` mount, which is never persisted to a layer, instead of `ARG`.
- Ensure `.env`, `*.pem`, and any credential files are in both `.gitignore` and `.dockerignore` (already in this project's checklist) so a stray `COPY . .` doesn't pull them into the build context in the first place.
- Audit GitHub Actions workflow YAML for any `echo`, `cat`, or `print` of a variable sourced from `secrets.*` — GitHub Actions does mask registered secrets in logs automatically, but only for exact string matches; a secret that's been base64-encoded, JSON-stringified, or concatenated with other text will NOT be masked and will leak in plaintext.
- Use least-privilege IAM for the GitHub Actions OIDC role that pushes to ECR/deploys to ECS (scope to specific ECR repo and ECS service ARNs, not `*`), consistent with the project's least-privilege IAM requirement.

**Warning signs:**
- Any `ARG` or `ENV` instruction in the Dockerfile referencing DB_PASSWORD, JWT_SECRET, or similar.
- `RUN echo`/`RUN cat` of an environment variable anywhere in the Dockerfile or workflow YAML.
- GitHub Actions workflow that constructs a connection string by string concatenation before passing it somewhere it might be logged.
- ECR repository without `imageScanningConfiguration` / not scoped as private.

**Phase to address:** CI/CD phase (GitHub Actions → ECR → ECS deploy) — but the Dockerfile itself should be written secret-free from the containerization phase onward, since retrofitting this after the CI/CD phase means re-auditing every prior layer choice.

---

### Pitfall 7: ECS Fargate task marked unhealthy and killed during normal (slow) NestJS startup

**What goes wrong:**
The ALB target group health check and/or the ECS container health check are configured with too short a timeout/interval/start period for how long a NestJS app actually takes to boot (module initialization, TypeORM connection pool warmup, running pending migrations if that happens at startup). ECS repeatedly kills and restarts the task before it ever becomes healthy, producing a crash-loop that looks like an application bug but is actually a health-check timing misconfiguration. This is especially likely for this project's first end-to-end AWS deploy, where a small Fargate task size (e.g. 0.25 vCPU / 0.5GB) combined with cold npm/TypeORM startup can push boot time well past a naive default health check window.

**Why it happens:**
Default/example health check configs online are usually tuned for very fast static-content or lightweight services, and it's easy to copy a Terraform/CDK example wholesale without adjusting `healthCheckGracePeriodSeconds` (ECS service-level, for ALB checks) and the container-level `HEALTHCHECK` interval/retries/start-period for the actual app. There are two independent health check systems (container-level and ALB target-group-level) and it's easy to configure one and forget the other, or to test the container-level one locally (`docker run` + `docker inspect`) and assume it covers the ALB side too.

**How to avoid:**
- Set `healthCheckGracePeriodSeconds` on the ECS service comfortably above observed real cold-start time (measure actual local `docker run` startup time first, add margin — don't guess).
- Make sure the ALB health check path (e.g. `/health`) actually exists as a real endpoint in the NestJS app (add a lightweight `@Controller('health')` that doesn't touch the DB, or a `/health/db` variant that does, depending on what "healthy" should mean) and that the target group's configured path/port exactly matches where the app listens (a `NODE_ENV`/`PORT` mismatch between the Dockerfile `EXPOSE`, task definition `containerPort`, and target group port is a common silent mismatch).
- Verify both health check layers independently: container-level `HEALTHCHECK` in the Dockerfile/task definition, and the ALB target group's own health check — a task can pass one and fail the other.
- During the AWS infra phase, deliberately test the unhealthy path: temporarily break the health endpoint and confirm ECS actually cycles the task, to validate the config is wired correctly rather than just assuming defaults work.

**Warning signs:**
- ECS service events showing repeated "task failed container health checks" or "(reason Request timed out)" immediately after each deploy.
- Health check `interval`/`timeout` values left at documentation-example defaults without being validated against this app's actual measured startup time.
- No dedicated `/health` endpoint — using `/` (which might require auth or hit the DB) as the health check path.

**Phase to address:** AWS infrastructure phase (ECS task definition + ALB target group setup) — validate with an intentional failure test before calling the phase done, per this project's own "checklist of what to test before advancing" process requirement.

---

### Pitfall 8: Running database migrations from inside app startup on a horizontally-scaled/redeployed ECS service

**What goes wrong:**
`migrationsRun: true` (or an equivalent `npm run migration:run` chained into the container's `CMD` before `node dist/main`) executes on **every** container start. During a rolling ECS deployment, old and new task revisions can briefly run side-by-side, or a service auto-scaling event can start multiple tasks concurrently — each container attempting to run the same pending migration simultaneously, racing on TypeORM's migrations lock table and potentially crashing the boot sequence or, worse, partially applying a migration twice.

**Why it happens:**
Running migrations at app startup is the simplest thing that works when there's exactly one task and no deploys happen mid-request — which is true for local development and often true early in a project's life, so it isn't caught until the project has scaled past a single task or a deploy happens to overlap with a cold start.

**How to avoid:**
- Run migrations as a **separate, explicit step** in the deploy pipeline — before the ECS service is updated to the new task definition — not embedded in the container's own startup command. A GitHub Actions step that runs `aws ecs run-task` with a one-off migration task definition (or invokes the migration via an ECS Exec/Fargate task using the same image but a different entrypoint) against the same RDS instance, and only proceeds to `aws ecs update-service` if that task exits 0.
- If starting simple with a single-task deployment (reasonable for this project's stated scale), still isolate migrations from the app's request-serving `CMD` so the pattern is correct from day one and doesn't need to be retrofitted when scaling changes later.
- Never combine `synchronize: true` with a migrations workflow — this project's conventions already forbid `synchronize: true` in production; make sure it's also explicitly disabled (not just "not set") in every environment config, since a silent default can differ between `NODE_ENV`s.
- Add a CI check that fails the build if any generated migration file doesn't match what `synchronize` would have produced against the current entities (catches "forgot to generate a migration for this entity change" before it reaches production).

**Warning signs:**
- Dockerfile/entrypoint `CMD` that runs `typeorm migration:run` chained with `&& node dist/main` and the service is expected to ever run more than one task.
- No separate CI/CD pipeline step dedicated to migrations, visible as its own job/log in GitHub Actions.
- `synchronize` not explicitly and verifiably `false` in the production TypeORM config (validated via the project's env schema, per its own conventions).

**Phase to address:** Containerization phase (Dockerfile/entrypoint design) for getting the pattern right structurally, finalized in the CI/CD phase when the actual deploy pipeline is built.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Storing money as `number`/float instead of decimal/cents | Faster to write, matches naive mental model | Accumulating rounding errors in balances/reports; painful to migrate live financial data later | Never — fix before first migration, not after |
| Running migrations via `migrationsRun: true` in app startup with a single task | Zero extra pipeline work | Breaks the moment the service scales past one task or a rolling deploy overlaps | Only for solo local/dev environments, never production |
| RDS `publicly_accessible = true` "just to debug" | Fast local access without a bastion setup | Real financial data exposed to internet scanners if forgotten | Never in any environment holding real data — use SSM port forwarding instead |
| Ownership check as an `if` after `findOneBy({ id })` instead of `findOneBy({ id, userId })` | Slightly less repetition in early prototyping | One missed branch = full IDOR; hard to audit at scale across modules | Never — bake into a shared repository helper from the start |
| Skipping concurrent-request tests for transfers | Ships the transfer feature faster | Silent lost-update bugs only surface under real concurrent usage, after trust is already lost | Acceptable only if the feature is explicitly gated as single-user-at-a-time with a documented follow-up ticket — not appropriate for this project's "money is a core requirement" framing |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|-------------------|
| ECS Fargate ↔ RDS | ECS tasks and RDS placed in different VPCs or non-overlapping subnets/AZs, connection silently times out | Place RDS in private subnets of the same VPC as ECS; ensure ALB public subnets and ECS private subnets share availability zones |
| ALB ↔ ECS target group | Target group health check port/path doesn't match the container's actual listening port/path | Explicitly set `containerPort` in the task definition, target group port, and app's `PORT` env var to the same value; add a real lightweight `/health` route |
| GitHub Actions ↔ ECR | OIDC role or long-lived AWS keys given broad `ecr:*`/`ecs:*` permissions across all repos/services | Scope IAM policy to the specific ECR repository ARN and ECS cluster/service ARNs used by this project only |
| GitHub Actions ↔ Secrets Manager | Secrets fetched in CI and passed as plaintext env vars into a later Docker build step | Never fetch app secrets during the CI build step at all — the built image should be secret-free; secrets belong only in the ECS task definition's runtime `secrets` block |
| TypeORM ↔ multiple ECS tasks | Each task independently attempting `migrationsRun` on startup | Migrations run as one isolated pipeline step before service update, as described in Pitfall 8 |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Computing budget "consumed" with an N+1 query per category on every report request | Reports endpoint gets slower as number of categories/transactions grows | Use a single aggregated `SUM(...) GROUP BY category_id` query instead of looping categories in application code | Noticeable once a user has 1+ years of transaction history across several categories — still a personal-scale app, but worth doing right from the start since it's not more code either way |
| No index on `(userId, ...)` for tenant-scoped queries | Every list/report query does a full table scan filtered by userId | Add a composite index with `userId` as the leading column on every frequently-queried table (transactions, accounts) | Not urgent at personal-project single-tenant-in-practice scale, but cheap to do at migration-creation time and prevents a schema-change migration later |
| Small Fargate task size (0.25 vCPU/0.5GB) combined with cold TypeORM connection pool warmup on every deploy | Slow rolling deploys, health check near-misses (see Pitfall 7) | Size the task appropriately for actual NestJS + TypeORM memory footprint (measure, don't guess), keep connection pool size modest for a low-traffic personal app | Becomes visible on the very first real ECS deploy, not a future-scale concern |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Ownership check performed only on GET, not on PATCH/DELETE for the same resource | Attacker can't read another user's transaction but can delete/modify it | Apply the same `{ id, userId }` scoping helper to every verb uniformly, verified by the cross-tenant test suite described in Pitfall 3 |
| JWT secret rotated manually with no revocation of already-issued tokens | A leaked JWT secret continues to grant valid tokens indefinitely if rotation isn't paired with short expiry | Keep JWT expiration genuinely short (already in this project's checklist) so a compromised secret has a bounded blast radius even without a revocation list |
| CloudWatch logs including full request/response bodies for financial endpoints | Balances and transaction details end up in log storage, widening the blast radius of any log access breach | Configure NestJS logging interceptors to redact/omit amount and balance fields, log only IDs and status codes for financial mutation endpoints |
| IAM role for ECS task reused for both the app's runtime AND CI/CD deploy actions | A compromised app-runtime credential could also modify infrastructure | Use two distinct IAM roles: a narrow ECS task role (only Secrets Manager read for its own secrets, CloudWatch write) and a separate CI/CD deploy role (ECR push, ECS service update) — never share |

## "Looks Done But Isn't" Checklist

- [ ] **Transfers between accounts:** Often missing pessimistic locking / transaction wrapping — verify with a concurrent-request test, not just sequential manual testing.
- [ ] **Every "get by ID" / "update by ID" / "delete by ID" endpoint:** Often missing the `userId` scope in the query itself — verify with an automated cross-tenant test suite that tries every endpoint with another user's ID.
- [ ] **Budget consumed/remaining calculation:** Often missing transfer exclusion and correct month-boundary/timezone handling — verify with edge-case tests (zero transactions, over-budget, mid-month budget creation, month-boundary timestamps).
- [ ] **RDS network exposure:** Often flipped to public temporarily for debugging and left that way — verify with `aws rds describe-db-instances` showing `PubliclyAccessible: false` as part of every infra-change checklist, not just once.
- [ ] **Docker image contents:** Often contains secrets from a build-time `ARG`/`.env` COPY even after "removing" them in a later layer — verify by running `docker history --no-trunc` on the built image and scanning for credential strings.
- [ ] **ECS health checks:** Often configured with default/example timing that doesn't match this app's actual cold-start time — verify by deliberately breaking the health endpoint once and confirming ECS reacts as expected.
- [ ] **Migrations in CI/CD:** Often still embedded in the app's own startup `CMD` even after a "proper" pipeline is built — verify migrations appear as their own distinct step/job in the GitHub Actions run log, separate from the deploy step.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|-----------------|
| Money stored as float, discovered after real transactions exist | MEDIUM | Write a data migration that reconstructs exact decimal values from stored floats where still recoverable (may require manual reconciliation for already-drifted balances), change column type, add regression test, audit all arithmetic call sites |
| IDOR found in production | HIGH (if data was actually accessed by another user) / LOW (if only a code-review finding) | Patch the query immediately, add the endpoint to the cross-tenant test suite, audit CloudWatch/ALB access logs for evidence of exploitation before declaring it a non-incident |
| RDS was briefly publicly accessible | MEDIUM | Immediately flip `publicly_accessible` to false and tighten the security group, rotate DB credentials via Secrets Manager (assume any exposure window could have been probed), review RDS logs for the exposure window for unexpected connections |
| Secret found baked into a pushed Docker image/ECR layer | HIGH | Rotate the leaked credential immediately (Secrets Manager + downstream consumers), delete the tagged image from ECR, rebuild secret-free, treat the credential as compromised regardless of whether exploitation is confirmed |
| Migration race condition caused a partially-applied schema change | MEDIUM | Restore RDS from automated backup/snapshot to just before the bad deploy if data was affected, otherwise manually reconcile the migrations table and re-run the pipeline with the fixed single-step migration process |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|---------------|
| Money as float | Accounts/Transactions data model phase | Unit test: 1000 sequential decimal additions yield exact expected total; code review confirms no raw `number` arithmetic on money fields |
| Transfer atomicity/locking | Transfers phase | Integration test firing concurrent transfer requests against the same account pair; assert exact final balance |
| IDOR / multi-tenant isolation | Every module phase (accounts, categories, transactions, budgets, reports) | Automated cross-tenant test suite per module, added to each module's Definition of Done |
| Budget calculation edge cases | Budgets phase | Edge-case test suite: zero transactions, over-100%, mid-month creation, month-boundary timestamps, transfer exclusion |
| RDS public accessibility | AWS infrastructure phase (RDS setup) | `aws rds describe-db-instances` confirms `PubliclyAccessible: false`; security group ingress restricted to ECS SG only |
| Secrets in image/logs | Containerization phase (structural) + CI/CD phase (pipeline enforcement) | `docker history --no-trunc` shows no credential strings; GitHub Actions workflow reviewed for unmasked secret echoes |
| ECS health check misconfiguration | AWS infrastructure phase (ECS + ALB setup) | Deliberate health-endpoint failure test confirms ECS cycles the task as expected within the configured grace period |
| Migrations run per-container-start | Containerization phase (design) + CI/CD phase (pipeline) | Migration step appears as its own distinct CI/CD job, decoupled from app `CMD`; `synchronize` verified false via env schema validation |

## Sources

- [How to properly handle decimals with TypeORM (Medium)](https://medium.com/@matthew.bajorek/how-to-properly-handle-decimals-with-typeorm-f0eb2b79ca9c) — LOW confidence, community source
- [Money operations with Node.js and PostgreSQL (Medium)](https://medium.com/geekculture/money-operations-with-node-js-and-postgresql-91d1f06ff263) — LOW confidence, community source
- [TypeORM Postgres driver docs](https://typeorm.io/docs/drivers/postgres/) — official docs, confirms string unmarshalling of numeric/decimal
- [TypeORM GitHub Issue #2937 — decimal returned as string](https://github.com/typeorm/typeorm/issues/2937) — official repo issue tracker
- [NestJS Multi-Tenancy: Data Isolation Guardrails (Medium)](https://medium.com/@Quaxel/nestjs-multi-tenancy-data-isolation-guardrails-30cb6bfe151c) — LOW confidence, community source
- [IDOR: Examples & Prevention (Authgear)](https://www.authgear.com/post/idor-insecure-direct-object-reference/) — LOW-MEDIUM, vendor security content
- [Pessimistic Locking in Node.js with TypeORM (gist)](https://gist.github.com/tomfun/26f909789d168d44acbeed08f502cd91) — LOW confidence
- [TypeORM Issue #4692/#4810 — pessimistic lock requires open transaction](https://github.com/typeorm/typeorm/issues/4692) — official repo issue tracker
- [Troubleshoot health check failures for Amazon ECS tasks on Fargate (AWS re:Post)](https://repost.aws/knowledge-center/ecs-fargate-health-check-failures) — MEDIUM confidence, official AWS support content
- [Troubleshooting ALB health check failures on Fargate (AWS re:Post)](https://repost.aws/knowledge-center/fargate-alb-health-checks) — MEDIUM confidence, official AWS support content
- [Optimize load balancer health check parameters for Amazon ECS (AWS docs)](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/load-balancer-healthcheck.html) — MEDIUM/HIGH confidence, official AWS docs
- [Amazon ECS service unhealthy event messages (AWS docs)](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-unhealthy-event-messages.html) — MEDIUM/HIGH confidence, official AWS docs
- [Can't connect to RDS from FARGATE service (aws-cdk GitHub discussion)](https://github.com/aws/aws-cdk/discussions/25405) — LOW-MEDIUM confidence, official repo discussion
- [Automatic migrations causing issues on ECS cluster (TypeORM Issue #3400)](https://github.com/typeorm/typeorm/issues/3400) — official repo issue tracker
- [Create Production Dockerfile with Migrations — NestJS + TypeORM + Docker](https://peturgeorgievv.com/blog/nestjs-with-typeorm-and-docker-running-migrations-before-start) — LOW confidence, community source
- [The Docker Layer That's Leaking Your Environment Variables (Medium)](https://medium.com/@sohail_saifii/the-docker-layer-thats-leaking-your-environment-variables-5dc56b2c1d08) — LOW confidence, community source
- [Docker Secrets in CI/CD: Stop Leaking Sensitive Data (Xygeni)](https://xygeni.io/blog/docker-secrets-in-cicd-stop-leaking-sensitive-data/) — LOW-MEDIUM confidence, vendor security content
- This project's own `security-review` skill checklist (`.claude/skills/security-review/SKILLS.md`) — HIGH confidence, project-authoritative source

---
*Pitfalls research for: NestJS personal finance API on AWS (ECS Fargate/RDS/ALB/Secrets Manager/GitHub Actions)*
*Researched: 2026-09-11*
