---
phase: "1"
slug: "authentication-multi-tenant-foundation"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-11"
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest (per STACK.md — default for NestJS v11/CommonJS projects) |
| **Config file** | none — Wave 0 (no `package.json` exists yet; fully greenfield repo) |
| **Quick run command** | `npm run test -- auth` (once scaffolded) |
| **Full suite command** | `npm run test` (unit) / `npm run test:e2e` (e2e) |
| **Estimated runtime** | ~10-20 seconds (small suite at this phase) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -- auth`
- **After every plan wave:** Run `npm run test:e2e`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-TBD | 01 | 0 | AUTH-01 | V2 Authentication | Signup hashes password with argon2, never stores/returns plaintext | unit | `npm run test -- auth.service.spec.ts -t "register"` | ❌ W0 | ⬜ pending |
| 01-01-TBD | 01 | 0 | AUTH-01 | V2 Authentication | `passwordHash` never appears in register response body | integration | `npm run test:e2e -- auth.e2e-spec.ts -t "register response excludes passwordHash"` | ❌ W0 | ⬜ pending |
| 01-01-TBD | 01 | 0 | AUTH-02 | V2/V3 | Valid login returns access + refresh tokens; invalid login returns generic 401 | integration | `npm run test:e2e -- auth.e2e-spec.ts -t "login"` | ❌ W0 | ⬜ pending |
| 01-01-TBD | 01 | 0 | AUTH-02 | Information Disclosure | Wrong password and non-existent email return identical error body | integration | `npm run test:e2e -- auth.e2e-spec.ts -t "generic credentials error"` | ❌ W0 | ⬜ pending |
| 01-01-TBD | 01 | 0 | AUTH-03 | V3 Session Mgmt | Valid access token authorizes a protected route with no DB session lookup | unit/integration | `npm run test:e2e -- protected-route.e2e-spec.ts` | ❌ W0 | ⬜ pending |
| 01-01-TBD | 01 | 0 | AUTH-04 | V4 Access Control | Cross-tenant isolation: user A cannot access/modify user B's data via any endpoint this phase exposes | integration | `npm run test:e2e -- auth.e2e-spec.ts -t "cross-tenant"` | ❌ W0 | ⬜ pending |
| 01-01-TBD | 01 | 0 | D-04 | Elevation of Privilege | Refresh token reuse invalidates the entire token family | integration | `npm run test:e2e -- auth.e2e-spec.ts -t "refresh token reuse detection"` | ❌ W0 | ⬜ pending |
| 01-01-TBD | 01 | 0 | D-06 | DoS | `/auth/login` and `/auth/register` return 429 after exceeding throttle limit | integration | `npm run test:e2e -- auth.e2e-spec.ts -t "rate limiting"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Note: Task IDs are placeholders (`01-01-TBD`) until gsd-planner assigns concrete task IDs — updated once PLAN.md exists.*

---

## Wave 0 Requirements

- [ ] `package.json` + NestJS project scaffold (`@nestjs/cli new` or manual) — nothing exists yet
- [ ] `jest.config.js` / `test/jest-e2e.json` — standard NestJS CLI-generated config
- [ ] `docker-compose.yml` for local PostgreSQL, per STACK.md
- [ ] `test/auth.e2e-spec.ts` — covers AUTH-01..04 and D-04/D-06 per the table above
- [ ] `test/setup.ts` or equivalent — shared test DB setup/teardown (create/drop schema or truncate tables between tests)
- [ ] `src/config/env.validation.ts` — Zod schema including the four JWT env vars, so tests can boot the app with a known-good test env

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
