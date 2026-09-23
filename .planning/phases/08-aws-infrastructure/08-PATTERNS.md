# Phase 8: AWS Infrastructure - Pattern Map

**Mapped:** 2026-09-23
**Files analyzed:** 14 (new + modified)
**Analogs found:** 4 partial / 14 (Terraform has no in-repo analog)

All analog paths below are git-tracked (verified with git ls-files).

## File Classification

| File | Role | Data Flow | Closest Analog | Match |
|------|------|-----------|----------------|-------|
| infra/versions.tf, backend.tf (S3 state, use_lockfile) | config | n/a | none | none |
| infra/variables.tf, outputs.tf | config | n/a | none | none |
| infra/network.tf (VPC, 2 AZ, NAT, SGs) | config | n/a | none | none |
| infra/alb.tf | config | request-response | none | none |
| infra/ecs.tf (cluster, task def, service, roles, logs) | config | request-response | `docker-compose.yml` api service (env contract) | partial |
| infra/rds.tf | config | CRUD | `docker-compose.yml` db service (PG16, DB_NAME/USER) | partial |
| infra/secrets.tf (data source for JWT secret ARN) | config | n/a | `.env.example` (variable names) | partial |
| `.gitignore` (modify) | config | n/a | itself | exact |
| `README.md` (modify, Deployment section at line 60) | docs | n/a | itself | exact |
| `Dockerfile` (possibly modify for migration:run) | config | batch | itself | exact |
| `package.json` scripts (possibly add prod migration script) | config | batch | existing migration:* scripts | exact |
| `src/database/data-source.ts` (possibly modify) | config | batch | itself | exact |

## Pattern Assignments

### infra/ecs.tf task definition env and secrets (ecs, request-response)

**Source of truth:** `src/config/env.validation.ts` lines 10-33. The container must receive ALL of these or it refuses to boot:
`NODE_ENV, PORT, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, JWT_ACCESS_SECRET (min 32 chars), JWT_ACCESS_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN, ALLOWED_ORIGINS`. There is NO JWT_REFRESH_SECRET; do not create one.

**Mapping (D-08/D-09):**
- `environment`: NODE_ENV=production, PORT=3000, DB_HOST (aws_db_instance.address), DB_PORT=5432, DB_NAME, JWT_ACCESS_EXPIRES_IN=15m, JWT_REFRESH_EXPIRES_IN=7d, ALLOWED_ORIGINS
- `secrets` (valueFrom): DB_USER = `<rds master secret arn>:username::`, DB_PASSWORD = `<arn>:password::`, JWT_ACCESS_SECRET = ARN from `data "aws_secretsmanager_secret"`. Grant GetSecretValue on the execution role.

Values to mirror from `docker-compose.yml` lines 28-43 (`.env.example` lines 2-22 give defaults: 15m, 7d, DB name/user `financial_control`).

**Container health check / port** (`Dockerfile` lines 58-65): container listens on PORT (3000); image HEALTHCHECK uses node http on `/health` with interval 30s, timeout 3s, start-period 15s, retries 3. Mirror in the task definition `healthCheck` (no curl in image, use the same `node -e` command) and set target group `health_check.path = "/health"`, port 3000, plus ECS `health_check_grace_period_seconds` (start-period 15s is the floor; use longer).

**Non-root:** image runs as user `nestjs` (Dockerfile line 47/53); no special task-level user needed.

### infra/rds.tf (config)

Mirror `docker-compose.yml` lines 2-13: engine postgres 16, db name and username `financial_control` (`db_name`, `username`), and use `manage_master_user_password = true` (D-08) rather than a password variable. Note the app does NOT set SSL in `data-source.ts` (lines 9-19: no `ssl` option); RDS Postgres 16 defaults to `rds.force_ssl=1` on new PG15+ parameter groups, so connections may be rejected. Flag for the planner: either set `rds.force_ssl=0` in a parameter group or add `ssl` to the app config (a Phase 7/app change). Verify with the one-off migration task.

### Migration run-task (D-10) (batch)

**Analog:** `package.json` lines 21-24:
```
"typeorm": "ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js -d src/database/data-source.ts",
"migration:run": "npm run typeorm -- migration:run",
```
**BLOCKER for planner:** `Dockerfile` lines 29-39 deliberately `rm -rf node_modules/typescript node_modules/ts-node` and copies only `dist/`, `node_modules`, `package.json` (lines 49-51). So `npm run migration:run` cannot run in the production image (needs ts-node and `src/`). Also `Dockerfile` line 35-38 comment says migrations never run in this container.
Viable fix: run the compiled data source with the TypeORM CLI, e.g. override command in run-task to
`node node_modules/typeorm/cli.js -d dist/database/data-source.js migration:run`. `data-source.ts` globs `__dirname + '/migrations/*{.ts,.js}'` (line 17) and entities `.entity{.ts,.js}` (line 16), so compiled `.js` is picked up under `dist/database/`. Verify `dist/database/data-source.js` exists after `nest build` and that typeorm's CLI works without ts-node (also `dotenv` `config()` on line 7 is harmless). Consider adding a `migration:run:prod` script to `package.json` (analog: lines 22-24) and no Dockerfile stage change. The run-task override uses the same env/secrets as the service (DB_* from secrets and env vars; data-source reads process.env.DB_HOST/PORT/USER/PASSWORD/NAME only).
Migrations present: `src/database/migrations/` 7 files (InitUsers ... CreateBudgets).

### `.gitignore` (modify)

Existing style: commented groups with plain patterns (e.g. lines "# Docker" / `docker-compose.override.yml`). Append a group:
```
# Terraform
infra/.terraform/
*.tfstate
*.tfstate.*
*.tfvars
crash.log
```
Do NOT ignore `infra/.terraform.lock.hcl` (commit it).

### `README.md` (modify)

Has an existing `## Deployment` heading (line 60) currently NestJS boilerplate; replace/extend with: one-time AWS CLI bootstrap (S3 state bucket with versioning + SSE + public access block; JWT secret via `aws secretsmanager create-secret`), `terraform init/plan/apply/destroy`, run-task migration command, HTTP-only warning (D-06), cost note (NAT ~US$32/mo).

### `.env.example` (likely no change)

Only names matter to the task definition; keep in sync if any env var is added. Not a Terraform input.

## Shared Patterns

- Env contract: `src/config/env.validation.ts` is the single list of required runtime vars; both the service and migration task definitions must satisfy it (migration task needs only DB_*).
- Comment style in repo: decision-tagged comments referencing D-xx / threat IDs (Dockerfile). Use the same in .tf files (e.g. `# D-05: single NAT`).
- Immutable image tag (never `:latest`); ECR account 796897109626 per CONTEXT; expose as a Terraform variable `image_tag`.
- Sensitive values never in state/tf: JWT secret and DB password are created outside Terraform or RDS-managed.

## No Analog Found

All Terraform files (`infra/*.tf`, backend config, outputs, SGs, IAM roles, ALB, target group, CloudWatch log group). No .tf files, IaC, or CI files exist in the repo. Use 08-RESEARCH.md patterns and the Terraform AWS provider docs.

## Metadata

**Analog search scope:** repo root, src/config, src/database, package.json, docker-compose.yml
**Pattern extraction date:** 2026-09-23
