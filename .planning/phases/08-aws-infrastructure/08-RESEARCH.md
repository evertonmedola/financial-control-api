# Phase 8: AWS Infrastructure - Research

**Researched:** 2026-09-23
**Domain:** Terraform on AWS (VPC, ALB, ECS Fargate, RDS PostgreSQL, Secrets Manager) in sa-east-1
**Confidence:** MEDIUM-HIGH (in-repo facts and migration path empirically verified; a few AWS defaults are [ASSUMED] and flagged)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Provisionar com **Terraform** (nao CloudFormation/CLI/console) - padrao de mercado, `plan/apply/destroy` reprodutivel e auditavel. Reversibility: costly.
- **D-02:** Codigo em `infra/` na raiz do repo da API, **um unico root module** com arquivos por tema (`network.tf`, `alb.tf`, `ecs.tf`, `rds.tf`, `secrets.tf`, etc.). Sem modulos separados - um unico ambiente.
- **D-03:** **State remoto em bucket S3** com locking nativo (`use_lockfile`, sem DynamoDB), versionamento e criptografia ligados, acesso privado. O bucket e criado **uma vez via AWS CLI**, documentado no README, e fica **fora** do `terraform destroy`.
- **D-04:** **2 AZs** (ALB e RDS subnet group exigem no minimo 2), com subnets publicas (ALB, NAT) e privadas (ECS, RDS).
- **D-05:** **1 NAT Gateway** (na AZ a) para a saida das tasks privadas (pull do ECR, Secrets Manager, logs CloudWatch). VPC endpoints descartados por ora. Custo (~US$32/mes) mitigado por `terraform destroy` quando ocioso. Tasks em subnet publica com IP publico foram rejeitadas. Security groups: RDS aceita 5432 **apenas do SG das tasks ECS** (SG-a-SG); tasks aceitam apenas do SG do ALB.
- **D-06:** **HTTP apenas** no ALB nesta fase, DNS padrao `*.elb.amazonaws.com`. Listener 80 e SG preparados para acrescentar o 443 depois. Ate HTTPS existir, nao usar dados financeiros reais na AWS. `ALLOWED_ORIGINS` ajustado conforme necessario.
- **D-07:** RDS **`db.t4g.micro`, Postgres 16, single-AZ, 20 GB gp3, backup automatico de 7 dias, storage criptografado**, `publicly_accessible = false`, `skip_final_snapshot = true` e `deletion_protection = false`. Multi-AZ descartado.
- **D-08:** Senha do banco via **secret gerenciado pelo RDS** (`manage_master_user_password`) - nunca passa pelo Terraform/state. ECS injeta `DB_USER`/`DB_PASSWORD` via `secrets` com `valueFrom` `arn:...:secret:...:username::` / `:password::`; `DB_HOST`, `DB_PORT`, `DB_NAME` como variaveis normais. `secretsmanager:GetSecretValue` na **task execution role**.
- **D-09:** `JWT_ACCESS_SECRET` em **secret separado no Secrets Manager, criado por AWS CLI fora do Terraform** (nunca entra no state); o Terraform apenas referencia o ARN existente (data source). Injetado via `secrets`/`valueFrom`, mesma execution role.
- **D-10:** **Migration inicial via `aws ecs run-task` one-off** com a mesma imagem e comando `migration:run`, dentro da VPC. Mesmo mecanismo que a Fase 9 automatiza. Nunca no boot do container (INFRA-04). Verificar se a imagem de producao inclui o CLI do TypeORM e os arquivos de migration compilados; ajustar a Fase 7 se faltarem.

### Claude's Discretion
Ranges CIDR, nomes/tags dos recursos, regiao (padrao: a do ECR existente), tamanho do task Fargate (comecar conservador, ex. 0.25 vCPU/512 MB), retencao de logs CloudWatch, parametros do target group (intervalo, thresholds) e health check grace period. Imagem por tag imutavel (git SHA/tag existente), nunca `:latest`. Explicar o motivo de cada servico AWS (Cloud Practitioner) e produzir checklist de testes ao final da fase.

