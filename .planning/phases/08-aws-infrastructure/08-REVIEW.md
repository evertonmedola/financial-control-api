---
phase: 08-aws-infrastructure
reviewed: 2026-09-23T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - .gitignore
  - infra/versions.tf
  - infra/variables.tf
  - infra/network.tf
  - infra/rds.tf
  - infra/secrets.tf
  - infra/alb.tf
  - infra/ecs.tf
  - infra/migrate-overrides.json
  - infra/scripts/verify-phase8.sh
  - infra/README.md
  - README.md
findings:
  critical: 0
  warning: 8
  info: 3
  total: 11
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-09-23
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Terraform is structurally sound: SGs are SG-to-SG, the RDS master password stays out of state (managed secret), secrets are injected via `valueFrom`, and the execution role policy is scoped to two secret ARNs. No blockers found. Accepted deviations (HTTP-only, no-verify, backup 1 day, single NAT/AZ RDS) were not reported. Main concerns: the app and migrations run with the RDS master credential, a guaranteed outage when the managed secret rotates, weak image_tag validation with a stale hardcoded default, TG replacement pitfall, and README self-contradiction about destroy.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: Application and migrations run as the RDS master user

**File:** `infra/ecs.tf:25-26`
**Issue:** `DB_USER`/`DB_PASSWORD` come from the RDS master secret, so a compromised API process has superuser-level (rds_superuser) rights over the instance, and DDL rights at runtime. Contradicts the least-privilege posture stated in the README.
**Fix:** Use the master credential only for the migration task; create a limited app role (DML only on the app schema) with its own secret and reference it in the service task definition. At minimum record this as a hardening-backlog item (it is not in the README backlog).

### WR-02: Managed-secret rotation causes a guaranteed outage with no mitigation

**File:** `infra/ecs.tf:25-26`, `infra/README.md:134-142`
**Issue:** RDS rotates the managed master password about every 7 days, but ECS reads secrets only at task start. Any task older than the rotation will fail every new DB connection, and `/health` (DB-checked) will flip targets unhealthy. The stack silently breaks within a week of running. The README treats it as a "deferred" note only.
**Fix:** Options: separate app credential not subject to RDS rotation (see WR-01); a scheduled `update-service --force-new-deployment` (EventBridge); or fetch secrets at runtime. Add it to the hardening backlog list explicitly as an availability risk.

### WR-03: `image_tag` validation is too weak and default is a stale hardcoded SHA

**File:** `infra/variables.tf:53-62`
**Issue:** Only `!= "latest"` is rejected; `dev`, `main`, `v1` (mutable tags) pass. Also the default `c0ebba2` bakes a deploy target into code; a plain `apply` in the future silently rolls the service back to this SHA, and `plan` in `verify-phase8.sh` (TF_CLEAN) will report drift once Phase 9 deploys a different revision. Immutability also depends on the external ECR repo having tag immutability enabled, which nothing checks.
**Fix:**
```hcl
validation {
  condition     = can(regex("^[0-9a-f]{7,40}$", var.image_tag))
  error_message = "image_tag must be a lowercase hex git SHA."
}
```
and drop the default (require `-var image_tag=...`), or add a `data "aws_ecr_repository"` check for `image_tag_mutability == "IMMUTABLE"`.

### WR-04: Target group with fixed `name` cannot be replaced in place

**File:** `infra/alb.tf:14-16`
**Issue:** Changing `port`, `protocol`, `target_type` or `vpc_id` forces replacement; with a fixed name and no `create_before_destroy` the apply fails (name exists / TG in use by the listener).
**Fix:**
```hcl
name_prefix = "fc-api-"   # max 6 chars prefix in practice
lifecycle { create_before_destroy = true }
```
(verify script looks up the TG by name; update it to use the Terraform output instead.)

### WR-05: Container definition lacks hardening and a stop timeout

