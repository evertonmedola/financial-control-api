# Walking Skeleton — Controle Financeiro Pessoal — API

**Phase:** 1
**Generated:** 2026-09-11

## Capability Proven End-to-End

> A visitor can register with email+password (persisted as an argon2 hash), log in to receive a short-lived JWT, and use that JWT to access a protected endpoint that returns only their own data — while an unauthenticated or wrong-token request is rejected.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | NestJS ^11.2.3 (CommonJS, not v12 ESM) | Locked in CLAUDE.md — v12 is ~2 weeks old at research time; v11's ecosystem (Swagger CLI plugin, ts-jest) is mature and stable. |
| Data layer | PostgreSQL 16 (Docker Compose locally, RDS in Phase 8) + TypeORM ^1.1.1 with generated migrations | Project constraint — `synchronize: true` forbidden on any environment touching shared data. |
| Auth | `@nestjs/passport` + `passport-jwt`/`passport-local` + `@nestjs/jwt`, argon2id password hashing, DB-backed hashed+revocable refresh token alongside a stateless 15-min access token | Per CONTEXT.md D-01..D-06 (locked) and `01-RESEARCH.md` Architecture Patterns 1-4. |
| Multi-tenant isolation | Row-level `userId` scoping enforced at the service layer via `@CurrentUser()` — no RLS, no per-tenant schemas | `01-RESEARCH.md` Architectural Responsibility Map; this is the pattern every later module (Phase 2+) reuses. |
| Deployment target (this phase) | Local only — `npm run start:dev` against Dockerized Postgres. AWS deployment is Phases 7-9. | Project's explicit incremental-order constraint: API local → containerização → AWS → CI/CD. |
| Directory layout | `src/<domain>/{module,controller,service}.ts` + `dto/`, `entities/` per domain; `auth/` additionally has `strategies/`, `guards/`, `decorators/` | `nestjs-conventions` skill + `01-RESEARCH.md` Recommended Project Structure. |

## Stack Touched in Phase 1

- [x] Project scaffold (NestJS CLI, `tsconfig.json`, ESLint/Prettier, Jest unit + e2e config)
- [x] Routing — `POST /auth/register`, `POST /auth/login`, `GET /auth/me` (protected), later `POST /auth/refresh`, `POST /auth/logout`
- [x] Database — one real write (`POST /auth/register` persists a `User` row) AND one real read (`POST /auth/login` reads it back, verifies the argon2 hash)
- [x] "UI" (API consumer) — the protected-route interaction: `GET /auth/me` with a valid `Authorization: Bearer <accessToken>` succeeds and returns only the caller's own data; without a token, or with an invalid/expired one, it returns 401
- [x] Deployment — documented local full-stack run command: `docker compose up -d db && npm run migration:run && npm run start:dev`

## Out of Scope (Deferred to Later Slices)

- Email verification before login (no SES/email sending in this milestone — CONTEXT.md Deferred Ideas)
- Any domain entity beyond `User`/`RefreshToken` (Accounts, Categories, Transactions, Budgets, Reports are Phases 2-6)
- AWS deployment, containerization for production, CI/CD (Phases 7-9)
- Redis/distributed rate-limit storage — `@nestjs/throttler`'s in-memory store is sufficient for a single-instance local/portfolio deployment this phase

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: Accounts — first domain module built on the `userId`-scoping pattern established here
- Phase 3: Categories — same pattern, second domain module
- Phase 4: Transactions & Transfers — same pattern plus atomic multi-row updates
- Phase 5: Budgets — same pattern plus aggregation
- Phase 6: Reports — same pattern plus read-only aggregation endpoints
- Phase 7-9: Containerization, AWS Infrastructure, CI/CD — package this skeleton for production, unchanged in application logic
