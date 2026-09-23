---
phase: 07-containerization
plan: 02
subsystem: infra
tags: [ecr, docker, aws, security-review, regression]
requires:
  - phase: 07-01
    provides: financial-control-api:local image
provides:
  - "Private ECR repo financial-control-api (IMMUTABLE, scanOnPush) in sa-east-1 holding the Phase 7 image under an immutable git-SHA tag"
affects: [08-aws-infrastructure, 09-ci-cd]
actuals:
  tokens: 6000
  tasks: 2
  commits: 0
plan_head_before: b402671
requirements-completed: [INFRA-01]
duration: ~10min
completed: 2026-09-23
status: complete
---

# Phase 7 Plan 2: ECR push + regression/security close-out Summary

**Phase 7 image pushed to a new private, tag-immutable, scan-on-push ECR repository; full unit (95) and e2e (169) suites green; security-review checklist reported.**

## Task 1: ECR repository + push (no repo file changes)

- Region: `sa-east-1` (from `aws configure get region`; `AWS_REGION` unset). Account: `796897109626`.
- Repository URI: `796897109626.dkr.ecr.sa-east-1.amazonaws.com/financial-control-api`
- Settings verified: `imageTagMutability=IMMUTABLE`, `scanOnPush=true`, private, no lifecycle policy (deferred to Phase 9).
- Pushed tag: `c0ebba2` (the 07-01 completion commit, from which `financial-control-api:local` was built; NOT `:latest`). Full reference for Phase 8:
  `796897109626.dkr.ecr.sa-east-1.amazonaws.com/financial-control-api:c0ebba2`
- Image digest: `sha256:218c31e91378e6ef26ece112d7af74ffa92a536c3e7a35f82dfe691e9c5954ea`
- `describe-images` lists two extra untagged entries (buildkit provenance/attestation manifests pushed alongside the image); harmless.
- Because tags are immutable, `c0ebba2` cannot be overwritten; any new image needs a new tag.

## Task 2: Regression + security review

- `npm run test`: 10 suites, 95/95 pass.
- `npm run test:e2e`: 16 suites, 169/169 pass (includes `health.e2e-spec.ts`). The `unexpected database failure` log line in output is an intentional test scenario.
- `docker history --no-trunc financial-control-api:local`: 0 matches for `JWT_*` / `DB_PASSWORD` names.

### Security-review checklist

Aplicado:
- `.env` and `.env.*` excluded in both `.gitignore` and `.dockerignore`
- Container runs non-root (`USER nestjs`, uid 100 proven in 07-01)
- No secret names/values in any image layer
- ECR repo private; tag immutability on (T-07-05, T-07-06); scan on push on
- Image tagged by git SHA, never `:latest` alone
- `/health` exposes only Terminus status, no credentials
- Prior-phase app items (DTO validation, IDOR, throttling, CORS, hashing, JWT) covered by Phases 1-6 and unchanged here

Atencao:
- `npm audit --omit=dev` reports 2 HIGH: `multer <=2.2.0` (4 DoS/limit-bypass advisories) via `@nestjs/platform-express <=11.2.5`. Fix available via `npm audit fix`; not applied here (out of scope: no dependency changes in this plan). Recommend fixing in the final hardening phase; the API has no file-upload endpoints, which lowers exposure.
- ECR scan-on-push findings for the pushed image were not reviewed (scan runs asynchronously); check in AWS console/Phase 9.
- Push used the developer's static local IAM user credentials (T-07-07, accepted); Phase 9 must move to OIDC.
- Compose `api` service still takes DB credentials via plain env vars locally; Phase 8 must use Secrets Manager `valueFrom`.

## Deviations from Plan

**[Rule 3 - Blocking] Local Postgres not running for e2e.** First `test:e2e` run failed 16/16 with DB connection errors because the project's `db` compose service was down. Started it with `docker compose up -d db` (this project's own service; container `financialcontrol-db-1`), reran: all pass. No code changes. It is left running.

Tag choice: pushed `c0ebba2` instead of current HEAD `b402671` (docs-only commit after the image build), per orchestrator instruction, so the tag maps to the code the image was built from.

## Known Stubs

None.

## Self-Check: PASSED

ECR repo settings and tag verified via AWS CLI; test suites run and green.
