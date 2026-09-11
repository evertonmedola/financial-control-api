# Stack Research

**Domain:** Personal finance/budgeting REST API — NestJS + PostgreSQL, deployed to AWS (ECS Fargate + ALB + RDS + Secrets Manager + GitHub Actions CI/CD)
**Researched:** 2026-09-11
**Confidence:** HIGH (framework/library versions verified directly against npm registry; AWS/Docker patterns cross-checked across multiple 2026 sources — MEDIUM on pattern details, HIGH on version facts)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | **24.x (Active LTS)** | Runtime | Node 20 reached **EOL on 2026-04-30** — it is no longer a safe target for a new project. Node 22 is Maintenance LTS (EOL 2027-04-30, fine but not current). Node 24 is Active LTS since 2025-10-28 with EOL 2028-04-30 — this is the correct target for anything started in Sept 2026. Verified via npm `engines` fields on `typeorm@1.1.1` (`^20.19.0 \|\| ^22.13.0 \|\| \>=24.11.0`) and `@nestjs/core@11.2.3` (`>=20`). |
| NestJS | **^11.2.3** (NOT v12) | Backend framework | NestJS v12.0.0 shipped 2026-08-27 — **~2 weeks old** at research time, moving the framework core to ESM-first with a rebuilt CLI, Vitest as default runner, and a new "Standard Schema" validation path that is explicitly meant to eventually replace `class-validator`. v11.2.3 (2026-08-25) is the mature, battle-tested, CommonJS line where the entire supporting ecosystem (`@nestjs/jwt`, `@nestjs/passport`, `@nestjs/swagger`, `@nestjs/terminus`, `@nestjs/config`, `@nestjs/typeorm`) has stable v11-compatible releases and matches the project's already-locked convention of `class-validator` DTOs. Adopting a 2-week-old major version for a project whose stated goal is a stable AWS learning path is the wrong tradeoff — pick v11 now, revisit v12 once it has a few months of ecosystem maturity behind it. |
| PostgreSQL | 16 or 17 (via RDS) | Primary datastore | Matches project constraint. Use whichever RDS-supported version is current when provisioning; both are fully supported by TypeORM's `pg` driver. |
| TypeORM | **^1.1.1** | ORM | TypeORM reached **1.0 on 2026-05-19** after ~9 years on the 0.3.x line — this is a real, actively-maintained major release (1.1.1 shipped 2026-09-01), not an abandoned fork. `@nestjs/typeorm@12.0.1`'s peer range explicitly allows `typeorm: "^0.3.0 \|\| ^1.0.0-dev"`, and the same package works against `@nestjs/core` v10/v11/v12. Requires Node ≥20.19/22.13/24.11 — satisfied by the Node 24 recommendation above. Migrating an 0.3.x-authored decorator-entity codebase to 1.x is largely mechanical (official `@typeorm/codemod` package automates most of it), so there's no reason to start a *new* project on the older line. |
| TypeScript | **^6.0.3** (NOT 7.x) | Language/compiler | TypeScript 7.0 shipped 2026-07-08 as a full **native (Go) rewrite** of the compiler, 8-12x faster — but it ships **no stable programmatic compiler API yet**. `nest build`, `ts-jest`, `ts-loader`, and the Swagger/GraphQL CLI plugins all depend on that API and do not run on 7.x today; the closest workaround people are using is "7.0 for type-checking, 6.x for actually building." Use TS 6.0.3 (last release of the classic line) for the whole toolchain until Nest's CLI and `ts-jest` officially support 7.x — this is a concrete, current pitfall, not speculation. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@nestjs/config` | ^4.0.4 | Env var loading + validation | Always — pairs with a `validate()` function (Zod, see below) so the app refuses to boot with missing/malformed env vars, per the project's own convention. |
| `zod` | ^4.6.2 | Env schema validation (used inside `@nestjs/config`'s `validate`) | Use as the schema for `ConfigModule.forRoot({ validate })`. 2025-2026 consensus recommends Zod over Joi for new TypeScript projects: it infers static types (so `ConfigService.get<T>()` is genuinely typed) and produces sharper fail-fast errors (`DB_HOST: Expected string, received undefined`) at startup. Joi remains a legitimate alternative (it's what the official NestJS docs demonstrate, and the project's own skill file allows either) — pick Zod as the default, don't rule out Joi if the team is more comfortable with it. |
| `class-validator` | ^0.15.1 | DTO validation via decorators | Always, per project convention — fully supported and idiomatic on NestJS v11 (this is the pattern v12's Standard Schema effort is explicitly moving away from, another reason to stay on v11 for now). |
| `class-transformer` | ^0.5.1 | DTO ↔ entity (de)serialization, `class-validator`'s companion | Always, alongside `class-validator` and a global `ValidationPipe({ whitelist: true, transform: true })`. |
| `@nestjs/jwt` | ^11.0.2 | JWT issuing/verification | Auth module — pairs with `@nestjs/passport` + `passport-jwt`. |
| `@nestjs/passport` + `passport-jwt` + `passport-local` | ^11.0.5 / current | Passport strategy integration | Standard NestJS auth pattern: `LocalStrategy` for login, `JwtStrategy` for guarding routes via `AuthGuard('jwt')`. |
| `bcrypt` | ^6.0.0 | Password hashing | Native module built on the stable Node-API (napi) ABI in v6 — ships prebuilt binaries for common Linux/musl (Alpine) targets, which matters directly for the Docker multi-stage build. Well-understood, huge production track record. |
| `argon2` | ^0.45.1 (alternative) | Password hashing | OWASP's current top recommendation over bcrypt for new systems (better memory-hardness against GPU/ASIC cracking). Also a native module. If the team wants the stricter OWASP-recommended default and is fine handling native-module Docker build nuances (build-stage toolchain, or verifying prebuilt binary availability for the target base image), use this instead of bcrypt. Given this project already treats security as a first-class requirement, this is a reasonable upgrade — default to `bcrypt` for simplicity, switch to `argon2` if the security-review pass wants the stronger KDF. |
| `@nestjs/terminus` | ^11.1.1 | Health check endpoints | Exposes `/health` for the ALB target group; integrates a `TypeOrmHealthIndicator` so the check also verifies DB connectivity, not just process liveness. |
| `@nestjs/swagger` | ^11.4.7 | OpenAPI docs | Standard for a portfolio-facing API — auto-generates `/api` docs from the same DTOs already validated by `class-validator`. |
| `@nestjs/throttler` | ^6.5.0 | Rate limiting | Apply to `/auth/login` and `/auth/register` at minimum — basic brute-force mitigation, cheap to add, aligns with the project's "security as a core requirement" stance. |
| `helmet` | ^8.3.0 | HTTP security headers | Wire in via `app.use(helmet())` in `main.ts`. Standard, low-effort hardening. |
| `pg` | ^8.23.0 | PostgreSQL driver (TypeORM's `type: 'postgres'` dependency) | Always — this is what actually opens the TCP connection to RDS. |
| `@aws-sdk/client-secrets-manager` | ^3.1130.0 (AWS SDK v3) | Programmatic Secrets Manager access | **Only** needed if you choose the "fetch-at-runtime" secrets pattern (see Architecture note below). If you use ECS's native `secrets` injection (recommended default), you don't need this package in the app at all. |
| `compression` | latest | Response gzip | Optional but cheap; useful once report endpoints return larger JSON payloads. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Jest | Test runner | Stays the default for NestJS v11 / CommonJS projects (v12's ESM track defaults to Vitest instead — another reason v11 is the lower-friction choice right now). |
| ESLint ^10.x + Prettier ^3.9.x | Lint/format | Current stable majors on npm; standard NestJS ESLint config (`@nestjs/eslint-config` or the CLI-generated flat config) applies cleanly to a v11/TS6 project. |
| `@nestjs/cli` | ^11.0.24 | Scaffolding, `nest build`/`nest start` | Pin to the 11.x line to match the framework version — the 12.x CLI targets the new ESM/Rspack toolchain. |
| Docker (multi-stage) | Containerization | See Docker section below — required by project constraints. |
| `docker-compose` | Local dev (Postgres + API) | Run Postgres as a local container so local dev mirrors RDS connectivity assumptions (network isolation, env-driven config) from day one. |

## Installation

```bash
# Core
npm install @nestjs/common@^11.2.3 @nestjs/core@^11.2.3 @nestjs/platform-express@^11.2.3 \
  @nestjs/config@^4.0.4 @nestjs/typeorm@^11.0.3 typeorm@^1.1.1 pg@^8.23.0 \
  @nestjs/jwt@^11.0.2 @nestjs/passport@^11.0.5 passport@^0.7.0 passport-jwt passport-local \
  class-validator@^0.15.1 class-transformer@^0.5.1 \
  @nestjs/swagger@^11.4.7 @nestjs/terminus@^11.1.1 @nestjs/throttler@^6.5.0 \
  bcrypt@^6.0.0 helmet@^8.3.0 zod@^4.6.2 reflect-metadata rxjs

# Only if using runtime secret fetch instead of ECS task-definition secret injection
npm install @aws-sdk/client-secrets-manager@^3.1130.0

# Dev dependencies
npm install -D @nestjs/cli@^11.0.24 typescript@^6.0.3 @types/node@^24 \
  @types/bcrypt @types/passport-jwt @types/passport-local \
  jest ts-jest supertest eslint prettier
```

## Alternatives Considered

| Category | Recommended | Alternative | Why Not (for this project) |
|----------|-------------|-------------|------------------------------|
| ORM | TypeORM 1.x | Prisma | Prisma's schema-first DX and type inference are genuinely better for teams that iterate fast on schema, but adopting it means abandoning the project's already-locked "TypeORM with generated migrations" convention for no gain tied to this project's actual requirements (single-service, decorator-entity domain modules already scoped). |
| ORM | TypeORM 1.x | Drizzle | Fastest, smallest, best for edge/serverless — but NestJS doesn't have the same first-class module integration TypeORM has (`@nestjs/typeorm`), and this project isn't edge/serverless (it's ECS Fargate), so Drizzle's core advantage doesn't apply here. |
| Framework version | NestJS v11 | NestJS v12 | v12 is 2 weeks old at research time; ESM-first shift, new CLI/build tooling (Rspack), and a validation-story change (Standard Schema moving away from `class-validator`) are all still settling. Revisit for a future milestone once the ecosystem (Swagger CLI plugin, ts-jest, community tutorials) has caught up. |
| Password hashing | bcrypt | argon2 | Argon2id is OWASP's top pick and a fine choice if you want the strictest current KDF — recommended as the upgrade path once the security-review pass on the auth phase runs, not a blocker for v1. |
| Env validation | Zod | Joi | Joi is what NestJS's own docs demonstrate and is a perfectly valid choice already permitted by the project's own convention file — pick Zod for the stronger TS inference, but don't treat Joi as wrong if already in use. |
| Config source in Fargate | ECS `secrets` (valueFrom Secrets Manager ARN) | AWS SDK fetch-at-runtime | SDK-in-app is only worth the extra IAM surface and code if you need secret rotation *without* a task restart; for v1, ECS-native injection is simpler, has fewer moving parts, and needs zero AWS SDK code in the NestJS app. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| Node.js 20.x as the Docker/runtime target | Reached **End-of-Life 2026-04-30** — no more security patches. Easy to pick by habit since it was long the "safe LTS" default. | Node 24.x (current Active LTS) |
| TypeScript 7.x for the build toolchain | No stable programmatic compiler API yet; `nest build`, `ts-jest`, `ts-loader`, and the Swagger/GraphQL CLI plugins do not run on it as of research time. | TypeScript 6.0.3 (last classic-compiler release) |
| NestJS v12 for this milestone | Released 2 weeks before research; ESM-first default, new CLI/bundler, validation approach still in flux. Real risk of hitting unpatched rough edges while also learning AWS fundamentals. | NestJS v11.2.x |
| `synchronize: true` on TypeORM in any environment that touches shared/production data | Silently mutates schema based on entity state; the classic cause of data loss / drift between environments. Already explicitly forbidden by the project's own convention. | Generated migrations (`typeorm migration:generate`), run explicitly in CI/CD before/at deploy |
| Storing DB credentials as ECS task-definition `environment` (plaintext) instead of `secrets` (Secrets Manager `valueFrom`) | Plaintext env vars in a task definition are visible to anyone with `ecs:DescribeTaskDefinition` — the security-review requirement to keep secrets out of code/config directly rules this out. | ECS `secrets` field pointing at a Secrets Manager ARN, or SDK fetch-at-runtime if rotation-without-restart is needed |
| Long-lived static AWS access keys as GitHub Actions secrets for the ECR/ECS deploy step | Standing credentials in repo secrets are a durable compromise target; this is now considered outdated practice for GitHub→AWS CI/CD. | GitHub OIDC federation (`aws-actions/configure-aws-credentials` with `role-to-assume`, no access keys stored) |
| Public accessibility on the RDS instance | Unnecessary exposure of the DB to the internet; directly conflicts with the project's stated "RDS sem acesso público" constraint. | RDS in private subnets, reachable only from the ECS Fargate task security group over the VPC-internal network |

## Stack Patterns by Variant

**If the team decides to revisit NestJS v12 in a later milestone:**
- Wait until the Swagger/GraphQL CLI plugins and `ts-jest`/build tooling have confirmed v12/ESM support, and until TypeScript 7.x has a stable programmatic API (so the two migrations — Nest v12 and TS 7 — can land together instead of fighting each other).
- Because `@nestjs/typeorm@12.0.1` already supports `@nestjs/core` v12, the ORM layer won't need to change when that migration happens.

**If secret rotation without container restart becomes a real requirement (not for v1):**
- Switch from ECS `secrets` (valueFrom) injection to a runtime fetch via `@aws-sdk/client-secrets-manager` at NestJS bootstrap, before the TypeORM connection is created — add the `secretsmanager:GetSecretValue` (+`kms:Decrypt` if using a custom KMS key) permission to the **task role** (not just the task execution role) for this case.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `@nestjs/core@^11.2.3` | `@nestjs/config@^4.x`, `@nestjs/jwt@^11.x`, `@nestjs/passport@^11.x`, `@nestjs/swagger@^11.x`, `@nestjs/terminus@^11.x`, `@nestjs/typeorm@^11.x` | All verified via npm `peerDependencies` at research time — this is a fully coherent, mutually-compatible v11 set. |
| `typeorm@^1.1.1` | `@nestjs/typeorm@^11.0.3` and `@nestjs/typeorm@^12.0.1` | `@nestjs/typeorm`'s peer range (`^0.3.0 \|\| ^1.0.0-dev`) covers 1.x; works with either Nest v11 or v12 host apps. |
| `typeorm@^1.1.1` | Node `^20.19.0 \|\| ^22.13.0 \|\| >=24.11.0` | Confirmed via npm `engines`; Node 24.11+ satisfies this and is also Active LTS — use Node 24 (latest patch) as the Docker base. |
| `bcrypt@^6.0.0` | Alpine (musl) Docker base images | v6 uses Node-API (napi) bindings; verify the target Alpine tag has a prebuilt binary, or ensure the same base image is used in both the builder and runtime Docker stages so native compilation (if triggered) matches the runtime ABI. |
| TypeScript `6.0.3` | `nest build`, `ts-jest`, `@nestjs/swagger` CLI plugin | Last release on the classic (non-native) compiler with the programmatic API these tools depend on — do not upgrade to 7.x until Nest's toolchain explicitly supports it. |

## Architecture Notes (AWS-specific integration patterns)

**ECS Fargate task definition:**
- Set task-level `cpu`/`memory` from Fargate's fixed size table (don't compute container-level values independently and hope they round correctly — start from the table).
- Node.js is single-threaded; leave headroom beyond the app's own footprint for GC/event-loop/I-O overhead rather than over-provisioning vCPU that the process can't use. Start conservative (e.g. a small task size), load-test, and adjust — don't guess a large size up front.
- Reference the container image by immutable tag (git SHA), not `:latest`, so each task definition revision is reproducible and rollback-able.

**RDS connectivity from Fargate:**
- Same VPC, RDS in **private** subnets, `PubliclyAccessible: false`.
- Security group model: RDS SG allows inbound TCP/5432 **from the ECS task's security group** (SG-to-SG reference) — not a CIDR range. This is the single most common point of failure when this pattern breaks.
- Fargate tasks resolve the RDS endpoint via VPC-internal DNS; no NAT/internet path is needed for this traffic as long as both are in the same VPC.

**Secrets Manager integration:**
- Default pattern: task definition's `secrets` array with `valueFrom` = Secrets Manager ARN (optionally a specific JSON key via `arn:...:secret:name:jsonkey::`). ECS agent resolves and injects these as environment variables **before** the container process starts — the NestJS app just reads them through `@nestjs/config`/`ConfigService`, no SDK code needed.
- IAM: grant `secretsmanager:GetSecretValue` to the **task execution role** (the role ECS itself uses to prepare the task), not the task role (which is for the app's own runtime AWS calls).
- Only add the AWS SDK to the app itself if you need to re-fetch a rotated secret without restarting the task.

**ALB health checks:**
- Expose `/health` via `@nestjs/terminus`'s `HealthController` + `@HealthCheck()`, including a `TypeOrmHealthIndicator` check so the target group only reports healthy when the app can actually reach Postgres, not just when the process is alive.
- Set the ECS service's health check grace period long enough to cover cold-start + first successful DB connection, so rolling deploys don't get killed mid-startup.

**GitHub Actions CI/CD:**
- Standard shape: checkout → `aws-actions/configure-aws-credentials` (OIDC role assumption, no static keys) → `aws-actions/amazon-ecr-login` → `docker build`/`push` (tag = commit SHA) → `aws-actions/amazon-ecs-render-task-definition` (swap in the new image URI) → `aws-actions/amazon-ecs-deploy-task-definition` (updates the service, waits for stable rollout).
- OIDC federation is the current recommended default over long-lived IAM access keys stored as repo secrets.

## Sources

- npm registry (`npm view <pkg> versions/dist-tags/engines/peerDependencies --json`) — direct primary-source verification of every version number and compatibility claim in this document. HIGH confidence.
- [InfoQ — TypeORM Reaches 1.0](https://www.infoq.com/news/2026/06/typeorm-1-released/) / [TypeORM 1.0 blog post](https://typeorm.io/blog/typeorm-1-0/) / [Upgrading from 0.3 to 1.0](https://typeorm.io/docs/releases/1.0/upgrading-from-0.3/) — MEDIUM-HIGH confidence.
- [InfoQ — NestJS v12 Roadmap](https://www.infoq.com/news/2026/04/nestjs-12-roadmap-esm/) / [Trilon — NestJS v12 is Now Available](https://trilon.io/blog/nestjs-12-is-now-available) — MEDIUM confidence.
- [InfoQ — TypeScript 7.0 native compiler](https://www.infoq.com/news/2026/08/typescript-7-released/) / [NestJS and TypeScript 7 (tsgo): what works, what doesn't](https://fernforge.github.io/devnotes/nestjs-typescript-7/) — MEDIUM confidence, cross-checked across two independent sources agreeing on the same compatibility gap.
- [Node.js Release and EOL Timeline](https://hidekazu-konishi.com/entry/nodejs_release_and_eol_timeline.html) / [HeroDevs — Node.js Version Support](https://www.herodevs.com/blog-posts/node-js-end-of-life-dates-you-should-be-aware-of) — MEDIUM-HIGH confidence, consistent across sources.
- Web search synthesis (MEDIUM confidence, cross-checked across 3-9 sources per topic — cached via research-store, see keys `4384aed7…`, `4f260208…`, `bcf0fcef…`, `0c579db9…`, `19e9aa86…`, `8adc845a…`, `46fa5d9f…`, `39bf3a4e…`, `6d124587…`, `73403e77…`) covering: NestJS Docker multi-stage patterns, ECS Fargate task sizing, RDS/Fargate VPC connectivity, Secrets Manager integration patterns, `@nestjs/terminus` + ALB health checks, GitHub Actions → ECR → ECS pipelines, NestJS JWT/refresh-token practices, Zod vs Joi for `@nestjs/config`.
- Project conventions already locked in `D:/FinancialControl/.claude/skills/nestjs-conventions/SKILLS.md` (TypeORM + migrations, `class-validator` DTOs, `@nestjs/config` + Joi/Zod schema) — treated as constraints, not re-litigated.

---
*Stack research for: NestJS + PostgreSQL personal finance API on AWS (ECS Fargate/ALB/RDS/Secrets Manager/GitHub Actions)*
*Researched: 2026-09-11*
