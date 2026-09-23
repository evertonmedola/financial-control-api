---
phase: 08-aws-infrastructure
verified: 2026-09-23T00:00:00Z
status: passed
score: 3/3 must-haves verified
behavior_unverified: 0
overrides_applied: 0
notes: "Live stack destroyed by user choice; live evidence is historical (SUMMARY + orchestrator observation before destroy). covered_digest not generated."
---

# Phase 8: AWS Infrastructure Verification Report

**Phase Goal:** The API runs in AWS on managed, secure infrastructure, reachable from the internet only through a load balancer, with the database and secrets never exposed.
**Status:** passed (with a stated live-verification caveat, see below)
**Re-verification:** No, initial

## Observable Truths

| # | Truth (ROADMAP SC) | Status | Evidence in code |
|---|---|---|---|
| 1 | Reachable only via ALB; tasks and RDS private | VERIFIED | `infra/network.tf`: private subnets route via NAT only (no IGW); `public` subnets `map_public_ip_on_launch=false`. `ecs.tf` service `assign_public_ip=false`, subnets = private. `rds.tf` `publicly_accessible=false`, `storage_encrypted=true`, private DB subnet group. SG chain has no inline rules: ALB 80 from 0.0.0.0/0 -> task 3000 from ALB SG only -> RDS 5432 from task SG only (SG-to-SG). Only the ALB SG is open to the internet. |
| 2 | DB creds and JWT secret injected at runtime from Secrets Manager, never in image/env/CI logs | VERIFIED | `ecs.tf` `container_secrets`: DB_USER/DB_PASSWORD (`...:username::` / `:password::` from RDS-managed secret via `manage_master_user_password=true`) and JWT_ACCESS_SECRET (`valueFrom` ARN of CLI-created secret). None of these appear in `container_environment`. `secrets.tf` grants `GetSecretValue` on exactly those two secrets to the execution role only; task role is empty. JWT secret is only a `data` source, so its value is never in Terraform state. `verify-phase8.sh` SC2 asserts the shape and greps the task def and state for the secret values. `tfplan*` is gitignored. |
| 3 | ALB routes only to tasks passing `/health`; unhealthy removed | VERIFIED (config), live behavior historical | `alb.tf`: target group `target_type=ip`, health check `/health`, matcher 200, interval 15, healthy 2, unhealthy 3; listener forwards only to that group. `ecs.tf` attaches service to it, with `health_check_grace_period_seconds=60` and a deployment circuit breaker with rollback. Live proof (08-03-SUMMARY): stop-task test showed 40/40 200s with draining/healthy/initial states. |

**Score:** 3/3.

## Requirements Coverage

| Requirement | Plans | Status | Evidence |
|---|---|---|---|
| INFRA-02 (VPC public/private, private RDS, Fargate behind ALB, Secrets Manager) | 08-01, 08-02, 08-03, 08-04 (all declare `[INFRA-02]`) | SATISFIED | `network.tf`, `rds.tf`, `alb.tf`, `ecs.tf`, `secrets.tf` as above. REQUIREMENTS.md maps INFRA-02 to Phase 8 only; no orphaned IDs. |

## Artifacts and Wiring

All present and substantive: `infra/{versions,variables,network,rds,secrets,alb,ecs}.tf`, `.terraform.lock.hcl`, `migrate-overrides.json` (one-off run-task migration, container name `api` matches the task definition), `scripts/verify-phase8.sh` (re-runnable proof of SC1/SC2/TF_CLEAN/SC3), `README.md` (runbook, service rationale, checklist, destroy notes; satisfies the CLAUDE.md checklist-per-phase rule). Wiring checked: service -> target group -> listener -> ALB SG -> task SG -> RDS SG; task def -> execution role -> scoped secret policy; `DB_HOST` from the RDS address. No stubs and no TODO/FIXME/XXX debt markers found in the infra files that I read.

## Current live state (read-only checks)

- Terraform state holds only the 2 IAM roles and one data source (matches the claim of 34/36 destroyed).
- ECS cluster `financial-control` is INACTIVE.
- `tfplan*` files are untracked and ignored.

## Known accepted deviations (not gaps)

HTTP-only ALB (D-06), `PGSSLMODE=no-verify`, `backup_retention_period=1` (free-tier limit; verify script does not assert it), single NAT and single-AZ RDS, Option B scoped IAM. Advisory review 08-REVIEW.md has 0 critical and 8 warnings: app runs as the RDS master user (WR-01), managed-secret rotation would cause an outage (WR-02), weak `image_tag` validation (WR-03), fixed target group name blocks in-place replacement (WR-04), no container hardening or stop timeout (WR-05), README inconsistency (WR-06), verify script hardcodes account ID/PATH (WR-07) and hides failure detail (WR-08). None blocks the goal. Two carry into the hardening backlog: WR-01 and WR-02.

## Live re-verification caveat (honest limits)

The following can no longer be re-observed: `/health` 200 with database up, migration exit 0 (7 migrations), register/login/me through the ALB, the `PHASE8_VERIFIED` script run, and the stop-task health-gated routing. They rest on 08-02/08-03 SUMMARY records plus the orchestrator's independent pre-destroy observation of `/health` 200, private+encrypted RDS, 2/2 tasks without public IP, secrets only in `secrets`, and a clean plan. I treated this as sufficient because the code in the repo is consistent with each claim, and the state is reproducible: `terraform apply` (about 15-20 min, empty DB, re-run migration), then `bash infra/scripts/verify-phase8.sh`. I did not raise a human_needed item, since destroy was an explicit user choice. A human who wants a fresh live proof before Phase 9 depends on the stack can re-apply and run that script.

## Minor notes (non-blocking)

- README line 8 says the stack is destroyed, and line 153 says destroy completes without manual steps. The latter is outdated because destroy hit the `iam:ListInstanceProfilesForRole` permission gap (WR-06).
- Finishing the destroy needs that IAM action added.

## Gaps Summary

None. The phase goal is met by the code and by the recorded live evidence.

_Verifier: Claude (gsd-verifier)_
