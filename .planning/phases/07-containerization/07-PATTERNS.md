# Phase 7: Containerization - Pattern Map

**Mapped:** 2026-09-23
**Files analyzed:** 8
**Analogs found:** 5 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|-----------------|---------------|
| `src/health/health.module.ts` | module | request-response | `src/categories/categories.module.ts` | role-match |
| `src/health/health.controller.ts` | controller | request-response | `src/categories/categories.controller.ts` | partial (no guard/DTO, but same controller shape) |
| `Dockerfile` (root) | config | file-I/O / build | *(none in repo)* | no analog |
| `.dockerignore` (root) | config | file-I/O | `.gitignore` (root) | partial (same exclusion intent, different tool) |
| `docker-compose.yml` (modify — add `api` service) | config | orchestration | existing `db` service in same file | exact (same file, extend existing pattern) |
| `package.json` (modify — add `@nestjs/terminus`) | config | dependency manifest | existing `dependencies` block | exact |
| `src/config/env.validation.ts` (no schema change expected) | config | validation | itself (reference only) | exact — confirms no new required env vars for containerization |
| `test/health.e2e-spec.ts` (if planner adds one) | test | request-response | `test/*.e2e-spec.ts` (e.g. `test/auth.e2e-spec.ts`) | role-match |

## Pattern Assignments

### `src/health/health.module.ts` (module, request-response)

**Analog:** `src/categories/categories.module.ts` (full file, 17 lines — read in one pass)

**Full pattern to mirror:**
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { Category } from './entities/category.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Category])],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
```

**Adaptation for `HealthModule`:** replace the `TypeOrmModule.forFeature([...])` import with `TerminusModule` (from `@nestjs/terminus`) — Terminus's `TypeOrmHealthIndicator` does not require registering an entity via `forFeature`, it reads the existing default TypeORM connection via `@nestjs/typeorm`'s `TypeOrmModule` already configured globally in `AppModule`. No `providers`/`exports` needed unless the planner wants a custom indicator; a bare `HealthController` + `TerminusModule` import is the minimal NestJS-idiomatic shape:
```typescript
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
```
Register `HealthModule` in `src/app.module.ts`'s `imports` array alongside `AuthModule`, `AccountsModule`, etc. (same array, same convention — see `src/app.module.ts` lines 52-58).

---

### `src/health/health.controller.ts` (controller, request-response)

**Analog:** `src/categories/categories.controller.ts` (full file, 75 lines — read in one pass)

**Imports pattern** (lines 1-17) — project convention: named imports from `@nestjs/common`, then relative imports for guards/decorators/services:
```typescript
import { Controller, Get } from '@nestjs/common';
```
Note: `/health` is a public, unauthenticated endpoint by nature (Docker `HEALTHCHECK` and future ALB target group hit it with no JWT) — **do NOT** apply `@UseGuards(JwtAuthGuard)` the way `CategoriesController` does at controller level (`categories.controller.ts` line 22). This is the one deliberate deviation from the analog.

**Core pattern to copy — controller-level route + service delegation** (`categories.controller.ts` lines 22-42 shape, simplified for a single GET):
```typescript
import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.db.pingCheck('database')]);
  }
}
```

**Response envelope caveat:** `AppModule` registers a global `ResponseInterceptor` (`src/common/interceptors/response.interceptor.ts`, wired at `app.module.ts` lines 83-96) that wraps every controller return value in a `{ data, timestamp }` envelope. Terminus's own `HealthCheckResult` shape (`{ status, info, error, details }`) will get wrapped inside `data` like any other endpoint — this is consistent with the rest of the API but the planner should confirm this is acceptable for the Docker `HEALTHCHECK` script and future ALB check (both only need HTTP status code, not body shape, per D-01/D-02 in `07-CONTEXT.md`), so no special-casing is required.

---

### `Dockerfile` (config, build) — no analog

No Dockerfile exists in this repo yet (confirmed via `find . -iname "Dockerfile*"` — no results). Build from `07-CONTEXT.md` decisions + `package.json` scripts (verified above) + `.claude/CLAUDE.md` Architecture Notes:

- Base image: `node:24-alpine` (D-04).
- Multi-stage: a `builder` stage running `npm ci` (full deps, including dev) + `npm run build` (→ `dist/`, confirmed via `nest-cli.json`'s default `outDir` and `package.json`'s `"build": "nest build"`), then a `runner` stage that does a fresh `npm ci --omit=dev` (or `npm ci --production`) and copies only `dist/` + `node_modules` (production-only) + `package.json` from the builder — no `src/`, no dev deps in the final image (ROADMAP.md success criterion).
- Runtime `CMD`: `node dist/main` — mirrors `package.json`'s `"start:prod": "node dist/main"` (line 14) exactly; do not hardcode a different entrypoint.
- Non-root user: create/use a non-root user in the runtime stage (Alpine convention: `addgroup -S nestjs && adduser -S nestjs -G nestjs`, then `USER nestjs`).
- Exposed port: reads from `PORT` env var, default 3000, matching `.env.example` line 3 and `env.validation.ts` line 14 (`PORT: z.coerce.number()...default(3000)`) — `EXPOSE 3000` as documentation only, actual port comes from env at runtime via `main.ts`'s `configService.getOrThrow<number>('PORT')` (main.ts line 40).
- `HEALTHCHECK`: Node inline script hitting `http.get('http://localhost:'+PORT+'/health', ...)` per D-02 — no `curl`/`wget` install.
- No secrets, no `.env` file copied into the image — confirmed by `.env` already being read entirely through `ConfigModule`/`ConfigService` (`app.module.ts` lines 22-25, `main.ts`), never hardcoded; the Dockerfile must not `COPY .env`.
- Migrations (`npm run migration:run`) explicitly stay OUT of `CMD`/`ENTRYPOINT` per `07-CONTEXT.md` code_context section (Integration Points) — confirmed against `package.json` line 23, which defines `migration:run` as a separate script, never invoked from `start:prod`.

---

### `.dockerignore` (config, file-I/O)

**Analog:** `.gitignore` (root, 30 lines read) — same exclusion *intent* (keep noise out), different consumer (Docker build context vs git).

**Pattern to adapt** — `.gitignore` excludes `/dist`, `/node_modules`, `/coverage`, `/.nyc_output`, logs, IDE files. For `.dockerignore`, additionally exclude:
```
node_modules
dist
.git
.env
.env.*
!.env.example
test
coverage
*.md
.vscode
.idea
```
Note the inversion vs `.gitignore`: `.gitignore` does NOT exclude `.env.example` from git (it's tracked, per `find` results above showing `./.env.example` exists), but `.dockerignore` should still exclude `.env*` broadly and explicitly allowlist `.env.example` back in only if a build step needs it (it likely doesn't — the runtime reads real env vars injected by docker-compose/ECS, not the example file).

---

### `docker-compose.yml` (modify — add `api` service)

**Analog:** the existing `db` service in the same file (`docker-compose.yml` lines 1-21, full file read in one pass).

**Pattern to copy — healthcheck + env var interpolation style** (lines 5-17):
```yaml
services:
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
    ports:
      - "${DB_PORT:-5432}:5432"
    volumes:
      - financial-control-db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 5s
      timeout: 5s
      retries: 10
