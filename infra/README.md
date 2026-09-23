# Infrastructure runbook (Phase 8)

Terraform for the Controle Financeiro API on AWS (region `sa-east-1`, account `796897109626`).
All commands are the ones proven while building Phase 8 (plans 08-01 to 08-03). No secret value appears here, only names, ARN patterns and commands.

**HTTP only. Use throwaway data only. No real financial data until HTTPS exists (D-06).**

**Current status: the stack is DESTROYED (cost control, end of Phase 8).** All billable resources (NAT gateway, ALB, RDS, ECS service, Elastic IP) are gone. The destroy is fully complete: the first run stopped on the two free IAM roles (`financial-control-ecs-execution`, `financial-control-ecs-task`) because `iam:ListInstanceProfilesForRole` was missing on the developer policy; after that permission was granted, a second `terraform destroy` removed them (2 resources destroyed) and the Terraform state is now empty. Re-creating the stack is `apply` (about 15-20 minutes) and gives an EMPTY database, so run the migration again. The state bucket, the JWT secret and the ECR repository still exist.

## Architecture and why each AWS service

```
Internet
   |  HTTP :80
   v
ALB  financial-control-alb           (public subnets, 2 AZs)
   |  HTTP :3000 (SG-to-SG only)
   v
ECS Fargate tasks  financial-control-api   (private subnets, no public IP)
   |  PostgreSQL :5432 over TLS (SG-to-SG only)        |  outbound only
   v                                                   v
RDS PostgreSQL 16  financial-control-db          NAT gateway -> Internet
(private subnets, not publicly accessible)       (ECR pull, Secrets Manager)
```

| Service | What it is | Why this project uses it | Cloud Practitioner concept |
|---|---|---|---|
| VPC | Isolated virtual network (10.0.0.0/16) | Everything lives in one private network we control | Global infrastructure, network isolation |
| Public/private subnets and route tables | Subnet slices per Availability Zone; routes decide reachability | Public: ALB and NAT. Private: tasks and RDS, no route from the internet | High availability across AZs, defense in depth |
| Internet gateway | Door between the VPC and the internet | Lets the ALB receive traffic | Networking basics |
| NAT gateway | Outbound-only internet for private subnets | Tasks pull the image and read secrets without being reachable | Pay-as-you-go (hourly cost) |
| Security groups | Stateful virtual firewalls | ALB SG (80 from internet), task SG (3000 from ALB SG), RDS SG (5432 from task SG) | Shared responsibility, least privilege |
| ALB | Layer-7 load balancer with health checks | Single entry point, routes only to healthy targets (`/health`) | Elasticity, high availability |
| ECS Fargate | Serverless container runtime | Runs the NestJS container with no servers to patch | Managed services, shared responsibility |
| ECR | Private container registry (`financial-control-api`) | Stores the immutable-tag image | Managed services |
| RDS PostgreSQL | Managed relational database (`financial-control-db`) | Backups, patching and encryption at rest handled by AWS | Managed services, shared responsibility |
| Secrets Manager | Encrypted secret store | RDS-managed master secret and `financial-control/jwt-access-secret`, injected at container start | Security, no secrets in code |
| IAM execution role vs task role | Execution role: what ECS uses to pull the image, write logs, fetch secrets. Task role: what the app itself may call in AWS (nothing needed) | Separation of duties | Least privilege |
| CloudWatch Logs | Log storage (`/ecs/financial-control-api`) | Container stdout/stderr, migration output | Monitoring |
| S3 remote state | Bucket `financial-control-tfstate-796897109626` (versioned, encrypted, public access blocked) | Terraform state with native lockfile | Durability, storage classes |

## Prerequisites

- AWS CLI authenticated to account 796897109626, region `sa-east-1`.
- Terraform 1.11 or newer at `C:\Terraform`, NOT on the default Git Bash PATH. Prefix every session with:
  `export PATH="$PATH:/c/Terraform"` and use `terraform -chdir=infra ...`.
