# Phase 9: CI/CD Pipeline - Pattern Map

**Mapped:** 2026-09-23
**Files analyzed:** 8
**Analogs found:** 6 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `.github/workflows/deploy.yml` | CI workflow | batch/request-response | none in repo (RESEARCH.md + CLAUDE.md pipeline shape); Postgres service from `docker-compose.yml` | no analog |
| `infra/oidc.tf` | config (IAM) | request-response | `infra/ecs.tf` lines 40-66 (assume-role policy doc + role) | role-match |
| `infra/ecs.tf` (modify) | config | CRUD | itself | exact |
| `infra/variables.tf` (modify) | config | n/a | itself lines 47-62 | exact |
| `package.json` (add `lint:check`) | config | n/a | line 15 `lint` | exact |
| `infra/migrate-overrides.json` (reuse) | config | n/a | itself | exact |
| `infra/README.md` / verify script (runbook, checklist) | docs/script | n/a | `infra/README.md`, `infra/scripts/verify-phase8.sh` | exact |
| ECR lifecycle policy (CLI or new `infra/ecr-lifecycle.json`) | config | n/a | none (ECR repo created outside Terraform in Phase 7) | no analog |

## Pattern Assignments

### `infra/oidc.tf` (IAM config)
**Analog:** `infra/ecs.tf` 40-66. Copy the `aws_iam_policy_document` -> `aws_iam_role` style, naming `financial-control-*`, comments citing decision IDs.
```hcl
data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals { type = "Service"  identifiers = ["ecs-tasks.amazonaws.com"] }
  }
}
resource "aws_iam_role" "execution" {
  name               = "financial-control-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}
```
Adapt: principal `type = "Federated"` with the OIDC provider ARN, action `sts:AssumeRoleWithWebIdentity`, conditions `StringEquals` on `token.actions.githubusercontent.com:aud = sts.amazonaws.com` and `:sub = repo:<owner>/financial-control-api:ref:refs/heads/main`. Add a `github_repo` variable (default `<owner>/financial-control-api`). Reuse `data.aws_caller_identity.me` (defined in ecs.tf, same root module; do not redeclare). Scope resources with references: `aws_ecs_cluster.this.arn`, `aws_ecs_service.api.id`, `aws_iam_role.execution.arn`, `aws_iam_role.task.arn`. ECR repo is not a Terraform resource, so build its ARN as `arn:aws:ecr:${var.region}:${account_id}:repository/${var.ecr_repository_name}`. `ecr:GetAuthorizationToken` needs `*`. Add an `output` for the role ARN (same style as ecs.tf outputs, lines 140-154) to paste into the GitHub repo variable.

### `infra/ecs.tf` (modify)
- Circuit breaker already exists (lines 127-130, enable + rollback). D-12 needs no change there; only mention it in docs.
- Replace comment at lines 103-104 and add inside `aws_ecs_service.api`:
```hcl
  lifecycle {
    ignore_changes = [task_definition]
  }
```
- Caveat for planner: `aws_ecs_task_definition.api` still uses `var.image_tag` (default `c0ebba2`). After CI registers revisions, a fresh `apply` after destroy recreates from that stale tag. Document in the runbook, or bump `-var image_tag=<sha>`.
- `wait_for_steady_state = true` stays.

### `.github/workflows/deploy.yml`
No repo analog. Sources to reuse:
- Postgres service container mirrors `docker-compose.yml` lines 2-18: `image: postgres:16`, env `POSTGRES_USER/PASSWORD/DB`, healthcheck `pg_isready -U ... -d ...` (interval 5s, timeout 5s, retries 10). The e2e job must export the same env names the API requires (`DB_HOST=localhost`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `ALLOWED_ORIGINS`; see `src/config/env.validation.ts` for the authoritative list).
- Migration command comes from `infra/migrate-overrides.json` (container name `api`, command `node node_modules/typeorm/cli.js -d dist/database/data-source.js migration:run`). Use `--overrides file://infra/migrate-overrides.json`.
- Network for `run-task`: read from the live service, `aws ecs describe-services --query 'services[0].networkConfiguration.awsvpcConfiguration'` (avoids duplicating IDs; service uses private subnets, task SG, `assign_public_ip = false`, per ecs.tf 115-119).
- Fail on migration exit code: `aws ecs wait tasks-stopped`, then check `tasks[0].containers[?name=='api'].exitCode` is 0.
- Names: cluster `financial-control`, service and family `financial-control-api`, container `api`, region `sa-east-1` (variables.tf line 4).
- Structure per D-05: job `test` (no `id-token`) -> job `deploy` (`needs: test`, `permissions: id-token: write, contents: read`). Triggers `push: branches: [main]` + `workflow_dispatch`. `concurrency` with `cancel-in-progress: false`. Steps order: configure-aws-credentials (`role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}`) -> ecr-login -> docker build/push tag `${{ github.sha }}` -> render-task-definition -> register/run migration with the new task def -> deploy-task-definition (`wait-for-service-stability: true`).
- Image tag caveat: ECR immutability means re-running the same SHA fails on push; handle with a check (`aws ecr describe-images`) or skip push if the tag exists, so `workflow_dispatch` redeploys work.
- Existing tag `c0ebba2` is a short SHA; decide whether CI uses full or short SHA (`variables.tf` validation only forbids `latest`).

### `package.json`
Analog line 15. Add next to it:
```json
"lint:check": "eslint \"{src,apps,libs,test}/**/*.ts\"",
```
Workflow runs `npm ci`, `npm run lint:check`, `npm test`, `npm run test:e2e` (script line 20, `jest --config ./test/jest-e2e.json`).

### ECR lifecycle policy
No analog. Simplest: JSON file committed under `infra/` applied by `aws ecr put-lifecycle-policy` (repo is outside Terraform). Rule: `tagStatus: any`, `countType: imageCountMoreThan`, `countNumber: 10`, `action: expire`.

### Runbook / checklist
Analog: `infra/README.md` and `infra/scripts/verify-phase8.sh`. Follow their structure for a Phase 9 section and `verify-phase9.sh`. Note that the pipeline needs the infra applied, and the `destroy` then `apply` flow recreates the role with the same ARN.

## Shared Patterns

### Pre-push hygiene (D-02)
- `git ls-files` shows no `infra/tfplan*` tracked; `.gitignore` already excludes them or they are untracked. Confirm before the first push: `git ls-files | grep -E 'tfplan|tfstate|\.env$'` (currently only `.env.example` matches, which is fine). Still scan history for secrets. `.planning/` is published (user decision this session), so review it for account IDs and secret values.
- Repo name `financial-control-api`, public. Rename `master` to `main` first (`git branch -m main`).

### Terraform conventions
One root module in `infra/`, decision-ID comments (`# D-08`), resources named `this`/`api`, outputs at the bottom of each file, region from `var.region`.

## No Analog Found
| File | Reason |
|---|---|
| `.github/workflows/deploy.yml` | no `.github/` exists |
| ECR lifecycle policy | ECR is managed outside Terraform |

## Metadata
**Search scope:** repo root, `infra/`, `package.json`, `docker-compose.yml`. All analog paths are git-tracked. `src/` not scanned (no app code changes expected).
