# Phase 9: CI/CD Pipeline - Research

**Researched:** 2026-09-23
**Domain:** GitHub Actions to AWS (OIDC, ECR, ECS Fargate) with Terraform-managed IAM
**Confidence:** HIGH (action inputs/behavior read from the actions' own action.yml, README and index.js this session); MEDIUM on two items tagged [ASSUMED]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Rename local branch `master` to `main`, create the GitHub repo via `gh`, add remote, initial push. Setup step of the plan.
- **D-02:** Repo **public**. Before first push: remove/ignore infra artifacts (`infra/tfplan`, `infra/tfplan.txt`, `infra/tfplan.apply.log`), confirm `.gitignore` (`.terraform/`, `*.tfstate*`, `.env`), ensure no secret in history. Account ID is not a secret; prefer variables over literals where cheap.
- **D-03:** Triggers: `push` on `main` + `workflow_dispatch`. No `pull_request` for now.
- **D-04:** Gate before build/deploy: lint (check mode, no `--fix`) + unit tests + e2e. e2e uses a **Postgres 16 service container**. Add a check-only lint script (e.g. `lint:check`).
- **D-05:** 2 jobs: `test` (no AWS permissions) then `deploy` (`needs: test`, only job with `id-token: write`, assumes the OIDC role).
- **D-06:** OIDC provider (`token.actions.githubusercontent.com`) + deploy role + policy in Terraform `infra/` (new `oidc.tf`, same root module). Role ARN goes to the workflow via a GitHub repository variable.
- **D-07:** Trust policy with exact `sub = repo:<owner>/<repo>:ref:refs/heads/main` and `aud = sts.amazonaws.com`.
- **D-08:** Least-privilege with resource scope: ECR push only on the API repo; `ecs:RegisterTaskDefinition`, `UpdateService`, `DescribeServices`, `DescribeTaskDefinition`, `RunTask`, `DescribeTasks` scoped where AWS allows (`*` only where mandatory); `iam:PassRole` only for execution + task roles with `iam:PassedToService = ecs-tasks.amazonaws.com`; log read only if needed to show migration failure.
- **D-09:** CI registers new task-definition revisions: `amazon-ecs-render-task-definition` swaps the image for the commit tag in the live task def; `amazon-ecs-deploy-task-definition` updates the service and waits for stability. Terraform gets `lifecycle { ignore_changes = [task_definition] }` on `aws_ecs_service`. No broad infra permissions, no `terraform apply` in CI.
- **D-10:** Migration via `aws ecs run-task` with the NEW image (newly registered task def) + `infra/migrate-overrides.json`, same private subnets and SG as the tasks. Job waits for task stop and **fails the pipeline if container exit code != 0**; service never updated on failed migration. Forward-only, backward-compatible migrations.
- **D-11:** Image tagged with git SHA (immutable; ECR immutability ON); never `:latest`.
- **D-12:** ECS deployment circuit breaker with rollback enabled + ECR lifecycle policy keeping ~10 most recent images.

### Claude's Discretion
- Exact action versions (current majors, ideally pinned).
- npm cache, job/step names, timeouts, `concurrency` (suggested: one deploy at a time, never cancel an in-progress deploy).
- How to obtain subnets/SG for `run-task` (repo variables vs `terraform output` vs `describe-services` lookup) - prefer reading the ECS service's own network config.
- Name of the check-only lint script and minimal `package.json` changes.
- Explain each AWS service/concept during planning/execution (Cloud Practitioner study) and produce the end-of-phase test checklist (project constraint).

### Deferred Ideas (OUT OF SCOPE)
- `pull_request` trigger; GitHub Environment `production` with approval; Terraform plan/apply in CI; HTTPS/ACM/domain, secret rotation, VPC endpoints; vulnerability-scan gate blocking deploy (final hardening phase).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-03 | OIDC instead of static AWS keys for GitHub to AWS | `configure-aws-credentials@v6` + `id-token: write` on deploy job only; `oidc.tf` (provider + role + trust); IMPORTANT immutable-`sub` finding below |
| INFRA-04 | Migrations as an explicit pipeline step | Deploy action's native `run-task` + `wait-for-task-stopped` fails on non-zero exit code BEFORE the service update (verified in action source) |
</phase_requirements>

## Summary

The pipeline maps cleanly to the six official AWS actions. Two findings change what the locked decisions literally say, and the planner must handle both. **(1) D-07's `sub` string will not match.** Repos created on/after 2026-07-15 emit an *immutable* subject claim `repo:<owner>@<ownerId>/<repo>@<repoId>:ref:refs/heads/main`; the new public repo will be one of those. The trust policy must use that form (owner ID is `162494392` for `evertonmedola`; repo ID exists only after `gh repo create`). D-07's intent (only `main` of this exact repo) is fully preserved, only the literal string differs. **(2) The task definition and service do not currently exist**: the stack is destroyed (service status INACTIVE), so CI's "render the live task def" step can only run after a Terraform `apply` — the runbook/plan must order: create repo, `apply`, set variables, then the workflow can succeed.

The deploy action (`amazon-ecs-deploy-task-definition@v2`, index.js read this session) already implements D-10: with `run-task: true` + `wait-for-task-stopped: true` it registers the task def, runs the one-off task with overrides/subnets/SGs, waits for STOPPED, throws if any container exit code != 0, and only then updates the service if `service` was given. So no hand-written `aws ecs wait`/exit-code shell is needed. To keep migration an explicit, separate pipeline step (Success Criterion 2), invoke the action twice: step "Migrate" (no `service`, `run-task: true`) and step "Deploy" (`service`, `wait-for-service-stability: true`). Cost: one extra identical task-def revision per deploy (harmless).

`deployment_circuit_breaker { enable = true, rollback = true }` is **already present** in `infra/ecs.tf` (verified below), so D-12's circuit-breaker half needs no change; only `ignore_changes` and the ECR lifecycle policy are new. The developer IAM user (`medolaFinance`) currently cannot even `iam:ListOpenIDConnectProviders` — its scoped policy must be extended before `terraform apply` of `oidc.tf` (human checkpoint).

**Primary recommendation:** Use two jobs (`test`, `deploy`); deploy = configure-aws-credentials (OIDC) then ecr-login, build/push (skip if tag exists), render, Migrate (deploy action `run-task`), Deploy (deploy action `service`), then a post-check that PRIMARY deployment is COMPLETED on the new task def ARN. Terraform: `oidc.tf` (provider, role with immutable-sub trust, scoped policy), `ignore_changes`, `aws_ecr_lifecycle_policy` by repo name (no import needed).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Lint/unit/e2e gate | GitHub Actions runner (`test` job) | Postgres 16 service container | No AWS access needed; least privilege by construction (D-05) |
| Identity federation | AWS IAM/STS (OIDC provider + role trust) | GitHub OIDC token issuer | STS validates GitHub-signed JWT and issues short-lived creds |
| Image build/store | Runner (docker build) then ECR | — | Immutable SHA tags; lifecycle policy prunes |
| Migration execution | ECS Fargate one-off task | Deploy action orchestrates | Runs inside the VPC (RDS is private; runner cannot reach it) |
| Rollout + rollback | ECS service (rolling + circuit breaker) | Deploy action waits | Rollback logic lives in ECS, not in CI |
| IAM/OIDC/ECR-policy definition | Terraform (`infra/`, run by human) | — | CI role deliberately has no infra permissions (D-09) |

## Standard Stack

### Core (versions read from `gh api .../releases/latest`, 2026-09-23) [VERIFIED: GitHub releases API]
| Action | Latest release | Pin in workflow | Notes |
|--------|---------------|-----------------|-------|
| `actions/checkout` | v7.0.1 (2026-07-20) | `@v7` | |
| `actions/setup-node` | v7.0.0 (2026-07-14) | `@v7` | `node-version: 24`, `cache: npm` |
| `aws-actions/configure-aws-credentials` | v6.3.0 (2026-09-15) | `@v6` | runs on `node24`; `audience` default `sts.amazonaws.com`; inputs used: `role-to-assume`, `aws-region`, optional `role-session-name` |
| `aws-actions/amazon-ecr-login` | v2.1.7 (2026-08-19) | `@v2` | output `registry` |
| `aws-actions/amazon-ecs-render-task-definition` | v1.9.0 (2026-06-30) | `@v1` | inputs include `task-definition-family` (fetches live def itself), `container-name`, `image` |
| `aws-actions/amazon-ecs-deploy-task-definition` | v2.6.3 (2026-07-01) | `@v2` | inputs: `task-definition`, `service`, `cluster`, `wait-for-service-stability`, `wait-for-minutes`, `run-task`, `run-task-container-overrides`, `run-task-subnets`, `run-task-security-groups`, `wait-for-task-stopped`; output `task-definition-arn` |

Pinning: the "ideally pinned" discretion is met by major tags (`@v6`) — proportionate for a solo project. Optionally pin to full commit SHA for the `aws-actions/*` trio in the later hardening phase. [ASSUMED: major-tag pinning is sufficient]

No npm packages are added by this phase, only a `package.json` script (`lint:check`), so the Package Legitimacy Audit is N/A. Docker build uses plain `docker build`/`docker push` on the runner (Docker is preinstalled on `ubuntu-latest`); no `docker/*` actions needed.

## Architecture Patterns

### Pipeline flow
```
push main / workflow_dispatch
        |
   [job test]  (permissions: contents: read)  services: postgres:16
     checkout -> setup-node(24, npm cache) -> npm ci
     -> lint:check -> npm test -> npm run migration:run (CI db) -> npm run test:e2e
        | needs: test
   [job deploy] (permissions: id-token: write, contents: read) concurrency: deploy, cancel-in-progress: false
     checkout -> configure-aws-credentials (OIDC, role from vars.AWS_DEPLOY_ROLE_ARN)
     -> ecr-login -> [tag exists in ECR?] no: docker build -t $REG/$REPO:$SHA . && docker push
     -> describe-services -> subnets/SG (from the service itself)
     -> render-task-definition (task-definition-family, container api, image :$SHA)
     -> "Migrate": deploy-task-definition (run-task, overrides, wait-for-task-stopped; NO service)
              fail if exit != 0  -> pipeline stops, service untouched
     -> "Deploy": deploy-task-definition (service, cluster, wait-for-service-stability)
              circuit breaker rolls back on failure
     -> post-check: PRIMARY deployment rolloutState == COMPLETED and taskDefinition == new ARN
```

### Recommended structure
```
.github/workflows/deploy.yml   # single workflow, 2 jobs, short comments (portfolio)
infra/oidc.tf                  # provider + role + policy + outputs
infra/ecr.tf (or in oidc.tf)   # aws_ecr_lifecycle_policy
infra/ecs.tf                   # + lifecycle ignore_changes
infra/migrate-overrides.json   # reused as-is
.gitattributes                 # * text=auto eol=lf   (see Pitfall 6)
```

### Pattern: Migrate then Deploy with the same rendered file
```yaml
# Source: aws-actions/amazon-ecs-deploy-task-definition README "Running Tasks" + index.js (read 2026-09-23)
- name: Network config from the service itself (no duplicated IDs)
  id: net
  run: |
    CFG=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
      --query 'services[0].networkConfiguration.awsvpcConfiguration' --output json)
    echo "subnets=$(echo "$CFG" | jq -r '.subnets | join(",")')" >> "$GITHUB_OUTPUT"
    echo "sgs=$(echo "$CFG" | jq -r '.securityGroups | join(",")')" >> "$GITHUB_OUTPUT"
    echo "overrides=$(jq -c .containerOverrides infra/migrate-overrides.json)" >> "$GITHUB_OUTPUT"

- name: Render task definition with the new image
  id: render
  uses: aws-actions/amazon-ecs-render-task-definition@v1
  with:
    task-definition-family: financial-control-api
    container-name: api
    image: ${{ steps.ecr.outputs.registry }}/financial-control-api:${{ github.sha }}

- name: Migrate (one-off Fargate task, new image; aborts pipeline on non-zero exit)
  uses: aws-actions/amazon-ecs-deploy-task-definition@v2
  with:
    task-definition: ${{ steps.render.outputs.task-definition }}
    cluster: financial-control
    run-task: true
    wait-for-task-stopped: true
    run-task-subnets: ${{ steps.net.outputs.subnets }}
    run-task-security-groups: ${{ steps.net.outputs.sgs }}
    run-task-container-overrides: ${{ steps.net.outputs.overrides }}

- name: Deploy
  id: deploy
  uses: aws-actions/amazon-ecs-deploy-task-definition@v2
  with:
    task-definition: ${{ steps.render.outputs.task-definition }}
    cluster: financial-control
    service: financial-control-api
    wait-for-service-stability: true
    wait-for-minutes: 15
```
Notes verified in `index.js`: `run-task-assign-public-IP` defaults to `DISABLED` (matches private subnets); launch type defaults to `FARGATE`; `run-task-started-by` defaults `GitHub-Actions`; `service` omitted means "Service was not specified, no service updated"; exit code check throws `Run task failed: [...]`. The `run-task-container-overrides` input comes from a repo file, not user input (action warns to keep it trusted). The render action alternative of `aws ecs describe-task-definition > file` is not needed because `task-definition-family` is supported (README line 29). Task-def fields like `taskDefinitionArn`, `registeredAt`, `requiresAttributes` are stripped by the deploy action (list at index.js lines ~14-19).

### Pattern: skip build if the SHA tag already exists (immutable-tag re-run safety)
```bash
if aws ecr describe-images --repository-name "$REPO" --image-ids imageTag="$GITHUB_SHA" >/dev/null 2>&1; then
  echo "Image $GITHUB_SHA already in ECR, skipping build/push"
else
  docker build -t "$REGISTRY/$REPO:$GITHUB_SHA" . && docker push "$REGISTRY/$REPO:$GITHUB_SHA"
fi
```
Needs `ecr:DescribeImages` on the repo. Without it, a `workflow_dispatch` redeploy or "re-run failed jobs" on the same commit fails with `ImageTagAlreadyExistsException` (repo is IMMUTABLE, verified via `describe-repositories`).

### Terraform: `oidc.tf` (skeleton; every value below traced to a source)
```hcl
variable "github_owner"    { type = string  default = "evertonmedola" }
variable "github_owner_id" { type = string  default = "162494392" }   # gh api users/evertonmedola --jq .id
variable "github_repo"     { type = string }                         # name chosen at gh repo create
variable "github_repo_id"  { type = string }                         # gh api repos/OWNER/REPO --jq .id, after creation

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # no thumbprint_list: aws-actions README says "The thumbprint, if specified, will be ignored"
}

data "aws_iam_policy_document" "github_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals { type = "Federated"  identifiers = [aws_iam_openid_connect_provider.github.arn] }
    condition { test = "StringEquals" variable = "token.actions.githubusercontent.com:aud" values = ["sts.amazonaws.com"] }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_owner}@${var.github_owner_id}/${var.github_repo}@${var.github_repo_id}:ref:refs/heads/main"]
    }
  }
}
resource "aws_iam_role" "github_deploy" {
  name               = "financial-control-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_trust.json
  max_session_duration = 3600
}
```
Provider constraint `~> 6.0`, lock file at 6.66.0 (verified in `infra/.terraform.lock.hcl`). `thumbprint_list` being optional for the AWS provider v6 is [ASSUMED] from training; confirm with `terraform validate` (fallback: add the well-known list, AWS ignores it).

### Deploy role policy (D-08), with `<acct>`=796897109626, region `sa-east-1` (from `infra/versions.tf`)
| Sid | Actions | Resource | Why / source |
|-----|---------|----------|--------------|
| EcrAuth | `ecr:GetAuthorizationToken` | `*` | API does not support resource scope |
| EcrPush | `ecr:BatchCheckLayerAvailability`, `InitiateLayerUpload`, `UploadLayerPart`, `CompleteLayerUpload`, `PutImage`, `DescribeImages`, `BatchGetImage` | `arn:aws:ecr:sa-east-1:<acct>:repository/financial-control-api` | push + existence check [ASSUMED: standard ECR push set] |
| TaskDefRegister | `ecs:RegisterTaskDefinition`, `ecs:DescribeTaskDefinition` | `*` | no resource-level support; README "Permissions" lists Register with `"Resource":"*"` |
| PassRoles | `iam:PassRole` | `arn:aws:iam::<acct>:role/financial-control-ecs-execution`, `.../financial-control-ecs-task` + condition `StringEquals iam:PassedToService = ecs-tasks.amazonaws.com` | role names verified in `infra/ecs.tf` |
| Service | `ecs:UpdateService`, `ecs:DescribeServices` | `arn:aws:ecs:sa-east-1:<acct>:service/financial-control/financial-control-api` | README |
| RunMigration | `ecs:RunTask` | `arn:aws:ecs:sa-east-1:<acct>:task-definition/financial-control-api:*` + condition `ArnEquals ecs:cluster = arn:aws:ecs:sa-east-1:<acct>:cluster/financial-control` | README one-off permissions list `RunTask`; scoping by task-def ARN + cluster condition [ASSUMED: verify by first run] |
| WatchMigration | `ecs:DescribeTasks` | `arn:aws:ecs:sa-east-1:<acct>:task/financial-control/*` | |
| MigrationLogs (optional, only to print failure) | `logs:GetLogEvents` | `arn:aws:logs:sa-east-1:<acct>:log-group:/ecs/financial-control-api:log-stream:api/*` | log group and prefix `api` verified in `infra/ecs.tf` |

If `ecs:TagResource` errors appear, it is only when `enable-ecs-managed-tags`/`run-task-tags` are used; do not use them. The Terraform `aws_iam_role_policy` for this is the place to reference `aws_iam_role.execution.arn` / `.task.arn` directly instead of string-building.

### ECS service and ECR (D-09/D-12)
Current `infra/ecs.tf` (read this session, lines ~104-135): the service already has
```
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
```
so only add, inside `aws_ecs_service.api`:
```hcl
  lifecycle { ignore_changes = [task_definition] }
```
and update the stale comment above the resource. ECR lifecycle policy: the repo was created outside Terraform, but `aws_ecr_lifecycle_policy` only needs the repository *name*, so no import is needed:
```hcl
resource "aws_ecr_lifecycle_policy" "api" {
  repository = var.ecr_repository_name   # "financial-control-api"
  policy = jsonencode({ rules = [{
    rulePriority = 1, description = "Keep last 10 images",
    selection = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 },
    action = { type = "expire" } }] })
}
```
This requires the developer policy to allow `ecr:PutLifecyclePolicy`/`GetLifecyclePolicy`/`DeleteLifecyclePolicy`. Note: `terraform destroy` will delete the lifecycle policy (the repo survives); `apply` recreates it. Verified: no lifecycle policy exists now (`get-lifecycle-policy` returned `LifecyclePolicyNotFoundException`).

### Test job specifics
The e2e suite loads `AppModule` (real Postgres, `synchronize: false`, entities via glob), so the CI DB needs the schema: run `npm run migration:run` (ts-node CLI, 7 migrations exist) BEFORE `npm run test:e2e`. Env contract read from `src/config/env.validation.ts` (zod; app refuses to boot otherwise):
`NODE_ENV=test`, `PORT=3000`, `DB_HOST=localhost`, `DB_PORT=5432`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_ACCESS_SECRET` (>= 32 chars, throwaway value in workflow is fine, not a real secret), `JWT_ACCESS_EXPIRES_IN=15m`, `JWT_REFRESH_EXPIRES_IN=7d`, `ALLOWED_ORIGINS=http://localhost:3000`. Do NOT set `PGSSLMODE` (the local/service Postgres has no TLS). Service container:
```yaml
services:
  postgres:
    image: postgres:16
    env: { POSTGRES_USER: ci, POSTGRES_PASSWORD: ci, POSTGRES_DB: financial_control }
    ports: ["5432:5432"]
    options: >-
      --health-cmd "pg_isready -U ci -d financial_control" --health-interval 5s
      --health-timeout 5s --health-retries 10
```
Unit tests (`jest`) need no DB. `package.json` change: add `"lint:check": "eslint \"{src,apps,libs,test}/**/*.ts\""`; leave `lint` (with `--fix`) as is.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Run migration and gate the deploy on exit code | `aws ecs run-task` + `wait tasks-stopped` + `describe-tasks` JMESPath shell | deploy action with `run-task` + `wait-for-task-stopped` | Already implements RunTask failure check, waiter, exit-code throw (index.js `tasksExitCode`) |
| Swap image in task def JSON | `jq` edit of `describe-task-definition` output | render action with `task-definition-family` | Strips/handles fields, supports family lookup |
| Rollback on bad rollout | custom "revert to previous revision" script | ECS circuit breaker (already enabled) | Native, no extra permissions |
| Old-image pruning | scheduled cleanup job | `aws_ecr_lifecycle_policy` | Native |
| AWS auth | static keys in GitHub secrets | OIDC + `configure-aws-credentials` | Locked (INFRA-03) |

## Common Pitfalls

### Pitfall 1: Immutable OIDC `sub` claim breaks the trust policy (HIGH impact)
**What goes wrong:** `AssumeRoleWithWebIdentity` returns "Not authorized" because trust says `repo:owner/repo:ref:refs/heads/main` but a repo created after 2026-07-15 emits `repo:owner@ownerId/repo@repoId:ref:refs/heads/main`. [CITED: configure-aws-credentials README "Immutable subject claims"; github.blog changelog 2026-04-23]
**How to avoid:** Create the repo first, read the repo ID (`gh api repos/<owner>/<repo> --jq .id`), pass it as Terraform var. Verification step: after first failure or before, decode the token with `github/actions-oidc-debugger` only in a private repo (do not use in this public repo), or just confirm the assume step succeeds.
**Warning signs:** "Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity".

### Pitfall 2: Task definition/service do not exist (stack destroyed)
`describe-services` / render `task-definition-family` fail; deploy action throws `Service is INACTIVE`/missing. `ecs_service` status was `INACTIVE` this session. **Avoid:** runbook orders `terraform apply` (approx 15-20 min, empty DB) before the first workflow run; the workflow file should be committed after infra + repo variables exist (or accept a red first run). Also: apply recreates the bootstrap task def with `var.image_tag` (`c0ebba2`, which is still in ECR [VERIFIED: describe-images]); CI then supersedes it.

### Pitfall 3: Immutable tags vs re-runs
Covered above (describe-images guard). Also do not tag `latest`.

### Pitfall 4: Developer IAM user lacks permissions for the new Terraform
`aws iam list-open-id-connect-providers` returned AccessDenied for `medolaFinance` this session; the Phase 8 policy is a scoped customer-managed policy [CITED: infra/README.md line 49]. Needed additions before `apply`: `iam:CreateOpenIDConnectProvider`, `GetOpenIDConnectProvider`, `DeleteOpenIDConnectProvider`, `TagOpenIDConnectProvider`, `ListOpenIDConnectProviders`, `UpdateOpenIDConnectProviderThumbprint` (provider refresh), role permissions on `financial-control-github-deploy` (`CreateRole`, `GetRole`, `DeleteRole`, `UpdateAssumeRolePolicy`, `PutRolePolicy`, `GetRolePolicy`, `DeleteRolePolicy`, `ListRolePolicies`, `ListAttachedRolePolicies`, `ListInstanceProfilesForRole`, `TagRole`, `PassRole` not needed), and `ecr:PutLifecyclePolicy`, `GetLifecyclePolicy`, `DeleteLifecyclePolicy`. Make this a **human checkpoint** task. Also re-check the T-08-03 note: if AdministratorAccess was ever attached, detach it now.

### Pitfall 5: OIDC provider might already exist
Only one provider per URL per account; listing was denied so existence is unknown. If `apply` fails with `EntityAlreadyExists`, run `terraform import aws_iam_openid_connect_provider.github arn:aws:iam::796897109626:oidc-provider/token.actions.githubusercontent.com`. Low probability (fresh personal account), cheap to handle. Do not rely on a `data` source (it errors if absent).

### Pitfall 6: `lint:check` will fail today
Ran ESLint read-only this session: **21 errors** (437 warnings). About half are prettier CRLF artifacts (`␍⏎`, Windows checkout), which vanish with LF line endings; the rest are real (`no-unsafe-return` in 4 DTOs, `no-unsafe-*`/`unbound-method` in specs, some prettier diffs). **Avoid:** add `.gitattributes` (`* text=auto eol=lf`), then a Wave 0 task to make `lint:check` exit 0 (fix, or set those rules to `warn` for `*.spec.ts`/`test/**`) BEFORE the workflow lands. Warnings do not fail ESLint unless `--max-warnings` is set; do not set it.

### Pitfall 7: Circuit-breaker rollback vs workflow status
When ECS auto-rolls back, the action's stability wait may or may not surface it as failure [ASSUMED]. **Avoid:** post-check step: `aws ecs describe-services ... --query 'services[0].deployments[?status==\`PRIMARY\`]|[0].[taskDefinition,rolloutState]'` must equal (new ARN from `steps.deploy.outputs.task-definition-arn`, `COMPLETED`), else `exit 1`. Needs only `ecs:DescribeServices` (already granted).

### Pitfall 8: Migration compatibility window
Migration runs on the new image while old tasks keep serving (D-10 caveat). Forward-only, additive migrations; no auto schema rollback if the app deploy is later rolled back by the circuit breaker.

### Pitfall 9: Public repo hygiene
Verified read-only: `infra/tfplan*` are already git-ignored (`.gitignore:78 tfplan*`) and NOT tracked; no `.env`/`tfstate`/`tfplan` ever added in history (`git log --all --diff-filter=A --name-only` showed only `.env.example`, `infra/secrets.tf`, `src/config/env.validation.ts`); no `AKIA...` key pattern in the working tree. So D-02's "remove from git" is a no-op; the plan should still run a final scan (e.g. `git log -p` grep for `AKIA|BEGIN .*PRIVATE KEY|password`) before `gh repo create --public --push`. Account ID and state bucket name (`financial-control-tfstate-796897109626`) appear in `infra/versions.tf`: acceptable per D-02. `.claude/` planning content: `.gitignore` excludes gsd tooling dirs but `.planning/` and `.claude/CLAUDE.md`/skills are tracked; confirm the user is OK publishing `.planning/` (not a secret, but check for the account/ARN literals).

### Pitfall 10: First push triggers the workflow
`git push` to `main` starts the pipeline immediately. Push code WITHOUT `.github/workflows/deploy.yml` first, then add it as a later commit once the role/vars exist (or use `workflow_dispatch`-only initially).

## Repo variables and setup commands
Repository *variables* (not secrets): `AWS_DEPLOY_ROLE_ARN` (from `terraform output`), `AWS_REGION` = `sa-east-1`. Cluster/service/family/container names are stable literals (`financial-control`, `financial-control-api`, `api`). Set via `gh variable set NAME --body VALUE`. Repo creation: `git branch -M main && gh repo create <name> --public --source . --remote origin --push` (gh 2.100.0, authenticated as `evertonmedola`, https protocol [VERIFIED: gh auth status]). Optionally restrict Actions to the two AWS + GitHub actions is unnecessary.

Workflow skeleton essentials: `on: { push: { branches: [main] }, workflow_dispatch: {} }`; top-level `permissions: contents: read`; `test` job no `id-token`; `deploy` job `permissions: { id-token: write, contents: read }`, `concurrency: { group: deploy, cancel-in-progress: false }`, `timeout-minutes: 30`, `env` from `vars.AWS_REGION`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| gh CLI | repo creation, variables | yes, authenticated as evertonmedola | 2.100.0 | — |
| aws CLI | verification, runbook | yes, creds for `user/medolaFinance`, account 796897109626 | 2.37.0 | — |
| terraform | oidc.tf apply | yes | 1.16.4 (`required_version >= 1.11`) | — |
| docker | local verification only (CI uses runner Docker) | yes | 29.4.1 | — |
| node | local lint/test | yes | 24.11.0 | — |
| AWS infra (ECS service, RDS, ALB) | deploy job | NO - destroyed (service INACTIVE) | — | `terraform apply` first (human, ~15-20 min, costs money) |
| ECR repo | build/push | yes: `financial-control-api`, IMMUTABLE, scanOnPush, 1 image `c0ebba2`, no lifecycle policy | — | — |
| GitHub OIDC provider in account | oidc.tf | unknown (list denied) | — | import on `EntityAlreadyExists` |
| git remote | push | none configured (`git remote -v` empty), branch still `master` | — | D-01 |

**Blocking without human action:** dev IAM policy extension (Pitfall 4); `terraform apply` for infra before first successful deploy.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest (unit) + Jest e2e via `test/jest-e2e.json`, supertest, ts-jest |
| Config file | `package.json` "jest" block; `test/jest-e2e.json` |
| Quick run command | `npm run lint:check && npm test` |
| Full suite command | `npm run migration:run && npm run test:e2e` (needs local Postgres from `docker compose up db`) |

### Phase Requirements to Verification Map
| Req ID | Behavior | Type | Command | Exists? |
|--------|----------|------|---------|---------|
| INFRA-03 | Deploy job assumes role via OIDC, no static keys | integration (real run) | `gh workflow run deploy.yml` then `gh run watch`; `gh secret list` shows no AWS keys | Wave 0: script |
| INFRA-03 | Trust only `main` of this repo | manual/CLI | `aws iam get-role --role-name financial-control-github-deploy --query Role.AssumeRolePolicyDocument` contains immutable sub | Wave 0 |
| INFRA-04 | Migration step precedes service update; bad migration blocks deploy | integration | temporary failing migration on a throwaway commit (or override command `["node","-e","process.exit(1)"]` via workflow_dispatch test) then confirm service task def unchanged | manual checkpoint |
| Success #3 | New SHA running | CLI | `aws ecs describe-services ...` image tag == `git rev-parse HEAD`; `curl ALB/health` 200 | Wave 0 |

Create `infra/scripts/verify-phase9.sh` mirroring `infra/scripts/verify-phase8.sh` (Phase 8 pattern) plus the end-of-phase checklist required by CLAUDE.md.

### Wave 0 Gaps
- [ ] `lint:check` script + make lint pass on Linux (Pitfall 6), `.gitattributes`
- [ ] `infra/scripts/verify-phase9.sh`
- [ ] Extend developer IAM policy (human)

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes (workload identity) | GitHub OIDC to STS short-lived creds; exact `aud` + immutable `sub` |
| V4 Access Control | yes | Least-privilege role (table above), `iam:PassRole` with `PassedToService` condition, separate `test` job without `id-token` |
| V5 Input Validation | limited | Workflow inputs are literals/vars; overrides come from repo file |
| V6 Cryptography | no | Nothing hand-rolled; TLS to AWS APIs by SDK |
| V14 Config/Secrets | yes | No static keys, no secrets in workflow; app secrets stay in Secrets Manager (CI never sees them) |

### Known Threat Patterns
| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Other repo/branch assumes the role | Spoofing/EoP | `StringEquals` on `sub` (immutable form) and `aud`; never `StringLike` with wildcards on the repo part |
| Workflow tampering by fork/PR | Tampering | No `pull_request` trigger (D-03); sub restricted to `refs/heads/main` |
| Compromised action | Tampering | Only first-party GitHub/AWS actions, major-pinned; SHA pinning deferred to hardening |
| Over-broad CI role | EoP | No terraform/IAM-write permissions; RegisterTaskDefinition + PassRole is the known escalation path, bounded by the PassRole resource list and condition |
| Secret in public history | Info disclosure | Pre-push scan (Pitfall 9) |

## State of the Art

| Old | Current | Impact |
|-----|---------|--------|
| Mutable `sub` (`repo:o/r:ref:...`) | Immutable `sub` with owner/repo IDs (new repos since 2026-07-15) | Trust policy must include IDs |
| OIDC thumbprint required | Thumbprint ignored | Omit `thumbprint_list` |
| Node 20 actions | Actions run on `node24` | Current majors only |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Major-tag pinning (`@v6`) is sufficient for this project | Standard Stack | Low; supply-chain hardening deferred |
| A2 | `thumbprint_list` optional in AWS provider ~> 6 (lock 6.66.0) | oidc.tf | Low; `terraform validate` reveals, fallback is adding the list |
| A3 | ECR push action set + `DescribeImages` is complete | Deploy role policy | Low; first run shows AccessDenied with the missing action |
| A4 | `ecs:RunTask` can be scoped to task-def ARN with `ecs:cluster` condition | Deploy role policy | Medium; if denied, widen resource to `*` with cluster condition |
| A5 | ECS rollback may not fail the action's stability wait | Pitfall 7 | Low; post-check handles either way |
| A6 | `describe-services`-derived network config is present in the service response for awsvpc services | Pattern | Low; standard API field `networkConfiguration.awsvpcConfiguration` |

## Open Questions

1. **GitHub repo name** (needed for the trust `sub` and repo ID). Recommendation: decide at plan time (e.g. `financial-control-api`); pass as Terraform vars.
2. **Publishing `.planning/` in a public repo.** Recommendation: confirm with user during the D-02 checkpoint; nothing secret was found, but it exposes account ID/ARNs already present in infra files.
3. **Existing OIDC provider in account.** Unknown (permission denied); handled by import fallback.

## Sources

### Primary (HIGH)
- `aws-actions/configure-aws-credentials` README + action.yml via GitHub API (immutable sub, thumbprint, inputs, node24)
- `aws-actions/amazon-ecs-deploy-task-definition` README, action.yml, `index.js` (run-task flow, exit-code check, optional service)
- `aws-actions/amazon-ecs-render-task-definition` README, action.yml; `amazon-ecr-login` action.yml
- GitHub releases API for the six actions (versions/dates above)
- Repo files read: `infra/ecs.tf`, `infra/variables.tf`, `infra/versions.tf`, `infra/migrate-overrides.json`, `infra/README.md`, `.gitignore`, `package.json`, `src/config/env.validation.ts`, `src/database/data-source.ts`, `Dockerfile`, `.env.example`
- Read-only AWS/gh/eslint probes run this session (ECR repo state, service INACTIVE, IAM AccessDenied, lint errors)

### Secondary / Tertiary
- github.blog changelog 2026-04-23 (immutable subject claims), referenced by the README, not fetched directly (MEDIUM)

## Project Constraints (from CLAUDE.md)
- No static AWS keys in GitHub; OIDC only. Image by immutable git-SHA tag, never `:latest`.
- Secrets via Secrets Manager `valueFrom` (execution role); CI does not handle app secrets.
- TypeORM migrations explicit, `synchronize: false`; RDS private; SG-to-SG.
- Pipeline shape per CLAUDE.md: configure-aws-credentials, ecr-login, build/push, render, deploy.
- Explain each AWS concept during the phase and end with a "what to test" checklist; security-review checklist before calling a feature done; lightweight process preference (final hardening deferred).
- Work through GSD workflow entry points before editing files.

## Metadata
**Confidence:** Standard stack HIGH; Architecture HIGH (action behavior read from source); Pitfalls HIGH except A4/A5.
**Research date:** 2026-09-23. **Valid until:** ~2026-10-23 (action majors move slowly; re-check immutable-sub guidance).