- Git Bash rewrites arguments starting with `/`; set `MSYS_NO_PATHCONV=1` when passing such arguments (log groups, paths).
- On Windows the AWS CLI may fail with a `charmap` codec error; use `export PYTHONIOENCODING=utf-8 PYTHONUTF8=1` (already set inside `verify-phase8.sh`).
- IAM: the grant used in this phase was a scoped customer-managed policy (IAM "Option B") plus `s3:ListAllMyBuckets` on `*`, not `AdministratorAccess`. If you hit AccessDenied, add the named action. If `AdministratorAccess` is ever attached to `medolaFinance` for convenience, it must be detached once Phase 9's OIDC role for CI exists (T-08-03).

## One-time bootstrap (outside Terraform)

These live outside Terraform on purpose (D-03, D-09), so `terraform destroy` never removes them.

```bash
export MSYS_NO_PATHCONV=1
# State bucket (versioning, encryption, public access block)
aws s3api create-bucket --bucket financial-control-tfstate-796897109626 --region sa-east-1 \
  --create-bucket-configuration LocationConstraint=sa-east-1
aws s3api put-bucket-versioning --bucket financial-control-tfstate-796897109626 \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket financial-control-tfstate-796897109626 \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket financial-control-tfstate-796897109626 \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# JWT secret: generated by AWS, value never printed or written to a file
aws secretsmanager create-secret --region sa-east-1 --name financial-control/jwt-access-secret \
  --secret-string "$(aws secretsmanager get-random-password --region sa-east-1 --password-length 64 \
  --exclude-punctuation --query RandomPassword --output text)" --query ARN --output text
```

Warning: never delete the state bucket while resources exist. A deleted secret keeps its name reserved during the Secrets Manager recovery window, so it cannot be recreated under the same name until that window ends (or it is force-deleted).

## Deploy

```bash
export PATH="$PATH:/c/Terraform"
terraform -chdir=infra init
terraform -chdir=infra plan -out=tfplan
terraform -chdir=infra apply tfplan
```

Expected duration is about 15-20 minutes; RDS creation is the slow part. To roll a new image use an immutable tag only (never `latest`):
`terraform -chdir=infra plan -out=tfplan -var image_tag=<git-sha>`.

Failure map:
- `ResourceInitializationError ... secret ... json key` in a stopped task: the `valueFrom` suffix (`:username::` / `:password::`) does not match the secret JSON.
- `exec format error`: image architecture does not match the task `cpu_architecture` (image is linux/amd64, task is X86_64).
- `no pg_hba.conf entry ... SSL off`: the app connected without TLS; the task sets `PGSSLMODE=no-verify`.

## Run the initial migration

A fresh RDS instance is empty. The production image has no dev tooling, so `npm run migration:run` cannot be used; the migration runs as a one-off ECS task using the same task definition (D-10; Phase 9 automates this exact mechanism, INFRA-04).

```bash
export PATH="$PATH:/c/Terraform" PYTHONIOENCODING=utf-8 PYTHONUTF8=1
SUBNETS=$(terraform -chdir=infra output -json private_subnet_ids | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).join(',')))")
SG=$(terraform -chdir=infra output -raw task_security_group_id)
aws ecs run-task --region sa-east-1 --cluster financial-control --launch-type FARGATE \
  --task-definition financial-control-api \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=DISABLED}" \
  --overrides file://infra/migrate-overrides.json --query 'tasks[0].taskArn' --output text
```

Wait for it to stop, then read the exit code and the log stream (`api/api/TASK_ID` in `/ecs/financial-control-api`):

```bash
aws ecs wait tasks-stopped --region sa-east-1 --cluster financial-control --tasks <TASK_ARN>
aws ecs describe-tasks --region sa-east-1 --cluster financial-control --tasks <TASK_ARN> \
  --query 'tasks[0].containers[0].exitCode' --output text
MSYS_NO_PATHCONV=1 aws logs get-log-events --region sa-east-1 --log-group-name /ecs/financial-control-api \
  --log-stream-name api/api/<TASK_ID> --query 'events[].message' --output text
```

Exit code 0 and seven "has been executed" lines (InitUsers ... CreateBudgets) mean success.

## Smoke test and verification

```bash
ALB=$(terraform -chdir=infra output -raw alb_dns_name)
curl -s http://$ALB/health        # 200, database status up
```

Then register, log in and call `/auth/me` with a throwaway generated identity (never real data). The automated proof of all Phase 8 criteria on the live stack:

```bash
bash infra/scripts/verify-phase8.sh                 # prints SC1_OK SC2_OK TF_CLEAN SC3_OK PHASE8_VERIFIED
SKIP_STOP_TASK=1 bash infra/scripts/verify-phase8.sh  # skips the disruptive stop-one-task step
```

**HTTP only: use throwaway data only. No real financial data until HTTPS exists.**

## Secret rotation

RDS rotates its managed master secret about every 7 days. ECS injects secret values only at container start, so running tasks keep the stale password and new database connections fail after a rotation until you redeploy:

```bash
aws ecs update-service --region sa-east-1 --cluster financial-control --service financial-control-api --force-new-deployment
```

Automatic handling is deferred (RESEARCH Pitfall 3).

## Cost and destroy

The NAT gateway (about US$32/month per CONTEXT.md, likely higher in sa-east-1 [ASSUMED]), the ALB, RDS and Fargate all bill by the hour whether or not anyone uses them. Run this whenever the stack is idle (D-05, D-07):

```bash
export PATH="$PATH:/c/Terraform"
terraform -chdir=infra destroy
```

RDS is configured with `skip_final_snapshot` and no deletion protection, and the ALB has no deletion protection, so neither blocks a destroy. Destroying the two IAM roles (`financial-control-ecs-execution`, `financial-control-ecs-task`) needs one extra permission on the developer policy: `iam:ListInstanceProfilesForRole`. Without it, `terraform destroy` removes everything else and then fails on those two free roles, which is what happened at the end of Phase 8. That permission has since been granted and the second destroy finished cleanly (2 resources destroyed). Keep it on the policy (or on its replacement) so a full destroy works in one run.

Survives a destroy (created outside Terraform): the S3 state bucket, the JWT secret, and the ECR repository. The next `apply` creates an EMPTY database, so run the migration again. Never delete the state bucket while resources exist.

Readiness can be proven without destroying: `terraform -chdir=infra plan -destroy -input=false` reports `0 to add, 0 to change, N to destroy`.

## Known limitations and hardening backlog

- HTTP only (D-06). Later: ACM certificate, a domain, Route 53, HTTPS listener on 443 with HTTP redirect.
- `PGSSLMODE=no-verify`: traffic is encrypted but the server certificate is not verified. Later: ship the RDS CA bundle and use `verify-full`.
- No `trust proxy`, so the throttler sees the ALB IP instead of the client IP (RESEARCH Pitfall 5).
- Single NAT gateway and single-AZ RDS: deliberate cost trade-offs.
- RDS backup retention is 1 day, not the intended 7, because the account's free-tier plan rejects more (`FreeTierRestrictionError`). Restore 7 in `infra/rds.tf` if the account leaves the free plan.
- No VPC endpoints (ECR, Secrets Manager, Logs); everything goes through the NAT.
- No automatic handling of secret rotation (see above).
- Phase 9: register task-definition revisions from CI, then add `lifecycle { ignore_changes = [task_definition] }` on the ECS service (deferred, noted in `ecs.tf`); the OIDC role replaces the developer IAM grant; the run-task migration is automated.

## Phase 8 test checklist

- [ ] `terraform -chdir=infra validate` is green and `plan -detailed-exitcode` exits 0 (no drift)
- [ ] `GET http://<alb-dns>/health` returns 200 through the ALB
- [ ] Two healthy targets in `financial-control-api-tg`
- [ ] `bash infra/scripts/verify-phase8.sh` prints `PHASE8_VERIFIED`
- [ ] Task definition shows `secrets` with `valueFrom`, and no credential in `environment`
- [ ] Migration task exits 0
- [ ] Register, login and `/auth/me` work (throwaway data)
- [ ] RDS is not publicly accessible and its endpoint resolves to a 10.0.x.x address
- [ ] Stopping one task leaves the ALB answering
- [ ] `terraform -chdir=infra plan -destroy` succeeds
- [ ] After a destroy, the state bucket, JWT secret and ECR repository still exist
- [ ] Check the AWS billing page the day after applying
- [ ] Detach any temporary broad IAM grant (`AdministratorAccess`) after Phase 9
