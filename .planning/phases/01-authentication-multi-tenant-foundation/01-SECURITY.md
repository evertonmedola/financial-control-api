---
phase: "01"
slug: "authentication-multi-tenant-foundation"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-09-12"
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Client -> `POST /auth/register` / `POST /auth/login` | Untrusted credentials cross here; must be validated, hashed, and never echoed back | Email, plaintext password |
| Client -> `GET /auth/me` (Bearer token) | Untrusted bearer token crosses here; must be cryptographically verified before any DB lookup runs | JWT access token |
| Client -> `POST /auth/refresh` / `POST /auth/logout` | Untrusted refresh token crosses here; must be hash-looked-up, never trusted as an identity claim on its own | Refresh token (raw) |
| Client (any origin) -> API | Untrusted browser/script origin; CORS must gate which origins receive credentialed responses | HTTP requests, cookies/credentials |
| API -> HTTP error response | Internal exception detail must never cross this boundary back to the client | Stack traces, internal error detail |
| `AuthService` -> `users` table | Only place plaintext-adjacent data (the hash) is persisted; only place ownership scoping is enforced | Password hash (argon2) |
| `AuthService` -> `refresh_tokens` table | The only place a stolen/replayed token's blast radius is contained (family revocation) | Refresh token hash (SHA-256), userId |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-01 | Information Disclosure | `AuthService.validateUser()` (login) | high | mitigate | Generic 401 for both wrong-password and non-existent-email; both branches call `argon2.verify()` so timing cannot distinguish them | closed |
| T-01-02 | Tampering / Information Disclosure | `GET /auth/me` + `@CurrentUser()` | critical | mitigate | `CurrentUser` decorator returns `request.user.userId` exclusively (verified: `src/auth/decorators/current-user.decorator.ts:13`) — never a client-supplied query/body field | closed |
| T-01-03 | Spoofing | JWT signature verification (`JwtStrategy`) | high | mitigate | `@nestjs/jwt` + `passport-jwt` pin verification; `secretOrKey` sourced from `ConfigService.getOrThrow('JWT_ACCESS_SECRET')` (verified: `src/auth/strategies/jwt.strategy.ts:16`), never hardcoded | closed |
| T-01-04 | Information Disclosure | `AuthService.register()` / any logging | medium | mitigate | No `console.log`/`Logger` call in `src/auth` references password or `req.body` (verified via grep — no matches) | closed |
| T-01-05 | Information Disclosure | JWT payload (`AuthService.login()`) | medium | mitigate | Access token payload carries only `sub` — no email/PII field (verified: `src/auth/auth.service.ts:159`) | closed |
| T-01-06 | Information Disclosure | Global exception filter / `main.ts` | medium | mitigate | `HttpExceptionFilter` strips stack traces/internal detail from client responses; stack logged server-side only (`src/common/filters/http-exception.filter.ts`); proven by `test/security.e2e-spec.ts` | closed |
| T-01-07 | Tampering | `main.ts` CORS config | medium | mitigate | Explicit `ALLOWED_ORIGINS` allowlist from env, never `*`/`origin: true` (verified: `src/main.ts:24,32`) | closed |
| T-01-08 | Elevation of Privilege | `AuthService.refresh()` | high | mitigate | Rotation + reuse detection via a single atomic conditional `UPDATE ... WHERE token_hash = :h AND revoked_at IS NULL AND expires_at > :now` (strengthened by CR-03, commit `6388d76`, closing a TOCTOU race the post-execution code review found in the original read-then-write implementation); replaying an already-rotated token revokes the entire token family; proven by `auth.e2e-spec.ts:331`, new concurrency tests added in CR-03, and `cross-tenant.e2e-spec.ts:187` (per-user scoping) | closed |
| T-01-09 | Information Disclosure | `refresh_tokens` storage | medium | mitigate | Only `sha256(raw)` persisted, never the raw token (verified: `src/auth/auth.service.ts:187`) | closed |
| T-01-10 | Tampering | `AuthService.refresh()`/`logout()` scoping | high | mitigate | Every refresh-token DB operation scoped by the row's own stored `userId`, never a client-supplied identifier (verified: `src/auth/auth.service.ts:117`); proven under adversarial two-user test in `cross-tenant.e2e-spec.ts` | closed |
| T-01-SC | Tampering (supply chain) | npm installs (`@nestjs/jwt`, `@nestjs/passport`) | high | mitigate | Package-legitimacy gate + blocking-human checkpoint completed at Plan 01-01 Task 0 before either package was installed | closed |
| T-01-11 | Denial of Service / Elevation of Privilege | `POST /auth/login` | high | mitigate | `@nestjs/throttler` `@Throttle({limit:5, ttl: seconds(60)})`; proven by `auth.e2e-spec.ts:485` (429 on 6th attempt) | closed |
| T-01-12 | Denial of Service | `POST /auth/register` | medium | mitigate | `@nestjs/throttler` `@Throttle({limit:3, ttl: seconds(60)})`, applied in the same task/commit as login; proven by `auth.e2e-spec.ts:505` (429 on 4th attempt) | closed |
| T-01-13 | Information Disclosure / Tampering | Full `auth` module (all endpoints combined) | high | mitigate | `cross-tenant.e2e-spec.ts` (10 cases) proves T-01-01..T-01-12's per-plan mitigations hold together under a two-user adversarial scenario, including a client-supplied-identity-override sweep across every endpoint | closed |

