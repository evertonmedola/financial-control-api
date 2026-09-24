---
phase: 09-ci-cd-pipeline
plan: 01
subsystem: infra
tags: [eslint, github-actions-prep, postgres, secret-scan, gitattributes, npm-audit]

requires:
  - phase: 08-aws-infrastructure
    provides: Secrets Manager secret financial-control/jwt-access-secret used by the value check
provides:
  - npm run lint:check (check-only ESLint, exits 0)
  - .gitattributes pinning LF line endings
  - infra/scripts/ci-gate-local.sh (clean-clone reproduction of the Actions test job)
  - infra/scripts/prepush-scan.sh (D-02 pre-publish hard gate)
  - key/certificate ignore patterns in .gitignore and .dockerignore
affects: [09-02 publish repo, 09-04 workflow]

actuals:
  tokens: 30000
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Gate scripts print a marker line (CI_GATE_OK, SCAN_CLEAN) and clean up via trap"
    - "Secret patterns assembled from fragments so a scanner script never matches itself"

key-files:
  created:
    - .gitattributes
    - infra/scripts/ci-gate-local.sh
    - infra/scripts/prepush-scan.sh
  modified:
    - package.json
    - eslint.config.mjs
    - .gitignore
    - .dockerignore
    - src/auth/auth.service.ts
    - src/categories/dto/create-category.dto.ts
    - src/categories/dto/update-category.dto.ts
    - src/transactions/dto/create-transaction.dto.ts
    - src/transactions/dto/update-transaction.dto.ts
    - src/transfers/dto/create-transfer.dto.ts

key-decisions:
  - "Spec and e2e files get one scoped ESLint block downgrading unbound-method and the no-unsafe-* family to warn; production src stays strict"
  - "ci-gate-local.sh dirty-tree refusal ignores .planning/ and .claude/ only"
  - "prepush-scan.sh normalizes SCAN_REPO_DIR to a native path because it exports MSYS_NO_PATHCONV=1"

requirements-completed: [INFRA-03]

coverage:
  - id: D1
    description: "lint:check runs ESLint check-only and exits 0 (0 errors, 442 warnings); lint script untouched; .gitattributes pins LF"
    requirement: INFRA-03
    verification:
      - kind: other
        ref: "npm run lint:check -- --quiet && npm test (95/95)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The Actions test-job sequence passes from a clean clone against throwaway postgres:16 (lint:check, audit, 95 unit, migration:run, 169 e2e)"
    requirement: INFRA-03
    verification:
      - kind: integration
        ref: "bash infra/scripts/ci-gate-local.sh (CI_GATE_OK)"
        status: pass
    human_judgment: false
  - id: D3
    description: "prepush-scan.sh prints SCAN_CLEAN on the real repo and fails on a planted leak without echoing it or the JWT secret"
    requirement: INFRA-03
    verification:
      - kind: other
        ref: "bash infra/scripts/prepush-scan.sh (SCAN_CLEAN); planted AKIA-shaped string in temp repo -> SCAN_FAIL:credentials(aws-key)"
        status: pass
    human_judgment: false

duration: 65min
completed: 2026-09-23
status: complete
commits: 4
plan_head_before: ce3553b568eed9ef2d463350140388fe22fe3197
---

# Phase 9 Plan 01: CI gate groundwork Summary

**Check-only `lint:check` gate at 0 errors, a clean-clone CI test-job reproduction against throwaway Postgres 16 (95 unit + 169 e2e green), and a pre-publish secret scan proven to fail on a planted leak.**

## Performance

- **Duration:** ~65 min
- **Completed:** 2026-09-23
- **Tasks:** 3
- **Files modified:** 19