### Deferred Ideas (OUT OF SCOPE)
HTTPS (ACM + dominio + Route 53 + listener 443); RDS Multi-AZ; VPC endpoints no lugar do NAT; rotacao automatica de secrets. (CI/CD, OIDC and deploy/migration automation are Phase 9.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-02 | VPC (public/private subnets), RDS PostgreSQL (private), ECS Fargate behind ALB, Secrets Manager for credentials | Whole document; see Architecture, Code Examples, Pitfalls 1-4 |
</phase_requirements>

## Summary

The infrastructure is a standard single-root-module Terraform stack (hashicorp/aws provider 6.66.0, Terraform 1.16.4 already installed) with about 40 resources. The application image already in ECR (`financial-control-api:c0ebba2`) is deployable with **no Phase 7 changes for migrations**: I pulled it from ECR and ran `node node_modules/typeorm/cli.js -d dist/database/data-source.js migration:run` against a throwaway Postgres 16, and all 7 migrations executed successfully.

Three findings change the plan and must be handled explicitly:

1. **BLOCKER (human action): the IAM user `medolaFinance` has almost no permissions.** ECR and STS work, but `ec2:DescribeAvailabilityZones`, `rds:DescribeDBEngineVersions`, `s3:ListAllMyBuckets`, `ecs:ListClusters`, `secretsmanager:ListSecrets`, `logs:DescribeLogGroups` and `iam:ListAttachedUserPolicies` all returned AccessDenied. Terraform cannot run until a human grants permissions (see Environment Availability).
2. **RDS PostgreSQL 15+ enforces SSL by default (`rds.force_ssl` = 1), and the app configures no `ssl` option.** Without a fix the app and the migration task get `no pg_hba.conf entry ... SSL off`. Fix with no code/image change: set env `PGSSLMODE=no-verify` (node-postgres reads it when `ssl` is unset; verified in `node_modules/pg`).
3. **RDS-managed secrets rotate every 7 days by default, but ECS injects secret values only at container start.** After a rotation the running tasks keep the stale password and new DB connections fail until the tasks are restarted. Document it, and include a "force new deployment" step in the checklist; automatic-rotation handling stays deferred.

**Primary recommendation:** One root module in `infra/` with S3 backend (`use_lockfile = true`), 2 AZ VPC + single NAT, ALB (HTTP:80) to ECS Fargate service (2 tasks, 0.25 vCPU / 512 MB, private subnets, `PGSSLMODE=no-verify`, secrets via `valueFrom` json-keys), RDS `db.t4g.micro` Postgres 16 with `manage_master_user_password`, and a one-off `aws ecs run-task` (command override on the same task definition) for migrations.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Public HTTP entry, health-based routing | ALB (public subnets) | - | Only internet-facing component (criterion 1, 3) |
| API runtime | ECS Fargate (private subnets) | - | No public IP; SG accepts only from ALB SG |
| Outbound to ECR/Secrets Manager/Logs | NAT Gateway (public subnet) | - | D-05; tasks have no public IP |
| Persistence | RDS (private subnets) | - | SG accepts 5432 only from task SG |
| DB credentials | Secrets Manager (RDS-managed) | ECS agent injects | D-08; never in Terraform state or image |
| JWT secret | Secrets Manager (CLI-created) | ECS agent injects | D-09; never in state |
| Schema migration | ECS one-off task (in VPC) | - | RDS is private; same image (D-10) |
| Infra state | S3 (CLI-created, outside stack) | - | D-03 |

## Standard Stack

### Core
| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| Terraform | 1.16.4 (installed at `C:\Terraform`) | IaC | [VERIFIED: `terraform version` this session -> "Terraform v1.16.4 on windows_amd64"] |
| hashicorp/aws provider | 6.66.0 (published 2026-09-21) | AWS resources | [VERIFIED: registry.terraform.io/v1/providers/hashicorp/aws -> "Version: 6.66.0", "Published At: 2026-09-21T13:27:58Z"]. Pin `~> 6.0`, commit `.terraform.lock.hcl`. |
| AWS CLI | 2.37.0 | State bucket, JWT secret, run-task | Orchestrator-verified |
| Fargate platform version | `LATEST` = 1.4.0 (Linux) | Runtime | [CITED: docs.aws.amazon.com/AmazonECS/latest/developerguide/platform-fargate.html: "The LATEST Linux platform version is 1.4.0."]. Required >= 1.4.0 for json-key secrets (see ECS secrets doc). |
| RDS PostgreSQL | major `16` (latest minor 16.15 per AWS release notes) | DB | [CITED: docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-versions.html: "Latest Available: PostgreSQL 16.15"]. sa-east-1 availability of 16.15 could NOT be checked (IAM denies `rds:DescribeDBEngineVersions`). Use `engine_version = "16"` (let RDS pick the default minor) and `auto_minor_version_upgrade = true`. |

No npm/PyPI packages are installed this phase; the only third-party artifact is the official `hashicorp/aws` provider (Package Legitimacy Audit: N/A, official HashiCorp provider from the Terraform Registry).

### Alternatives Considered
Not applicable - decisions D-01..D-10 are locked.

**Installation / init (Windows, PowerShell or Git Bash):**
```bash
# Ensure C:\Terraform is on PATH (it was not on the bash PATH by default in this session)
cd infra && terraform init && terraform validate && terraform plan -out tfplan
```

## Architecture Patterns

### System Architecture Diagram

```
Internet
   |  HTTP :80
   v
[ALB  (public subnets a,b)]  <-- SG-alb: in 80 from 0.0.0.0/0
   |  forwards only to healthy targets (GET /health -> 200)
   v  :3000
[ECS Fargate tasks x2 (private subnets a,b)]  <-- SG-task: in 3000 from SG-alb only
   |            |                         \
   | 5432       | 443 via NAT (public a)   \ 443 via NAT
   v            v                           v
[RDS PG16]   [Secrets Manager]           [ECR pull, CloudWatch Logs]
 (private)    - rds!db-... (username,password)   
 SG-rds: in 5432 from SG-task only
              - financial-control/jwt-access-secret (CLI-created)

Migration: human/CI --aws ecs run-task (same task def, command override)--> one-off task in private subnets --> RDS
```

### Recommended Project Structure
```
infra/
├── versions.tf      # terraform{required_version, required_providers, backend "s3"}
├── provider.tf      # region, default_tags
├── variables.tf     # region, image_tag, allowed_origins, desired_count, cidrs
├── network.tf       # VPC, 2 public + 2 private subnets, IGW, EIP, NAT, route tables
├── security.tf      # 3 SGs + aws_vpc_security_group_{ingress,egress}_rule
├── alb.tf           # ALB, target group (ip), listener :80
├── rds.tf           # subnet group, aws_db_instance
├── secrets.tf       # data "aws_secretsmanager_secret" jwt (by name)
├── iam.tf           # execution role (+ inline secrets policy), task role (empty)
├── ecs.tf           # cluster, log group, task definition, service
├── outputs.tf       # alb_dns_name, cluster, service, task def family, private subnet ids, task SG id, rds endpoint
└── README.md        # bootstrap: state bucket, JWT secret, apply, migrate, smoke test, destroy
```
`.gitignore` currently has NO terraform entries [VERIFIED: grep of .gitignore returned nothing]. Add `infra/.terraform/`, `*.tfstate*`, `tfplan`, `*.tfvars` (keep `.terraform.lock.hcl` committed).

### Recommended discretion values (concrete)
| Item | Value | Justification |
|------|-------|---------------|
| Region | `sa-east-1` | Where ECR repo already lives (orchestrator-verified); ECR pulls stay in-region |
| AZs | `sa-east-1a`, `sa-east-1b` | Hard-code as variable default; `data.aws_availability_zones` needs `ec2:DescribeAvailabilityZones` (currently denied). [ASSUMED: sa-east-1a/b exist for this account] - verify at first `plan` |
| VPC CIDR | `10.0.0.0/16` | Standard |
| Public subnets | `10.0.0.0/24` (a), `10.0.1.0/24` (b) | ALB + NAT |
| Private subnets | `10.0.10.0/24` (a), `10.0.11.0/24` (b) | ECS + RDS |
| Task size | cpu 256, memory 512 | CONTEXT says start conservative. [ASSUMED: 0.25 vCPU allows 512/1024/2048 MB] Bump to 1024 MB if `OOMKilled` (exit 137) appears |
| desired_count | 2 (one per AZ) | Makes success criterion 3 demonstrable (one task can be unhealthy while traffic continues); extra cost is small. Make it a variable; 1 is acceptable |
| Log retention | 7 days | Minimal cost; enough for study |
| Target group | protocol HTTP, port 3000, `target_type = "ip"` (required for awsvpc), health check path `/health`, matcher `200`, interval 15, timeout 5, healthy 2, unhealthy 3, `deregistration_delay = 30` | Fast detection (~45s to remove), fast deploys |
| Health check grace period | 60 s (`health_check_grace_period_seconds`) | Nest+TypeORM cold start plus first DB connection; ECS ignores ALB failures during grace |
| Service | `launch_type FARGATE`/`capacity_provider` default, `platform_version = "LATEST"`, `deployment_circuit_breaker { enable = true, rollback = true }`, `wait_for_steady_state = true` | `apply` then fails loudly if tasks never become healthy |
| ALB | `drop_invalid_header_fields = true`, `idle_timeout` default | Cheap hardening |
| RDS | `identifier = financial-control-db`, `db_name = financial_control`, `username = financial_control`, `storage_type = "gp3"`, `allocated_storage = 20`, `storage_encrypted = true`, `backup_retention_period = 7`, `multi_az = false`, `publicly_accessible = false`, `skip_final_snapshot = true`, `deletion_protection = false`, `manage_master_user_password = true`, `auto_minor_version_upgrade = true` | D-07/D-08 |
| Image | `${account}.dkr.ecr.sa-east-1.amazonaws.com/financial-control-api:${var.image_tag}`, default `c0ebba2` | Only tagged image in ECR [VERIFIED: `aws ecr describe-images` -> tag "c0ebba2", pushed 2026-09-23T11:14:15-03:00; the two untagged entries are manifest/attestation layers]. Never `:latest` (repo is IMMUTABLE anyway). |

### Pattern 1: S3 backend with native lock (D-03)
```hcl
# Source: developer.hashicorp.com/terraform/language/backend/s3
terraform {
  required_version = ">= 1.11"
  required_providers { aws = { source = "hashicorp/aws", version = "~> 6.0" } }
  backend "s3" {
    bucket       = "financial-control-tfstate-796897109626" # backend blocks cannot use variables
    key          = "phase-8/terraform.tfstate"
    region       = "sa-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
```
[CITED: HashiCorp S3 backend docs: "If `use_lockfile` is set, `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` are required on the lock file."; "DynamoDB-based locking is deprecated and will be removed in a future minor version."]. The `>= 1.11` floor is [ASSUMED] (version that introduced `use_lockfile`); 1.16.4 is installed so it is safe.

Bucket bootstrap (one-time, outside Terraform; Git Bash / PowerShell compatible, single-line commands):
```bash
aws s3api create-bucket --bucket financial-control-tfstate-796897109626 --region sa-east-1 --create-bucket-configuration LocationConstraint=sa-east-1
aws s3api put-bucket-versioning --bucket financial-control-tfstate-796897109626 --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket financial-control-tfstate-796897109626 --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket financial-control-tfstate-796897109626 --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```
(`LocationConstraint` is mandatory outside us-east-1. In PowerShell the JSON single-quotes work for `aws.exe`; if quoting bites, use `file://` JSON files.) Bucket name is globally unique - suffixing the account id is the convention. [ASSUMED: single-quoted JSON passes intact in PowerShell 5.1; prefer `file://` in the plan.]

### Pattern 2: Secrets injection (D-08/D-09)
RDS-managed secret ARN comes from `aws_db_instance.this.master_user_secret[0].secret_arn` [CITED: registry docs list `master_user_secret` attribute with `secret_arn`]. The secret JSON keys are `username` and `password` [ASSUMED - standard RDS format; not shown on the fetched docs page. Plan MUST include `aws secretsmanager get-secret-value --secret-id <arn> --query SecretString` check (redact output) before first apply of the service, or validate via task startup]. ECS valueFrom syntax [CITED: docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html]: `arn:aws:secretsmanager:{{region}}:{{aws_account_id}}:secret:{{secret-name}}:{{json-key}}:{{version-stage}}:{{version-id}}` - optional parts may be empty but colons are required, e.g. `...:secret:appauthexample-AbCdEf:username1::`.

```hcl
# ecs.tf (excerpt) - Source: ECS secrets doc above
secrets = [
  { name = "DB_USER",           valueFrom = "${aws_db_instance.this.master_user_secret[0].secret_arn}:username::" },
  { name = "DB_PASSWORD",       valueFrom = "${aws_db_instance.this.master_user_secret[0].secret_arn}:password::" },
  { name = "JWT_ACCESS_SECRET", valueFrom = data.aws_secretsmanager_secret.jwt.arn },  # whole-secret plain string, no json-key
]
environment = [
  { name = "NODE_ENV",               value = "production" },
  { name = "PORT",                   value = "3000" },
  { name = "DB_HOST",                value = aws_db_instance.this.address },
  { name = "DB_PORT",                value = "5432" },
  { name = "DB_NAME",                value = "financial_control" },
  { name = "PGSSLMODE",              value = "no-verify" },   # see Pitfall 1
  { name = "JWT_ACCESS_EXPIRES_IN",  value = "15m" },
  { name = "JWT_REFRESH_EXPIRES_IN", value = "7d" },
  { name = "ALLOWED_ORIGINS",        value = var.allowed_origins },  # default "http://localhost:3000"
]
```
Env vars required by the app, quoted from `src/config/env.validation.ts` (read this session): `NODE_ENV` enum `['development', 'test', 'production']`, `PORT`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_ACCESS_SECRET: z.string().min(32)`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `ALLOWED_ORIGINS`. No `JWT_REFRESH_SECRET` exists. All are covered above [VERIFIED: src/config/env.validation.ts:14-32].

JWT secret creation (CLI, outside Terraform; never echo value). Generate without the shell touching it in logs, e.g. PowerShell: `$s = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | % {[char]$_}); aws secretsmanager create-secret --name financial-control/jwt-access-secret --secret-string $s --region sa-east-1 --query ARN --output text`. Git Bash equivalent: `aws secretsmanager create-secret --name financial-control/jwt-access-secret --secret-string "$(openssl rand -base64 48 | tr -d '\n')" ...` [ASSUMED openssl present in Git Bash; it ships with Git for Windows]. Value must be >= 32 chars (zod). Terraform references it with `data "aws_secretsmanager_secret" "jwt" { name = "financial-control/jwt-access-secret" }` (the data source reads metadata/ARN only, not the value, so nothing enters state; requires `secretsmanager:DescribeSecret`). The random 6-char ARN suffix is why the ARN must be looked up, not constructed.

IAM: execution role = `AmazonECSTaskExecutionRole` managed policy (`arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy`: ECR pull + CloudWatch Logs) plus an inline policy `secretsmanager:GetSecretValue` on exactly the two secret ARNs (least privilege). Task role: create an empty role (app makes no AWS calls). Both trust `ecs-tasks.amazonaws.com`. [CITED: ECS doc: "Your task definition must use a task execution role with the additional permissions for Secrets Manager."] The RDS-managed secret is encrypted with the default `aws/secretsmanager` key; [ASSUMED] no extra `kms:Decrypt` is needed for the default key (only if a customer-managed key were used - not our case).

### Pattern 3: Migration one-off (D-10)
Same task definition, command override; no ENTRYPOINT in the image (only `CMD ["node", "dist/main"]` [VERIFIED: Dockerfile:68]) so the override replaces CMD cleanly.
```bash
# overrides.json (file avoids PowerShell/Git-Bash quoting problems)
{"containerOverrides":[{"name":"api","command":["node","node_modules/typeorm/cli.js","-d","dist/database/data-source.js","migration:run"]}]}

