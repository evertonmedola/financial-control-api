# Phase 1: Authentication & Multi-Tenant Foundation - Pattern Map

**Mapped:** 2026-09-11
**Files analyzed:** 0 (no application files exist yet)
**Analogs found:** 0 / N/A

## Greenfield Notice

This repository has no application code of any kind at the time of mapping. Verified directly:

```
$ ls -la D:/FinancialControl
.claude/       (GSD tooling only)
.git/
.planning/     (planning docs only)
```

No `src/`, no `package.json`, no `node_modules`, no `.ts`/`.js` source files, no test files, no `docker-compose.yml`. `git ls-files` scope was checked — there is no tracked application code to search for analogs.

Since Phase 1 is the **first** phase, there is no prior codebase to extract patterns from. Standard pattern-mapping (Steps 3-5 of this agent's process — analog search, code excerpt extraction, shared-pattern identification) is **not applicable** here. This is expected and correct for a Phase 1 mapping run in a greenfield project — do not fabricate analogs.

## File Classification (files to be created, no analogs possible)

| New File | Role | Data Flow |
|----------|------|-----------|
| `src/auth/auth.module.ts` | module (NestJS) | n/a |
| `src/auth/auth.controller.ts` | controller | request-response |
| `src/auth/auth.service.ts` | service | request-response / event-driven (login/refresh flow) |
| `src/auth/strategies/local.strategy.ts` | middleware (Passport strategy) | request-response |
| `src/auth/strategies/jwt.strategy.ts` | middleware (Passport strategy) | request-response |
| `src/auth/guards/local-auth.guard.ts` | middleware | request-response |
| `src/auth/guards/jwt-auth.guard.ts` | middleware | request-response |
| `src/auth/decorators/current-user.decorator.ts` | utility | request-response |
| `src/auth/dto/register.dto.ts`, `login.dto.ts`, `refresh.dto.ts`, `user-response.dto.ts` | model (DTO) | request-response |
| `src/auth/entities/user.entity.ts`, `refresh-token.entity.ts` | model (TypeORM entity) | CRUD |
| `src/common/interceptors/response.interceptor.ts` | middleware | transform |
| `src/config/env.validation.ts` | config | n/a |
| `src/database/migrations/*` | migration | n/a |
| `test/auth.e2e-spec.ts`, `src/auth/auth.service.spec.ts` | test | n/a |

## Pattern Assignments

None — no existing codebase files to assign as analogs.

**Substitute pattern source for the planner:** Use `01-RESEARCH.md` directly as the pattern authority for this phase:
- Architecture Patterns → Pattern 1 (`@CurrentUser()` / `JwtStrategy` / `JwtAuthGuard`) — full code example given, lines ~279-310
- Architecture Patterns → Pattern 2 (generic login error + timing mitigation) — code example, lines ~318-335
- Architecture Patterns → Pattern 3 (refresh token rotation + reuse detection) — full entity + service code, lines ~345-392
- Architecture Patterns → Pattern 4 (`User` entity, `@Exclude()` on `passwordHash`) — code example, lines ~400-422
- Code Examples section (`ValidationPipe`, `ThrottlerModule` + `@Throttle()`, argon2 hashing params) — lines ~484-535
- Recommended Project Structure (module/controller/service/dto/entities/strategies/guards/decorators layout) — lines ~238-267

## Shared Patterns

Not derivable from codebase (none exists). Per CONTEXT.md, defer file/module layout conventions to `.claude/skills/nestjs-conventions/SKILLS.md` and security patterns to `.claude/skills/security-review/SKILLS.md` — both are canonical references the planner and executor must read directly (see `01-CONTEXT.md` → Canonical References). This mapper did not duplicate their contents here to avoid drift between this file and the skill source of truth.

## No Analog Found

All files in this phase have no analog — this is Phase 1, the first code in the repository.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| All files listed in File Classification above | (various) | (various) | Greenfield repository — no prior application code exists to pattern-match against |

## Metadata

**Analog search scope:** Entire repository root (`D:/FinancialControl`) — confirmed only `.claude/` (tooling) and `.planning/` (docs) exist as tracked content; no `src/` or equivalent.
**Files scanned:** 0 application files (repository-wide `ls`/`find` confirms none exist)
**Pattern extraction date:** 2026-09-11
