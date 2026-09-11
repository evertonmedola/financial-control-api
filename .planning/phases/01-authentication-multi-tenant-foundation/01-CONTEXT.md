# Phase 1: Authentication & Multi-Tenant Foundation - Context

**Gathered:** 2026-09-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can create an account, log in securely, and trust that their data is isolated from every other user. This phase establishes the ownership-check (`userId`-scoped query) pattern that every later module (accounts, categories, transactions, budgets, reports) reuses. Covers AUTH-01..04 from REQUIREMENTS.md.

</domain>

<decisions>
## Implementation Decisions

### Password Hashing
- **D-01:** Use `argon2` (not bcrypt) for password hashing — **Reversibility:** costly — changing the hashing algorithm after users exist requires either a forced password reset or a lazy re-hash-on-next-login migration; not a simple swap.

### JWT Strategy
- **D-02:** Access token + refresh token (not access-token-only) — **Reversibility:** costly — removing refresh tokens later changes the client contract (clients expect a refresh endpoint) and touches the auth module's core flow.
- **D-03:** Access token expiration: 15 minutes.
- **D-04:** Refresh token: 7 days, stored as a hash in the database (not stateless) — enables revocation (real logout) and rotation on each use. **Reversibility:** costly — switching to stateless refresh tokens later removes the revocation capability and changes the DB schema.

### Error Responses
- **D-05:** Login failure returns a generic error ("credenciais inválidas") regardless of whether the email exists or the password is wrong — prevents user enumeration.
- **D-06:** Rate limiting (`@nestjs/throttler`) applied to `/auth/login` and `/auth/register` from this phase, not deferred to a later security pass.

### Claude's Discretion
- Exact DTO/entity field names, module file layout — follow `nestjs-conventions` skill conventions (module/controller/service/dto/entities per domain).
- Refresh token rotation implementation detail (e.g., whether to invalidate all prior refresh tokens on rotation, or just the one used) — pick the standard rotate-and-invalidate-the-used-token pattern unless research surfaces a stronger reason otherwise.
- Signup → login flow: no email verification gate in this phase (not discussed as a gray area — no SES/email sending is in scope per PROJECT.md; user can log in immediately after signup).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project conventions
- `.claude/skills/nestjs-conventions/SKILLS.md` — module structure (module/controller/service/dto/entities per domain), `userId`-scoped entities, controller-passes-userId-to-service pattern (services never read `Request` directly), TypeORM migrations (never `synchronize: true`), env validation on boot, response format consistency, test coverage expectations
- `.claude/skills/security-review/SKILLS.md` — security checklist this phase's implementation must pass before being considered done

### Research
- `.planning/research/STACK.md` — confirms `@nestjs/jwt`, `@nestjs/passport` + `passport-jwt` + `passport-local`, `argon2`/`bcrypt`, `@nestjs/throttler`, `helmet`, `class-validator`/`class-transformer`, `zod` for env schema validation; NestJS v11.2.x / Node 24 / TypeScript 6.0.3 / TypeORM 1.1.x version targets
- `.planning/research/ARCHITECTURE.md` — multi-tenant isolation pattern (row-level `userId` scoping, not RLS/per-tenant schemas), module boundary guidance
- `.planning/research/PITFALLS.md` — IDOR must be verified module-by-module with cross-tenant automated tests; this phase establishes the pattern later modules are tested against

### Project definition
- `.planning/PROJECT.md` — Core Value, Constraints (security as central requirement, incremental order)
- `.planning/REQUIREMENTS.md` — AUTH-01..04 full requirement text

</canonical_refs>

<code_context>
## Existing Code Insights

Greenfield phase — no existing code, no `.planning/codebase/*.md` maps, no `src/` directory yet. Nothing to reuse; this phase establishes the first patterns (module structure, `userId`-scoping, response format) that all later phases will follow.

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond the decisions above — open to standard NestJS/Passport implementation approaches within those constraints.

</specifics>

<deferred>
## Deferred Ideas

- Email verification before login — explicitly not in this phase's scope (no SES/email sending yet per PROJECT.md); revisit if/when the CSV/S3/Lambda/SES extension is picked up.

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 1-Authentication & Multi-Tenant Foundation*
*Context gathered: 2026-09-11*