aws ecs run-task --region sa-east-1 --cluster financial-control --launch-type FARGATE \
  --task-definition financial-control-api \
  --network-configuration "awsvpcConfiguration={subnets=[<private-a>],securityGroups=[<task-sg>],assignPublicIp=DISABLED}" \
  --overrides file://overrides.json
```
Then poll `aws ecs describe-tasks ... --query "tasks[0].containers[0].exitCode"` and read logs (`aws logs tail /ecs/financial-control-api --since 10m`; on Git Bash prefix `MSYS_NO_PATHCONV=1` or the leading `/` is rewritten to a Windows path). Expose subnet/SG/cluster/family as Terraform outputs so the command is copy-paste. The container `name` in the task definition (`api`) MUST match `containerOverrides.name`. Migrate first, then the API works; note /health goes green even before migrations (it only runs a ping check), so migrate before smoke-testing endpoints.

### Anti-Patterns to Avoid
- `assign_public_ip = true` or tasks in public subnets (violates criterion 1; rejected in D-05).
- Inline `ingress {}` blocks inside `aws_security_group` mixed with SG-to-SG rules (cycles, drift): use `aws_vpc_security_group_ingress_rule` / `_egress_rule` with `referenced_security_group_id` [ASSUMED best practice for provider 5+/6].
- Putting DB password in `environment` or in Terraform variables (D-08).
- `synchronize: true` or migrating at boot (INFRA-04; app already `synchronize: false`).
- `desired_count` with no `wait_for_steady_state` (apply "succeeds" while tasks crash-loop).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DB password generation/storage | `random_password` + `aws_secretsmanager_secret_version` | `manage_master_user_password = true` | Password never in state (D-08) |
| Execution role permissions | Custom ECR/logs policy | `AmazonECSTaskExecutionRolePolicy` | Maintained by AWS |
| TF state locking | DynamoDB table | `use_lockfile = true` | DynamoDB locking deprecated |
| Health routing | Custom watchdog | ALB target group health checks + ECS service `health_check_grace_period_seconds` | Native removal from rotation (criterion 3) |
| Migration runner | Custom script/SSH bastion | `aws ecs run-task` + TypeORM CLI already in image | Proven below |

## D-10 Finding: does the production image include TypeORM CLI + compiled migrations?

**Yes. No Phase 7 change required. Evidence (gathered this session):**
- `package.json:21-23` `"typeorm": "ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js -d src/database/data-source.ts"`, `"migration:run": "npm run typeorm -- migration:run"` - **the npm script itself cannot work in the image**: it needs `ts-node` and `src/`, and the Dockerfile runs `RUN rm -rf node_modules/typescript node_modules/ts-node` (Dockerfile:39) and copies only `dist`, `node_modules`, `package.json` (Dockerfile:49-51). `npm run migration:run` would fail. [VERIFIED: package.json, Dockerfile]
- `typeorm@^1.1.1` is a production dependency (package.json `"typeorm": "^1.1.1"` under `dependencies`), so `node_modules/typeorm/cli.js` (plain JS) ships. `dotenv` (used by data-source) is also a prod dependency.
- `dist/database/data-source.js` and `dist/database/migrations/*.js` (7 migrations: InitUsers, CreateRefreshTokens, AddRefreshTokensUserFk, CreateAccounts, CreateCategories, CreateTransactions, CreateBudgets) exist in `dist/`. `data-source.ts` uses `migrations: [__dirname + '/migrations/*{.ts,.js}']` and `entities: [__dirname + '/../**/*.entity{.ts,.js}']`, which resolve to compiled `.js` files under `dist/`, and reads `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` from `process.env` [VERIFIED: src/database/data-source.ts read in full].
- **Empirical test:** pulled `796897109626.dkr.ecr.sa-east-1.amazonaws.com/financial-control-api:c0ebba2`, ran on a docker network next to a throwaway `postgres:16` with `DB_*` env: `node node_modules/typeorm/cli.js -d dist/database/data-source.js migration:run` -> "Migration CreateBudgets1789600000000 has been executed successfully." (all 7 applied, COMMIT). `ls dist/database node_modules/typeorm/cli.js` inside the image listed both.
- **Correct command for the plan:** `node node_modules/typeorm/cli.js -d dist/database/data-source.js migration:run` (JSON array form for `--overrides`). Phase 9 reuses it verbatim.
- Side observation (not Phase 8 scope): `docker build .` on the current dirty working tree failed at `RUN npm ci` (`package-lock.json` has uncommitted modifications per git status). Phase 8 uses the existing ECR image so this does not block, but a new image (e.g. for Phase 9 CI) will require resolving the lockfile first. [VERIFIED: local build error; root cause not investigated]