## Accomplishments
- `lint:check` exits 0 (0 errors, 442 warnings accepted baseline); `lint` script unchanged; `.gitattributes` `* text=auto eol=lf`.
- Unit tests 95/95 before and after Task 1. Scoped `**/*.spec.ts` and `test/**/*.ts` block downgrades `unbound-method`, `no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-return` to `warn`. `@Transform` params typed `{ value: unknown }`; `auth.service.ts` casts `rotateResult.raw` to `{ user_id: string }[]`; migration change is a line-break reflow only.
- Tracer `ci-gate-local.sh` went green on the first run from a clean clone (no `.env`): npm ci, lint:check, `npm audit --omit=dev --audit-level=high` (0 vulnerabilities), 95 unit, migration:run, 169 e2e in 16 suites; container removed by trap. No environment finding required a repo fix.
- `prepush-scan.sh`: SCAN_CLEAN on the real repo (23 review items, 19 files mention the account id, both for the Plan 09-02 reviewer); JWT secret value absent from history, tree and scan output; with invalid AWS credentials it fails `jwt(secret-unreadable)`.

## Task Commits

1. **Task 1: lint:check, .gitattributes, green ESLint gate** - `4db9221` (chore)
2. **Task 2: ci-gate-local.sh tracer** - `80066ac` (feat)
3. **Task 3: prepush-scan.sh + key/cert ignores** - `608ff39` (feat)
4. **Task 3 fix: native path for SCAN_REPO_DIR** - `6bde400` (fix)

## Files Created/Modified
- `infra/scripts/ci-gate-local.sh` - env `CI_GATE_PG_PORT` (default 55432), container `fc-ci-gate-pg`, marker `CI_GATE_OK`; env contract reused by Plan 09-04
- `infra/scripts/prepush-scan.sh` - markers `SCAN_CLEAN`, `SCAN_FAIL:<class>`, `SCAN_REVIEW_ITEMS=`, `SCAN_INFO account_id_files=`
- `package.json`, `.gitattributes`, `eslint.config.mjs`, `.gitignore`, `.dockerignore`, and the lint-fixed source files listed above

## Decisions Made
See key-decisions. Throwaway CI JWT secret literal: `ci-only-throwaway-jwt-secret-not-real-0123456789` (reuse in Plan 09-04).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Dirty-tree refusal scoped to exclude workflow metadata**
- **Found during:** Task 2
- **Issue:** The plan's refusal on any tracked change would always trip because `.planning/STATE.md`, `.planning/state.json` and `.claude/settings.json` are modified by the workflow itself (orchestrator instruction).
- **Fix:** `git diff --quiet HEAD -- . ':!.planning' ':!.claude'`; any other tracked change is still fatal.
- **Files modified:** infra/scripts/ci-gate-local.sh
- **Committed in:** 80066ac

**2. [Rule 1 - Bug] SCAN_REPO_DIR unusable with MSYS paths**
- **Found during:** Task 3 verify
- **Issue:** The script exports `MSYS_NO_PATHCONV=1`, so native git could not open `/tmp/...`; the planted-leak self-test failed with `fatal` (rc 128), which would have made the "fails on leak" proof vacuous.
- **Fix:** normalize `REPO` via `pwd -W`. The self-test then fails for the right reason (`SCAN_FAIL:credentials(aws-key)`, key not echoed).
- **Files modified:** infra/scripts/prepush-scan.sh
- **Committed in:** 6bde400

**3. Verify-command note (not a code change):** the plan's Task 3 verify exports `MSYS_NO_PATHCONV=1` before `git -C "$t" init` on a `/tmp` path, which native git cannot resolve on Windows. I ran the equivalent steps creating the temp repo without that variable; outcomes verified individually.

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug). **Impact:** none on scope.

## Issues Encountered
None beyond the deviations.

## Known Stubs
None.

## Threat Flags
None. `infra/scripts/prepush-scan.sh` reads the JWT secret once via `secretsmanager:GetSecretValue` (already granted, in the threat model as T-09-02).

## User Setup Required
None.

## Next Phase Readiness
Ready for 09-02: run `bash infra/scripts/prepush-scan.sh` again immediately before publishing and show the SCAN_REVIEW_ITEMS list to the human.

## Self-Check: PASSED
Files exist (`.gitattributes`, both scripts); commits 4db9221, 80066ac, 608ff39, 6bde400 present; `git rev-list --count` from plan base = 4.

---
*Phase: 09-ci-cd-pipeline*
*Completed: 2026-09-23*