```

**New `api` service — build on this exact style** (per D-03, `depends_on` with `condition: service_healthy`, env vars matching `.env.example` naming 1:1):
```yaml
  api:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      NODE_ENV: ${NODE_ENV:-development}
      PORT: ${PORT:-3000}
      DB_HOST: db
      DB_PORT: 5432
      DB_USER: ${DB_USER}
      DB_PASSWORD: ${DB_PASSWORD}
      DB_NAME: ${DB_NAME}
      JWT_ACCESS_SECRET: ${JWT_ACCESS_SECRET}
      JWT_ACCESS_EXPIRES_IN: ${JWT_ACCESS_EXPIRES_IN}
      JWT_REFRESH_EXPIRES_IN: ${JWT_REFRESH_EXPIRES_IN}
      ALLOWED_ORIGINS: ${ALLOWED_ORIGINS}
    ports:
      - "${PORT:-3000}:3000"
    depends_on:
      db:
        condition: service_healthy
```
Note `DB_HOST: db` — inside the compose network, the API reaches Postgres via the service name `db`, not `localhost` (which is what `.env.example` line 6 sets for pure local/non-containerized dev — this is a deliberate divergence, not an error, and should be called out in the plan).

---

### `package.json` (modify — add `@nestjs/terminus`)

**Analog:** existing `dependencies` block (lines 26-49, already read in full above).

**Pattern:** add `"@nestjs/terminus": "^11.1.1"` (version locked in `.claude/CLAUDE.md` Supporting Libraries table) to `dependencies` (NOT `devDependencies` — it runs inside the container, confirmed by `07-CONTEXT.md` line 66: "precisa ser adicionado como dependência de produção"). Alphabetical ordering is already the convention in this block (`@nestjs/common`, `@nestjs/config`, `@nestjs/core`, `@nestjs/jwt`, `@nestjs/passport`, `@nestjs/platform-express`, `@nestjs/throttler`, `@nestjs/typeorm`...) — insert `@nestjs/terminus` alphabetically between `@nestjs/platform-express` and `@nestjs/throttler`.

---

## Shared Patterns

### Env var access — always via `ConfigService`, never `process.env` directly
**Source:** `src/main.ts` lines 22-27, 39-40; `src/app.module.ts` lines 38-50
**Apply to:** any new code inside the Nest app (HealthController does not need this directly, but Dockerfile/compose changes must preserve this contract — never bake env values into the image).

### Module registration convention
**Source:** `src/app.module.ts` imports array (lines 52-58) — every domain module is a bare entry in `imports: [...]`, no dynamic module options at the app level.
**Apply to:** `HealthModule` registration.

### Response envelope (global interceptor)
**Source:** `src/app.module.ts` lines 83-96 (`ResponseInterceptor`, `ClassSerializerInterceptor` registered as `APP_INTERCEPTOR`)
**Apply to:** `HealthController` — its return value will be wrapped automatically; no manual envelope code needed in the controller itself.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `Dockerfile` | config | build/file-I/O | First Dockerfile in this repo — no prior multi-stage build to copy from. Built from `07-CONTEXT.md` decisions (D-04, D-02) + `.claude/CLAUDE.md` Architecture Notes + `package.json` scripts, as detailed above. |
| ECR repository creation (AWS CLI/console step, D-05) | infra (not a source file) | n/a | Operational step, not a codebase pattern — no analog applicable. Reference `.claude/CLAUDE.md` Architecture Notes for tag-immutability/scan-on-push rationale. |

## Metadata

**Analog search scope:** `src/` (all domain modules), root config files (`docker-compose.yml`, `.env.example`, `package.json`, `.gitignore`, `nest-cli.json`)
**Files scanned:** `docker-compose.yml`, `.env.example`, `package.json`, `src/app.module.ts`, `src/main.ts`, `src/categories/categories.module.ts`, `src/categories/categories.controller.ts`, `src/config/env.validation.ts`, `nest-cli.json`, `.gitignore`
**Pattern extraction date:** 2026-09-23