## Common Pitfalls

### Pitfall 1: RDS forces SSL; the app connects without SSL
**What goes wrong:** Tasks crash at boot / `/health` fails / migration errors with `no pg_hba.conf entry for host ..., SSL off`.
**Why:** [CITED: docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html: "The `rds.force_ssl` parameter default value is 1 (on) for RDS for PostgreSQL version 15 and later."] The app's TypeORM config (`src/app.module.ts:36-50`) and `data-source.ts` set no `ssl` option (grep for `ssl` in `src/` found nothing) [VERIFIED].
**How to avoid (no image change):** Env `PGSSLMODE=no-verify` on both the service container and the migration run (same task definition, so automatic). node-postgres `readSSLConfigFromEnvironment()` maps `no-verify` to `{ rejectUnauthorized: false }` and is used when `config.ssl` is undefined [VERIFIED: node_modules/pg/lib/connection-parameters.js:25-38 and :85 `this.ssl = typeof config.ssl === 'undefined' ? readSSLConfigFromEnvironment() : config.ssl`; TypeORM passes `ssl: credentials.ssl`, undefined here (PostgresDriver.js:1377)]. Traffic is encrypted; the server cert is not verified (acceptable inside the VPC for this phase; note `verify-full` with the RDS CA bundle baked into the image as a hardening-phase item). Do NOT use `PGSSLMODE=require`: pg maps it to `true` (full verification) and the RDS CA is not in Node's trust store, which fails with a self-signed-chain error. Do NOT disable `rds.force_ssl` in a parameter group (weakens security posture).
**Warning signs:** Task stops within seconds; CloudWatch shows the pg_hba error. First proof is the migration task (run it before/at first smoke). [Not empirically tested against real RDS - MEDIUM confidence; the migration task is the test.]

