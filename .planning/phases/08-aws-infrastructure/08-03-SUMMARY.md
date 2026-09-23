---
phase: 08-aws-infrastructure
plan: 03
subsystem: infra
tags: [ecs-run-task, typeorm-migration, verification, aws]
requires: ["08-02"]
provides:
  - "infra/migrate-overrides.json: run-task override for one-off migration (reused by Phase 9)"
  - "infra/scripts/verify-phase8.sh: re-runnable live-stack proof of all 3 ROADMAP criteria"
affects: [08-04, 09]
key-files:
  created: [infra/migrate-overrides.json, infra/scripts/verify-phase8.sh]
  modified: []
key-decisions:
  - "Migration runs via aws ecs run-task (private subnet, assignPublicIp DISABLED, same task definition), never at container boot (D-10)"
requirements-completed: [INFRA-02]
status: complete
duration: ~20 min
completed: 2026-09-23
plan_head_before: 50e2fcac2bfb40f9f2e491d9347ce9ecd4f9bb56
commits: 2
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
---

# Phase 8 Plan 03: Migration and live-stack verification Summary

Schema migrated on private RDS through a one-off ECS run-task (7 migrations, exit 0), register/login/me proven through the ALB, and a re-runnable script proves all ROADMAP Phase 8 criteria on live resources, printing PHASE8_VERIFIED.

## Tasks

1. **Task 1:** `infra/migrate-overrides.json` (command `node node_modules/typeorm/cli.js -d dist/database/data-source.js migration:run`). One-off task 05937e9e... exited 0 and applied InitUsers, CreateRefreshTokens, AddRefreshTokensUserFk, CreateAccounts, CreateCategories, CreateTransactions, CreateBudgets. SMOKE_OK (201 / 200 / 200 with matching email, throwaway user). Commit 7608932.
2. **Task 2:** `infra/scripts/verify-phase8.sh`. Printed SC1_OK, SC2_OK, TF_CLEAN, `SC3 observed: ok_responses=40/40 last5=200x5 states seen: healthy,healthy / draining,healthy / healthy,initial`, SC3_OK, PHASE8_VERIFIED. Service back to 2/2 running. Commit 392fec2.

## Deviations from Plan

**1. [Rule 3 - Blocking] AWS CLI charmap encoding error on Windows**
- **Found during:** Task 1 verify (the aws CLI printed `'charmap' codec can't encode character` and the chained command exited 255 at the wait/log step, after the task had been started and had finished).
- **Fix:** Did not start a second task. Inspected the already-run task directly (STOPPED, exit code 0, log stream shows all 7 migrations "has been executed"), and set `PYTHONIOENCODING=utf-8 PYTHONUTF8=1` for later aws calls and inside verify-phase8.sh. The literal MIGRATION_OK marker line was therefore not printed by the chain; the equivalent evidence was checked manually.
- **Files modified:** infra/scripts/verify-phase8.sh (encoding exports)

Note: the script does not assert RDS backup retention (08-02 deviation: retention is 1 day).

## Known Stubs

None.

## Threat Flags

None. No secret values printed; no destroy; no IAM changes. Only throwaway generated identities used over HTTP.

## Self-Check: PASSED

Files exist; commits 7608932 and 392fec2 exist; PHASE8_VERIFIED observed live.
