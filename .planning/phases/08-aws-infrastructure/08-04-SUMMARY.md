---
phase: 08-aws-infrastructure
plan: 04
subsystem: infra
tags: [terraform, aws, runbook, security-review, cost-control, destroy]
requires: ["08-03"]
provides:
  - "infra/README.md: runbook, per-service Cloud Practitioner rationale, hardening backlog, Phase 8 test checklist"
  - "Root README Deployment section pointing to infra/README.md"
  - "Proven terraform destroy path (billable resources removed for real)"
affects: [09]
key-files:
  created: [infra/README.md]
  modified: [README.md, infra/README.md]
key-decisions:
  - "Human chose destroy-now (cost control); billable stack destroyed"
  - "Destroy stopped at 2 free IAM roles: developer policy lacks iam:ListInstanceProfilesForRole"
requirements-completed: [INFRA-02]
status: complete
duration: ~40 min
completed: 2026-09-23
plan_head_before: 9cac889f06f50908b643ea949af18f068dfe3773
commits: 2
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
---

# Phase 8 Plan 04: Runbook, destroy-readiness and cost decision Summary

Runbook with per-service rationale and test checklist written, security-review checklist walked, and the human's destroy-now decision executed: 34 of 36 resources destroyed, all billable ones gone; two free IAM roles remain because the developer IAM policy lacks `iam:ListInstanceProfilesForRole`.

## Tasks

1. **Task 1:** `infra/README.md` (10 required H2 sections) and root `README.md` Deployment section replaced by an AWS/Terraform overview. Destroy-readiness proven without destroying. Commit a5d2258.
2. **Task 2 (checkpoint:decision):** Human answered `destroy-now`. Destroy executed as authorized (and nothing else). A follow-up commit a77c4d0 adds a "Current status: DESTROYED" note to `infra/README.md`.

## Destroy-readiness evidence (Task 1, before destroying)

- `terraform plan -destroy` reported `Plan: 0 to add, 0 to change, 36 to destroy`.
- RDS `DeletionProtection` = False; ALB has no deletion protection.
- State bucket `financial-control-tfstate-796897109626` and secret `financial-control/jwt-access-secret` exist outside Terraform (absent from the destroy plan).

## Decision and result: destroy-now

`terraform -chdir=infra destroy -input=false -auto-approve` ran in the background and exited 1 after destroying 34 of 36 resources (VPC, subnets, NAT gateway, Elastic IP, ALB, target group, listener, ECS service/cluster/task definition, RDS instance and subnet group, security groups and rules, log group, IAM role policies).

Failure: deleting IAM roles `financial-control-ecs-execution` and `financial-control-ecs-task` returned 403 AccessDenied on `iam:ListInstanceProfilesForRole` for user `medolaFinance` (the scoped IAM policy from "Option B" lacks that action). No deletions were attempted with other tools, and no IAM changes were made.

Post-destroy verification (read-only):

- RDS `financial-control-db`: DBInstanceNotFound (gone).
- ALB `financial-control-alb`: none. NAT gateways: none active. Elastic IPs: none.
- ECS cluster `financial-control` and service `financial-control-api`: INACTIVE (no running tasks).
- Survivors as intended: state bucket, secret `financial-control/jwt-access-secret` (the only secret left; the RDS-managed master secret was removed with the instance), ECR repository `financial-control-api`.
- Still in Terraform state (free, no hourly cost): the two IAM roles and one data source.

To finish: add `iam:ListInstanceProfilesForRole` to the developer policy and re-run `terraform -chdir=infra destroy`, or re-`apply` (it reuses the roles).

## State of the stack (also stated in infra/README.md)

The stack is currently DESTROYED. Re-creating it is `apply` (about 15-20 minutes) and yields an EMPTY database, so the migration (`aws ecs run-task ... --overrides file://infra/migrate-overrides.json`) must be run again. The live evidence for Phase 8 exists only in the 08-02 / 08-03 summaries (`PHASE8_VERIFIED` observed live in 08-03); `bash infra/scripts/verify-phase8.sh` needs a re-apply plus migration to run again.

## Security-review checklist (project skill security-review)

Applied (verified in code and live during 08-01 to 08-03):
- No secret in code, state files, image or task `environment`: DB credentials come from the RDS-managed master secret (`manage_master_user_password`) and the JWT key from Secrets Manager, both injected via ECS `secrets`/`valueFrom` at container start; `.env`, `*.tfstate`, `tfplan*` are in `.gitignore`, `.env*` in `.dockerignore`.
- RDS `publicly_accessible = false`, private subnets, `storage_encrypted = true`, RDS SG allows 5432 only from the task SG (SG-to-SG); task SG allows 3000 only from the ALB SG.
- Least-privilege IAM: execution role (managed policy plus scoped secret read) separated from an empty task role; no `AdministratorAccess` or `*:*` on ECS roles.
- Encryption in transit to the database (TLS, `PGSSLMODE=no-verify` so encrypted but unverified; see Atencao); state bucket versioned, encrypted, public access blocked.
- Container image runs as non-root user `nestjs` (Dockerfile); image tag immutable (not `latest`); Terraform provider pinned with a lock file.
- No sensitive values in CloudWatch logs from the migration/verification runs; verification script and READMEs contain only names and commands.

Atencao (accepted gaps, each in the hardening backlog in `infra/README.md`):
- ALB serves HTTP only, so "ALB forces HTTPS" is NOT met (D-06): use throwaway data only until ACM + domain + listener 443 exist.
- `PGSSLMODE=no-verify`: TLS without certificate verification; move to the RDS CA bundle with `verify-full`.
- No `trust proxy`: throttler sees the ALB IP rather than the client IP.
- Secret rotation is not handled automatically: running tasks keep a stale password after the ~7-day rotation until `--force-new-deployment`.
- Temporary broad IAM on the developer user (`medolaFinance`) must be reviewed/detached once Phase 9's OIDC role exists; the policy is also missing `iam:ListInstanceProfilesForRole` (found by the destroy).
- RDS backup retention is 1 day (free-tier account limit), single NAT, single-AZ RDS, no VPC endpoints (cost trade-offs).
- `npm audit` in CI is a Phase 9 item (no pipeline yet); no dependency changes in this plan.

## Deviations from Plan

**1. [Rule 3 - Blocking, not fixed] Destroy incomplete due to missing IAM action**
- **Found during:** Task 2 follow-through.
- **Issue:** 403 on `iam:ListInstanceProfilesForRole` for the two Terraform-managed IAM roles.
- **Action:** Diagnosed and reported; no IAM changes or out-of-band deletions (outside the authorization). Documented in `infra/README.md` and above.
- **Commit:** a77c4d0

**2. [Rule 1 - Docs accuracy] Runbook claimed nothing about current state**
- Added a "Current status: DESTROYED" note to `infra/README.md` so it does not imply a live stack.

## Known Stubs

None.

## Threat Flags

None. No secret values were printed; nothing outside the authorized destroy was deleted (T-08-21 verified: bucket, JWT secret, ECR survive).

## Self-Check: PASSED

`infra/README.md` and `README.md` exist; commits a5d2258 and a77c4d0 exist; post-destroy leftover check recorded.