### Pitfall 2: IAM user lacks permissions for Terraform
**What goes wrong:** `terraform plan` fails with AccessDenied on the first data source/resource.
**Evidence:** AccessDenied on ec2, rds, s3, ecs, secretsmanager, logs, iam reads for `medolaFinance`; only ECR + STS succeeded [VERIFIED: CLI outputs this session].
**How to avoid:** First plan task is a `checkpoint:human-action`: grant the deploy identity permissions covering ec2 (VPC/SG/EIP/NAT), elasticloadbalancing, ecs, rds (incl. `kms:DescribeKey`, `secretsmanager:CreateSecret/TagResource` - RDS-managed secret needs these [CITED: RDS Secrets Manager doc]), iam (create roles/policies, `iam:PassRole`, `iam:CreateServiceLinkedRole` for ECS/ELB/RDS on first use), logs, secretsmanager, s3 on the state bucket. For a personal learning account the pragmatic option is attaching `AdministratorAccess` temporarily; the more instructive option is a scoped customer-managed policy. Phase 9 replaces this with OIDC role anyway. Ask the human which; do not attempt to change IAM from the executor.

### Pitfall 3: Rotated RDS secret vs. env-injected password
**What goes wrong:** ~7 days after creation the master password rotates; running tasks keep the old value; new pool connections fail (`password authentication failed`).
**Why:** [CITED: RDS doc: "RDS manages the settings for the secret and rotates the secret every seven days by default."] and [CITED: ECS doc: "If the secret is subsequently updated or rotated, the container will not receive the updated value automatically. You must either launch a new task or ... Force new deployment."]
**How to avoid:** Document in README/checklist: `aws ecs update-service --cluster financial-control --service financial-control-api --force-new-deployment`. Since the stack is destroyed when idle this rarely bites; automatic handling remains deferred (CONTEXT: rotation deferred).