*Status: open · closed · open — below {block_on} threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `workflow.security_block_on` (currently: **high**) count toward `threats_open`*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

**Verification method:** L1 grep-depth (ASVS level 1, per `workflow.security_asvs_level: 1`) — every threat's register was authored at plan time (`register_authored_at_plan_time: true` for all 5 plans), every mitigation was located in the implementation via direct grep against the file/line cited above, and every behavioral claim is additionally proven by a named, passing automated test (12 unit + 34 e2e, all green — see `01-VALIDATION.md`). Per the short-circuit rule (`threats_open: 0 AND register_authored_at_plan_time: true AND asvs_level == 1`), no deeper (L2/L3) auditor dispatch was required for this run.

---

## Deferred Items (breadcrumbed, not open threats)

The following were explicitly identified during planning/execution as out of Phase 1's applicable surface and are tracked for future phases — not omissions, and not counted in `threats_open`:

- **AUTH-01/AUTH-03 unclassified edge-probe categories** — reviewed manually; no additional testable case identified beyond what Plans 01-01..01-04 cover.
- **AUTH-04 "ordering" edge probe** — no list/collection endpoint exists yet in Phase 1 (only single-resource `/auth/me`). Revisit at Phase 2's first `userId`-scoped list endpoint.
- **IDOR differential 403-vs-404 response-shape disclosure** — no `:id`-parameterized resource endpoint exists in Phase 1 to apply it to. Breadcrumb to Phase 2's first `:id` routes.
- **User enumeration via `/auth/register`'s "email already taken" response** — standard UX tradeoff, canon-referred to OWASP enumeration guidance, not a bespoke Phase 1 prohibition.
- **AWS Infrastructure / CI/CD pipeline security items** (Secrets Manager, OIDC federation, RDS private subnets, etc.) — not applicable; those phases (7-9) have not started.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|

*No accepted risks.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-12 | 14 | 14 | 0 | /gsd-secure-phase (orchestrator, L1 grep-depth, no auditor dispatch — short-circuit rule) |
| 2026-09-12 (follow-up) | 14 | 14 | 0 | Post-hoc: `/gsd-code-review 01` independently found a TOCTOU concurrency race in T-01-08's implementation (read-then-write, not atomic) that the L1 grep-depth threat audit above did not catch — grep confirms a mitigation control EXISTS, it does not prove the control is race-free under concurrent load. Fixed via `/gsd-code-review 01 --fix` (commit `6388d76`); re-verified via new concurrency tests + full suite (13 unit + 36 e2e, all green). T-01-08 evidence updated above. |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log (none)
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-12