**File:** `infra/ecs.tf:83-100`
**Issue:** No `readonlyRootFilesystem`, no non-root `user`, no `linuxParameters` dropping capabilities, no `stopTimeout`. Given security is a stated core requirement, this is a gap (the container has network egress to 443 anywhere and holds the master DB credential).
**Fix:** Add `readonlyRootFilesystem = true` (plus a tmpfs/volume if the app writes), `user = "node"` (or the image's UID) and confirm the image supports it.

### WR-06: README contradicts itself about destroy behavior and current state

**File:** `infra/README.md:8` vs `infra/README.md:153`, `infra/README.md:172-184`
**Issue:** Line 8 says `terraform destroy` failed on `iam:ListInstanceProfilesForRole` and left two roles in state; line 153 states destroy "completes without manual steps". The checklist and the verify script assume a live stack while status says destroyed. A reader following the runbook literally hits the failure. Also the required IAM action is not listed in the Prerequisites IAM notes.
**Fix:** Document `iam:ListInstanceProfilesForRole` (and the other actions the scoped policy needs for destroy, e.g. `iam:DeleteRolePolicy`, `iam:DetachRolePolicy`) in Prerequisites and correct line 153.

### WR-07: verify script hardcodes account ID, region-scoped ARN prefix and Terraform PATH

**File:** `infra/scripts/verify-phase8.sh:11,57`
**Issue:** `pre='arn:aws:secretsmanager:sa-east-1:796897109626:secret:'` and `/c/Terraform` are hardcoded, and `R=sa-east-1`. The script is called "re-runnable" but breaks in any other account/region/machine, and would give a false `bad` rather than a clear message. The account ID is also duplicated in `versions.tf` (unavoidable there).
**Fix:** Derive from `aws sts get-caller-identity --query Account --output text`; only append to PATH if `terraform` is not found (`command -v terraform >/dev/null || export PATH=...`).

### WR-08: verify script hides failure detail and does not use `set -e`/pipefail semantics consistently

**File:** `infra/scripts/verify-phase8.sh:10,16,62,73`
**Issue:** `set -u` only. Several assignments are unchecked (`DB_PW=$(... | jq_ ...)` inside a pipeline whose failure is masked; `RDS_SG`, `ALB_SG`, `LB_ARN`, `PUBIP`), so failures surface later as confusing messages or, for `LB_ARN`, as an empty ARN passed to `describe-listeners`. `tf_out` sends stderr to /dev/null and the `terraform plan` output is fully discarded, so a drift (exit 2) or a real error (exit 1) is indistinguishable and undiagnosable. The state and secrets are also passed on grep's argv (`grep -qF -- "$JWT_VAL"`), which exposes the secret in the process list for the duration of the call; contradicts the T-08-15 "never leaks" claim. Use `grep -qF -f <(printf '%s' "$JWT_VAL")` or a node comparison instead.
**Fix:** Add `set -o pipefail`, validate each lookup with `[ -n "$X" ] && [ "$X" != None ] || fail`, keep plan output in a temp file and print it on non-zero exit, and do the secret comparison in node reading the value from stdin/env.

## Info

### IN-01: Task SG egress 443 open to 0.0.0.0/0

**File:** `infra/network.tf:136-142`
**Issue:** Necessary today (NAT, no VPC endpoints) but broad; exfiltration path from a compromised task. Not in the hardening backlog.
**Fix:** Add to backlog: VPC endpoints (ECR api/dkr, S3 gateway, Secrets Manager, Logs) and restrict egress to the endpoint SG/prefix lists.

### IN-02: Missing input validation on Fargate sizing and unused/weak variables

**File:** `infra/variables.tf:64-80,82-86`
**Issue:** `task_cpu`/`task_memory` accept invalid Fargate combinations (fails at apply, 15 minutes in). `desired_count` is documented "one per AZ" but is unconstrained. `allowed_origins` defaults to `http://localhost:3000` for a production ALB deployment, so a browser client on any other origin is blocked and the default is misleading. `availability_zones` is a variable but `count = 2` is hardcoded elsewhere.
**Fix:** Add validation blocks (allowed cpu values, memory lookup table) and use `length(var.availability_zones)`/`var.desired_count >= 1`.

### IN-03: No ALB observability and RDS log exports

**File:** `infra/alb.tf:2-12`, `infra/rds.tf:11-36`
**Issue:** No access logs, no `enabled_cloudwatch_logs_exports = ["postgresql"]`. For a project that advertises an "auditable" deployment there is no audit trail of requests or DB errors.
**Fix:** Add an S3 access-log bucket (or defer explicitly to the backlog) and enable `postgresql`/`upgrade` log exports.

---

_Reviewed: 2026-09-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