### Pitfall 4: ECS ignores the Dockerfile HEALTHCHECK; target group is the criterion-3 mechanism
The image's `HEALTHCHECK` is a Docker feature; ECS uses the task-definition `healthCheck` [ASSUMED from training; consistent with ECS design]. Criterion 3 is satisfied by the ALB target-group health check (`/health`, matcher 200). Optionally also add a container `healthCheck` reusing the same node one-liner with `startPeriod = 30` so ECS itself replaces a wedged container; keep it optional (not required by success criteria). `/health` is `@SkipThrottle()` and unauthenticated [VERIFIED: src/health/health.controller.ts] so it will not 429 or 401 the ALB.

### Pitfall 5: Client IP / throttling behind the ALB
`src/` has no `trust proxy` setting [VERIFIED: grep count 0]. Behind an ALB, `req.ip` will be the ALB's private IP, so `@nestjs/throttler` buckets clients together (login/register rate limits apply globally per ALB node). Harmless for solo use; record as a hardening-phase item (set `app.set('trust proxy', ...)`), do not change app code in Phase 8.

### Pitfall 6: First-apply ordering and destroy behavior
- The ECS service is created before migrations run; it will still go healthy (health check is DB ping only). With `wait_for_steady_state = true` this is fine. RDS creation takes ~5-10 min; service depends on it via references.
- `terraform destroy`: RDS `skip_final_snapshot = true` + `deletion_protection = false` are required (D-07). The RDS-managed secret is deleted with the instance. The JWT secret and state bucket are outside the stack and survive; Secrets Manager deletion has a recovery window, so re-creating a secret with the same name right after deleting it fails - do not delete the JWT secret casually. Destroying NAT/EIP: order handled by Terraform (`depends_on = [aws_internet_gateway.this]` for the NAT).
- ALB-to-target-group listener needs `depends_on`/references so the service is created after the listener (`depends_on = [aws_lb_listener.http]` on the service) - avoids the "target group does not have an associated load balancer" error.

### Pitfall 7: Windows shell quoting/path conversion
Git Bash rewrites leading-`/` arguments (e.g. `/ecs/financial-control-api`) into `C:/Program Files/Git/...`. Use `MSYS_NO_PATHCONV=1` or run in PowerShell. Pass JSON via `file://` files, not inline. Terraform is at `C:\Terraform` and was not on the default bash PATH in this session; the plan should add a "terraform on PATH" check.

## Code Examples

### ECS task definition skeleton (provider 6.x)
```hcl
resource "aws_ecs_task_definition" "api" {
  family                   = "financial-control-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform { operating_system_family = "LINUX", cpu_architecture = "X86_64" }
  container_definitions = jsonencode([{
    name         = "api"
    image        = "${data.aws_caller_identity.me.account_id}.dkr.ecr.${var.region}.amazonaws.com/financial-control-api:${var.image_tag}"
    essential    = true
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    environment  = local.environment   # see Pattern 2
    secrets      = local.secrets
    logConfiguration = { logDriver = "awslogs", options = {
      "awslogs-group" = aws_cloudwatch_log_group.api.name, "awslogs-region" = var.region, "awslogs-stream-prefix" = "api" } }
  }])
}
```
CPU architecture: the ECR image is `amd64` unless built on Apple/ARM; the image was built on Windows/Docker Desktop so X86_64 [ASSUMED - verify with `docker image inspect ... --format '{{.Architecture}}'`; a mismatch yields `exec format error` at start]. Similarly the DB class `db.t4g.micro` is Graviton (ARM) but that is independent of the task arch.

### Target group + listener
```hcl
resource "aws_lb_target_group" "api" {
  name = "fc-api-tg"; port = 3000; protocol = "HTTP"; vpc_id = aws_vpc.this.id; target_type = "ip"
  deregistration_delay = 30
  health_check { path = "/health"; matcher = "200"; interval = 15; timeout = 5; healthy_threshold = 2; unhealthy_threshold = 3 }
}
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn; port = 80; protocol = "HTTP"
  default_action { type = "forward"; target_group_arn = aws_lb_target_group.api.arn }
}
```
Terraform blocks are multi-line in real code; compressed here for brevity. Security-group rules (all via `aws_vpc_security_group_*_rule`): alb in 80 from `0.0.0.0/0`, alb egress 3000 to task SG; task in 3000 from alb SG, task egress 443 to `0.0.0.0/0` (ECR, Secrets Manager, Logs via NAT) and 5432 to rds SG; rds in 5432 from task SG only. Listener SG stays ready for 443 (D-06).

## State of the Art

| Old | Current | Impact |
|-----|---------|--------|
| DynamoDB state lock | S3 `use_lockfile` | DynamoDB locking deprecated (HashiCorp docs) |
| Inline SG rules | `aws_vpc_security_group_*_rule` resources | Cleaner SG-to-SG refs |
| Random password in state | RDS-managed master secret | Password never in TF state |

## Runtime State Inventory
Not a rename/refactor phase - greenfield infra. Pre-existing runtime state: ECR repo `financial-control-api` (kept outside Terraform; referenced by URL string, not managed). None else found: IAM user cannot list S3/ECS/Secrets, so absence of prior buckets/secrets/clusters is unverified.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | RDS-managed secret JSON keys are `username` and `password` | Pattern 2 | Tasks fail to start (ResourceInitializationError); plan includes a get-secret-value check |
| A2 | sa-east-1a/1b exist in this account; PG16 minor selected by `engine_version = "16"` is available | Discretion table | Plan fails at apply; adjust AZ / version |
| A3 | Default `aws/secretsmanager` KMS key needs no extra execution-role KMS permission | Pattern 2 | Task start fails with KMS AccessDenied; add `kms:Decrypt` |
| A4 | ECR image is linux/amd64 | Code Examples | `exec format error`; switch `cpu_architecture` to ARM64 |
| A5 | `PGSSLMODE=no-verify` is accepted by RDS (encrypted, unverified) | Pitfall 1 | Migration task is the first test; fallback is baking RDS CA + `verify-full` (image change) |
| A6 | `use_lockfile` introduced in Terraform 1.11 | Pattern 1 | None (1.16.4 installed) |
| A7 | 0.25 vCPU permits 512 MB | Discretion table | Task registration error; use 1024 |
| A8 | ECS ignores Dockerfile HEALTHCHECK | Pitfall 4 | Only affects optional container healthCheck |
| A9 | PowerShell 5.1 passes single-quoted JSON args to aws.exe intact | Pattern 1 | Use `file://` (recommended anyway) |

## Open Questions

1. **Which IAM permissions will the human grant?** (Admin temporary vs scoped policy.) Gate the whole phase on it; plan a first checkpoint that verifies with `aws ec2 describe-availability_zones`-style reads.
2. **`ALLOWED_ORIGINS` value.** No browser client exists; recommended default `http://localhost:3000`. Only matters for future browser use.
3. **Terraform vs Phase 9 ownership of the task definition.** When CI registers new revisions, Terraform will see drift. Recommended: add `lifecycle { ignore_changes = [task_definition] }` on the service in Phase 9, not now.
4. **Two tasks vs one.** Recommended 2; variable-driven.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Terraform | IaC | yes (`C:\Terraform`, not on default Git Bash PATH) | 1.16.4 | - |
| AWS CLI | bootstrap, run-task | yes | 2.37.0 | - |
| Docker Desktop | optional local image checks | yes | 29.4.1 | - |
| AWS credentials | everything | yes (user `medolaFinance`, acct 796897109626, sa-east-1) | - | - |
| **IAM permissions for EC2/ELB/ECS/RDS/IAM/Logs/S3/SecretsManager** | Terraform | **NO** (AccessDenied observed) | - | **None - blocking; human must grant** |
| ECR image | task definition | yes, tag `c0ebba2` (immutable repo) | - | - |
| openssl (Git Bash) / PowerShell | JWT secret generation | expected yes | - | PowerShell snippet |

**Missing with no fallback:** IAM permissions (see Pitfall 2).

## Validation Architecture
Skipped: `workflow.nyquist_validation` is `false` in `.planning/config.json` [VERIFIED]. Verification for this phase is a manual CLI checklist (produced at end of phase per PROJECT.md), suggested content:
- `terraform validate` and `terraform plan` clean; `aws elbv2 describe-target-health` shows targets `healthy`.
- `curl http://<alb_dns>/health` returns 200 with `{"status":"ok",...}`; try direct access to a task private IP / RDS endpoint from the internet: must fail (no public IP; `aws rds describe-db-instances --query 'DBInstances[0].PubliclyAccessible'` = false).
- Secrets: `aws ecs describe-task-definition` shows `secrets` with `valueFrom` ARNs and no DB password/JWT in `environment`; `docker history`/`docker inspect` of the image shows none.
- Migration task exit code 0; register + login work against the ALB DNS.
- Criterion 3: stop/break one task (e.g. `aws ecs stop-task`, or temporarily point health path wrong on a scratch TG) and observe target `unhealthy/draining` while the ALB keeps answering via the other task.
- `terraform destroy` succeeds; state bucket and JWT secret remain.

## Security Domain
`security_enforcement` enabled (ASVS level 1, per config). Applicable controls:

| ASVS area | Applies | Control |
|-----------|---------|---------|
| V2/V3 auth/session | no (app-level, done Phase 1) | - |
| V4 access control (network/IAM) | yes | SG-to-SG rules; least-privilege execution role limited to two secret ARNs; empty task role |
| V5 input validation | no | - |
| V6 cryptography / secrets | yes | Secrets Manager `valueFrom`; RDS `storage_encrypted`; TLS to RDS (force_ssl); S3 state encrypted+versioned+private |
| V9 communications | partial | HTTP-only ALB is a known accepted gap (D-06); no real financial data until HTTPS |

| Threat | Mitigation |
|--------|------------|
| DB/tasks reachable from internet | Private subnets, `publicly_accessible=false`, no public IPs, SG-referenced rules |
| Secrets in state/logs/image | RDS-managed secret; JWT created by CLI + data source (metadata only); never pass secret values as CLI args that get logged in CI; task `environment` excludes them |
| Overbroad state bucket access | Block public access, versioning, encryption |
| Cleartext credentials over HTTP | Deferred (D-06), documented restriction |
| Unverified DB TLS cert | `no-verify` accepted for now; hardening-phase item |
| Stale rotated secret | Force new deployment (Pitfall 3) |

## Sources

### Primary (HIGH)
- Local evidence this session: `Dockerfile`, `package.json`, `src/database/data-source.ts`, `src/app.module.ts`, `src/config/env.validation.ts`, `src/health/health.controller.ts`, `node_modules/pg/lib/connection-parameters.js`, `terraform version`, `aws ecr describe-images`, and the empirical `migration:run` in the ECR image.
- registry.terraform.io/v1/providers/hashicorp/aws (version 6.66.0).
- docs.aws.amazon.com: ECS secrets doc (secrets-envvar-secrets-manager), Fargate platform versions, RDS PostgreSQL SSL, RDS Secrets Manager integration, RDS PostgreSQL release notes.
- developer.hashicorp.com/terraform/language/backend/s3.

### Secondary/Tertiary
- Terraform registry `aws_db_instance` page (only argument names retrieved, not descriptions) - MEDIUM.
- Training knowledge for items in the Assumptions Log - LOW.

## Metadata
**Confidence:** Stack HIGH; migration-in-image HIGH (executed); architecture MEDIUM-HIGH (standard pattern, not yet applied); SSL workaround MEDIUM (source-verified, not tested against RDS); IAM blocker HIGH.
**Research date:** 2026-09-23. **Valid until:** ~2026-10-23 (provider releases weekly; pin and lock).
