# Phase 1: Authentication & Multi-Tenant Foundation - Research

**Researched:** 2026-09-11
**Domain:** NestJS Passport JWT authentication (access + refresh token), argon2 password hashing, `userId`-scoped multi-tenant data isolation, `@nestjs/throttler` rate limiting
**Confidence:** MEDIUM-HIGH (package versions and peer-dependency compatibility VERIFIED against npm registry this session; NestJS/TypeORM code patterns CITED from official docs; refresh-token rotation/reuse-detection pattern and argon2 tuning numbers CITED from OWASP + cross-checked community sources)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 — Password Hashing:** Use `argon2` (not bcrypt) for password hashing — **Reversibility:** costly — changing the hashing algorithm after users exist requires either a forced password reset or a lazy re-hash-on-next-login migration; not a simple swap.

**D-02 — JWT Strategy:** Access token + refresh token (not access-token-only) — **Reversibility:** costly — removing refresh tokens later changes the client contract (clients expect a refresh endpoint) and touches the auth module's core flow.

**D-03 — Access token expiration:** 15 minutes.

**D-04 — Refresh token:** 7 days, stored as a hash in the database (not stateless) — enables revocation (real logout) and rotation on each use. **Reversibility:** costly — switching to stateless refresh tokens later removes the revocation capability and changes the DB schema.

**D-05 — Error Responses:** Login failure returns a generic error ("credenciais inválidas") regardless of whether the email exists or the password is wrong — prevents user enumeration.

**D-06 — Rate limiting:** `@nestjs/throttler` applied to `/auth/login` and `/auth/register` from this phase, not deferred to a later security pass.

### Claude's Discretion

- Exact DTO/entity field names, module file layout — follow `nestjs-conventions` skill conventions (module/controller/service/dto/entities per domain).
- Refresh token rotation implementation detail (e.g., whether to invalidate all prior refresh tokens on rotation, or just the one used) — pick the standard rotate-and-invalidate-the-used-token pattern unless research surfaces a stronger reason otherwise. **Research finding (see Pattern 3 below): the standard pattern is retained as the default per-rotation behavior, with reuse detection as an additive safety net — presenting an already-rotated (revoked) token triggers full-family revocation. This does not contradict the base decision; it only activates on the abuse case the base pattern doesn't cover.**
- Signup → login flow: no email verification gate in this phase (not discussed as a gray area — no SES/email sending is in scope per PROJECT.md; user can log in immediately after signup).

### Deferred Ideas (OUT OF SCOPE)

- Email verification before login — explicitly not in this phase's scope (no SES/email sending yet per PROJECT.md); revisit if/when the CSV/S3/Lambda/SES extension is picked up.

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | User can sign up with email and password (hash bcrypt/argon2, never plaintext) | argon2 hashing config (Standard Stack, Code Examples), `User` entity design (Architecture Patterns → Pattern 4), `RegisterDto` validation via class-validator |
| AUTH-02 | User can log in and receive a JWT that authenticates subsequent requests | `LocalStrategy` + `JwtStrategy` + `JwtAuthGuard` pattern (Architecture Patterns → Pattern 1), access+refresh token issuance (Code Examples) |
| AUTH-03 | User session is stateless via JWT (no server-side session persistence) | Access token is fully self-contained/stateless (Architecture Patterns → Pattern 1); see Open Questions for the documented, user-sanctioned scoped exception for refresh tokens (D-04) |
| AUTH-04 | User can only access their own data — every domain entity scoped by `userId`, enforced at the service layer, never trusting client-supplied IDs | `userId`-scoped repository pattern (Architecture Patterns → Pattern 2), `@CurrentUser()` decorator (Code Examples), Common Pitfalls → IDOR section |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Tech stack is locked and non-negotiable: NestJS + TypeScript, PostgreSQL (RDS), TypeORM, Docker multi-stage build.
- NestJS core pinned to **^11.2.3** (NOT v12) — v12 was ~2 weeks old at last research and the ecosystem (Swagger CLI plugin, ts-jest) hadn't caught up yet.
- TypeScript pinned to **^6.0.3** (NOT 7.x) — 7.x has no stable programmatic compiler API yet; `nest build`/`ts-jest` depend on it.
- Node.js target: **24.x (Active LTS)**.
- `synchronize: true` is forbidden in any environment touching shared data — migrations only, generated via `typeorm migration:generate`.
- Every entity carries `userId`; services never read `Request` directly — controller extracts `userId` and passes it explicitly into every service method call (`nestjs-conventions` skill, already a hard rule, reinforced by this phase's research).
- Every API response follows a consistent format (`ResponseDto` or response interceptor).
- Env vars validated at boot (`@nestjs/config` + Zod `validate()`) — app must refuse to start with missing/malformed env.
- Security checklist (`security-review` skill) must be run and explicitly reported (✅ Applied / ⚠️ Attention) before this phase is considered done — this includes: DTO validation on every endpoint, parameterized queries only, no hardcoded secrets, IDOR check on every resource endpoint, rate limiting on login/register, no `*` CORS, no stack-trace leakage in error responses, hashed passwords (never plaintext/weak hash), short-lived JWT with refresh handled separately.
- Every new service needs at least one unit test (happy path + one error case); business-logic endpoints need integration tests (`nestjs-conventions` skill).

## Summary

This phase builds the NestJS auth module (`src/auth/`) and the `User`/`RefreshToken` entities that every later domain module depends on for the `userId`-scoping pattern. The implementation is a standard NestJS Passport setup — `LocalStrategy` for `/auth/login` credential checking, `JwtStrategy` + `JwtAuthGuard` for protecting all subsequent routes — layered with three project-specific hardening requirements already locked in CONTEXT.md: argon2id password hashing, a database-backed (hashed, revocable) refresh token alongside a stateless 15-minute access token, and a generic login error message that prevents user enumeration.

The one piece of real design work in this phase — beyond wiring the standard Passport recipe — is the refresh token lifecycle: how it's stored (hash, not plaintext, using **fast SHA-256**, not argon2, because the token itself is a high-entropy random secret, not a low-entropy user password), how rotation works (issue-and-revoke-the-used-token per D-04's discretion default), and how reuse is detected and responded to (revoke the whole token family when an already-used token is replayed — the industry-standard signal that a refresh token has been stolen). All of this is package-application, not hand-rolled cryptography: `@nestjs/jwt` signs/verifies, `argon2` hashes passwords, Node's built-in `crypto` module generates the random refresh token value, and `class-validator`/`class-transformer` handle input validation and response shaping.

**Primary recommendation:** Use `@nestjs/passport` + `passport-jwt` + `passport-local` + `@nestjs/jwt` for the auth flow exactly as NestJS's own docs demonstrate, `argon2` (`argon2id`, OWASP's minimum-recommended params) for password hashing, a `RefreshToken` entity storing a SHA-256 hash of the token value (not the argon2 hash — different threat model), and `@nestjs/throttler`'s per-route `@Throttle()` decorator on `/auth/login` and `/auth/register` specifically, registered via a global `ThrottlerModule.forRoot()` + `APP_GUARD` so the pattern is available to every future endpoint too.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| User signup / credential storage | API / Backend | Database / Storage | `AuthService` validates + hashes via argon2; `User` entity persists the hash — no client-side or CDN involvement in a pure JSON API |
| Login / JWT issuance | API / Backend | — | `LocalStrategy` + `AuthService.login()` issue signed tokens; stateless verification needs no DB round-trip for the access token |
| Session validation (guarding routes) | API / Backend | — | `JwtStrategy` + `JwtAuthGuard` run per-request in the Nest request pipeline; no session store involved |
| Refresh token revocation/rotation | API / Backend | Database / Storage | Revocability is the entire reason D-04 chose a DB-backed refresh token — the `RefreshToken` table is the source of truth for "is this refresh token still valid" |
| Per-user data isolation (`userId` scoping) | API / Backend | Database / Storage | Enforced at the service layer (query `WHERE userId = :userId`) per project convention; the DB provides the indexed column that makes it fast, not the isolation guarantee itself (that's app-layer discipline, not RLS) |
| Rate limiting on auth endpoints | API / Backend | — | `@nestjs/throttler`'s `ThrottlerGuard` runs in the same Nest request pipeline as the auth guards; no external WAF/CDN rate limiting in scope for this phase |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@nestjs/jwt` | `^11.0.2` (verified compatible up to and including `12.0.1` — see note below) | JWT signing/verification | The idiomatic NestJS wrapper around `jsonwebtoken`; integrates with `JwtModule.registerAsync()` and DI. [VERIFIED: npm registry — `npm view @nestjs/jwt@11.0.2 peerDependencies` returns `{"@nestjs/common": "^8.0.0 \|\| ^9.0.0 \|\| ^10.0.0 \|\| ^11.0.0"}`, and `12.0.1`'s peer range additionally includes `^12.0.0`, so either version line is safe against the project's pinned `@nestjs/core@^11.2.3`.] |
| `@nestjs/passport` | `^11.0.5` (verified compatible up to and including `12.0.0`) | Passport strategy integration for Nest's DI/guard system | Standard bridge between Passport strategies and Nest `Guard`s (`AuthGuard('local')`, `AuthGuard('jwt')`). [VERIFIED: npm registry — `12.0.0`'s peerDependencies are `{"passport": "^0.5.0 \|\| ^0.6.0 \|\| ^0.7.0", "@nestjs/common": "^11.0.0 \|\| ^12.0.0"}` — compatible with the locked v11 core either way.] |
| `passport-jwt` | `^4.0.1` | Passport strategy: extracts + verifies JWT from `Authorization: Bearer` header | De facto standard; `ExtractJwt.fromAuthHeaderAsBearerToken()` is the documented extraction method. [VERIFIED: npm registry] |
| `passport-local` | `^1.0.0` | Passport strategy: username/password credential check for `/auth/login` | De facto standard for the login-form-style strategy NestJS's own docs use. [VERIFIED: npm registry] |
| `argon2` | `^0.45.1` | Password hashing (per D-01) | OWASP's current top recommendation; native module, Node-API based. [VERIFIED: npm registry — `npm view argon2 version` → `0.45.1`, published 2026-07-21, 1.7M weekly downloads, repo `github.com/ranisalt/node-argon2`, no `deprecated` flag] |
| `@nestjs/throttler` | `^6.5.0` | Rate limiting on `/auth/login` and `/auth/register` (per D-06) | Official NestJS rate-limiting module; `@Throttle()` decorator gives per-route overrides needed here. [VERIFIED: npm registry, peerDependencies `{"@nestjs/common": "^7..^11.0.0", "@nestjs/core": "^7..^11.0.0"}` — compatible with pinned core] |
| `class-validator` | `^0.15.1` | DTO validation (`RegisterDto`, `LoginDto`) | Project convention (`nestjs-conventions` skill), works with global `ValidationPipe`. [VERIFIED: npm registry] |
| `class-transformer` | `^0.5.1` | Strip `passwordHash`/internal fields from API responses (`@Exclude()`), DTO↔entity mapping | Companion to `class-validator`; required to keep `passwordHash` out of every response, a direct security-checklist item. [VERIFIED: npm registry] |
| Node.js built-in `crypto` | (Node 24.x stdlib) | Generate the raw refresh token value (`crypto.randomBytes(64).toString('hex')`) and hash it (`crypto.createHash('sha256')`) before storing | No external package needed — high-entropy random generation and fast hashing are both stdlib. [CITED: Node.js `crypto` module docs — standard API, no version-specific behavior relevant here] |

**Note on `@nestjs/jwt`/`@nestjs/passport`/`@nestjs/config` version drift:** `npm view` (run this session) shows the *latest* tags for these three packages have moved to a `12.x` line (`@nestjs/jwt@12.0.1`, `@nestjs/passport@12.0.0`, `@nestjs/config@12.0.0`) since the project-level STACK.md research was written. All three verified peer-compatible with the pinned `@nestjs/core@^11.2.3` (their peer ranges accept `^11.0.0 || ^12.0.0`). **Recommendation: stay on the `^11.x` versions already pinned in `CLAUDE.md`/STACK.md for consistency with the rest of the locked v11 stack** — there is no functional reason to take the newer majors mid-project, but if the planner wants the latest patches, both lines are confirmed safe against the core version.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@nestjs/config` | `^4.0.4` | Load `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` from env, validated by Zod at boot | Always, per project convention — the app must refuse to start if a JWT secret is missing |
| `zod` | `^4.6.2` | Env schema for the above | Already the project's chosen env-validation library (STACK.md) |
| `uuid` (or TypeORM's `@PrimaryGeneratedColumn('uuid')`) | n/a — use TypeORM's built-in UUID column generator | Primary keys for `User`/`RefreshToken` | Prefer `@PrimaryGeneratedColumn('uuid')` (Postgres-native `gen_random_uuid()`/`uuid-ossp`) over pulling in the `uuid` npm package for entity PKs — one less dependency, same guarantee. `npm view uuid` this session flagged `[SUS: too-new]` on the legitimacy check (huge 206M/week download count, but the seam's "too-new" heuristic fired on a recent patch release) — moot if TypeORM's built-in generator is used instead, since then this package isn't installed at all for this phase. |
| `@nestjs/swagger` | `^11.4.7` | Document `/auth/register`, `/auth/login`, `/auth/refresh` endpoints | Project standard for portfolio-facing API docs — not strictly required for AUTH-01..04 but keep consistent with later phases |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DB-backed hashed refresh token (D-04, locked) | Stateless refresh token (JWT with long expiry, no DB row) | Rejected by the user's own locked decision — would remove revocability, which D-04 explicitly wants. Not re-litigated here. |
| SHA-256 hash for refresh token storage | argon2/bcrypt hash for refresh token storage | argon2/bcrypt's deliberate slowness protects against **brute-forcing a low-entropy secret** (a password). A refresh token is already a 512-bit random value — there's no dictionary to defend against, so the slow KDF just adds latency to every refresh call for no security gain. SHA-256 (fast, deterministic) is the documented right tool for this specific case. [CITED: cross-checked community sources — see Sources] |
| Rotate-and-invalidate-the-used-token only (D-04 discretion default) | Full token-family invalidation on every rotation | Rejected as the *default* per CONTEXT.md's own guidance ("unless research surfaces a stronger reason") — full-family-per-rotation is unnecessarily disruptive (forces re-login on every silent refresh). The stronger reason research did surface is scoped narrower: use reuse-detection (see Pattern 3) as the trigger for family invalidation, not every normal rotation. |

**Installation:**
```bash
npm install @nestjs/jwt@^11.0.2 @nestjs/passport@^11.0.5 passport@^0.7.0 \
  passport-jwt@^4.0.1 passport-local@^1.0.0 \
  argon2@^0.45.1 @nestjs/throttler@^6.5.0 \
  class-validator@^0.15.1 class-transformer@^0.5.1 \
  @nestjs/config@^4.0.4 zod@^4.6.2

npm install -D @types/passport-jwt @types/passport-local
```

**Version verification:** All versions above were confirmed via `npm view <pkg> version` / `npm view <pkg> peerDependencies --json` against the live npm registry during this research session (2026-09-11) — see the `[VERIFIED: npm registry]` tags above for the specific commands and returned values.

## Package Legitimacy Audit

| Package | Registry | Age (latest publish) | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|----------------------|-----------|--------------|---------|-------------|
| `argon2` | npm | 2026-07-21 | 1,718,803/wk | github.com/ranisalt/node-argon2 | OK | Approved |
| `@nestjs/jwt` | npm | 2026-08-27 | 3,348,315/wk | github.com/nestjs/jwt | SUS (`too-new` heuristic) | Approved — flagged only by the "too-new" publish-date heuristic; 3.3M weekly downloads and the official `nestjs` GitHub org repo make this a false positive, but flagging per protocol |
| `@nestjs/passport` | npm | 2026-08-27 | 3,134,297/wk | github.com/nestjs/passport | SUS (`too-new` heuristic) | Approved — same false-positive pattern as above (official `nestjs` org, 3.1M weekly downloads) |
| `passport-jwt` | npm | 2022-12-24 | 3,024,902/wk | github.com/mikenicholson/passport-jwt | OK | Approved |
| `passport-local` | npm | 2014-03-08 | 1,616,629/wk | github.com/jaredhanson/passport-local | OK | Approved |
| `@nestjs/throttler` | npm | 2025-12-02 | 2,886,054/wk | github.com/nestjs/throttler | OK | Approved |
| `class-validator` | npm | 2026-02-26 | 8,514,825/wk | github.com/typestack/class-validator | OK | Approved |
| `class-transformer` | npm | 2021-11-22 | 9,145,184/wk | github.com/typestack/class-transformer | OK | Approved |
| `uuid` | npm | 2026-08-18 | 206,345,647/wk | github.com/uuidjs/uuid | SUS (`too-new` heuristic) | **Not needed this phase** — use TypeORM's `@PrimaryGeneratedColumn('uuid')` instead; if a later phase needs the `uuid` package directly, re-run this check then |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `@nestjs/jwt`, `@nestjs/passport`, `uuid` — all three verdicts are the legitimacy seam's "too-new" heuristic firing on official, extremely high-download packages that simply had a recent version bump (the `@nestjs/*` packages are official `nestjs` GitHub-org packages that release in lockstep with the framework; `uuid` has 206M weekly downloads). **Recommend the planner still insert a lightweight `checkpoint:human-verify` before installing `@nestjs/jwt`/`@nestjs/passport`** per protocol, even though the evidence strongly suggests false positives — `uuid` is moot since this phase doesn't need it (see Supporting table).

## Architecture Patterns

### System Architecture Diagram

```
Client
  │
  │ POST /auth/register {email, password}
  ▼
RegisterDto (class-validator) ──reject if invalid──► 400
  │ valid
  ▼
AuthController.register()
  │
  ▼
AuthService.register(email, password)
  │
  ├─► argon2.hash(password, {type: argon2id, ...}) ──► passwordHash
  │
  ▼
UsersRepository.save({email, passwordHash}) ──► User row (Postgres)
  │
  ▼
201 Created (UserResponseDto — passwordHash excluded)


Client
  │
  │ POST /auth/login {email, password}
  ▼
ThrottlerGuard (rate limit check) ──over limit──► 429
  │ under limit
  ▼
LocalAuthGuard → LocalStrategy.validate(email, password)
  │
  ▼
AuthService.validateUser(email, password)
  │
  ├─► UsersRepository.findOne({email})
  │     │
  │     ├─ not found → argon2.verify(DUMMY_HASH, password) [timing-attack mitigation] → throw UnauthorizedException("credenciais inválidas")
  │     └─ found → argon2.verify(user.passwordHash, password)
  │                  ├─ mismatch → throw UnauthorizedException("credenciais inválidas")
  │                  └─ match → return user
  ▼
AuthService.login(user)
  │
  ├─► JwtService.signAsync({sub: user.id}, {secret: ACCESS_SECRET, expiresIn: '15m'}) ──► accessToken
  │
  ├─► crypto.randomBytes(64).toString('hex') ──► rawRefreshToken
  ├─► sha256(rawRefreshToken) ──► refreshTokenHash
  └─► RefreshTokenRepository.save({userId, tokenHash: refreshTokenHash, expiresAt: now+7d})
  │
  ▼
200 OK {accessToken, refreshToken: rawRefreshToken}


Client (any protected route)
  │
  │ GET /accounts   Authorization: Bearer <accessToken>
  ▼
JwtAuthGuard → JwtStrategy.validate(payload)
  │  (no DB lookup — stateless verification via signature + expiry)
  ▼
request.user = {userId: payload.sub}
  │
  ▼
@CurrentUser() userId ──► Controller ──► Service(userId, ...) ──► Repository.find({where: {userId, ...}})


Client
  │
  │ POST /auth/refresh {refreshToken: rawRefreshToken}
  ▼
sha256(rawRefreshToken) ──► presentedHash
  │
  ▼
RefreshTokenRepository.findOne({tokenHash: presentedHash})
  │
  ├─ not found → 401 (token never existed / already deleted)
  │
  ├─ found, revokedAt IS NOT NULL → REUSE DETECTED
  │     └─► RefreshTokenRepository.revokeAllForUser(userId) [family invalidation]
  │         └─► 401 (force full re-login)
  │
  └─ found, revokedAt IS NULL, not expired
        ├─► mark this row revoked (revokedAt = now)
        ├─► issue new accessToken + new rawRefreshToken (same flow as login)
        └─► 200 OK {accessToken, refreshToken: newRawRefreshToken}
```

### Recommended Project Structure

```
src/
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts          # /auth/register, /auth/login, /auth/refresh, /auth/logout
│   ├── auth.service.ts             # validateUser, register, login, refresh, logout
│   ├── strategies/
│   │   ├── local.strategy.ts       # LocalStrategy — validates email+password
│   │   └── jwt.strategy.ts         # JwtStrategy — verifies access token, attaches req.user
│   ├── guards/
│   │   ├── local-auth.guard.ts     # extends AuthGuard('local')
│   │   └── jwt-auth.guard.ts       # extends AuthGuard('jwt')
│   ├── decorators/
│   │   └── current-user.decorator.ts   # @CurrentUser() — extracts userId from request.user
│   ├── dto/
│   │   ├── register.dto.ts         # email, password (class-validator)
│   │   ├── login.dto.ts            # email, password
│   │   ├── refresh.dto.ts          # refreshToken
│   │   └── user-response.dto.ts    # id, email, createdAt — never passwordHash
│   └── entities/
│       ├── user.entity.ts          # id, email (unique), passwordHash, createdAt, updatedAt
│       └── refresh-token.entity.ts # id, userId (indexed FK), tokenHash (unique), expiresAt, revokedAt, createdAt
├── common/
│   └── interceptors/
│       └── response.interceptor.ts # consistent ResponseDto envelope (project convention)
├── config/
│   └── env.validation.ts           # Zod schema incl. JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, etc.
└── database/
    └── migrations/                 # generated migrations for User + RefreshToken tables
```

### Structure Rationale

Follows the `nestjs-conventions` skill's module layout exactly (`module.ts`/`controller.ts`/`service.ts`/`dto/`/`entities/` per domain) with `strategies/`, `guards/`, and `decorators/` as auth-specific subfolders — this matches the pattern shown in `ARCHITECTURE.md`'s recommended project structure and is the only module in this phase, so there's no cross-module dependency direction to design yet (that starts in Phase 2 when `Accounts`/`Transactions` depend on `Auth`'s guard).

### Pattern 1: `userId`-scoped multi-tenancy via controller-injected `@CurrentUser()`

**What:** `JwtStrategy.validate(payload)` returns `{ userId: payload.sub }`; a `@CurrentUser()` param decorator reads `request.user.userId` in the controller and passes it explicitly as the first argument to every service method. Services never inject `@Req()` or read `Request` directly.

**When to use:** Every domain module from this phase forward — this phase's job is to establish the pattern the accounts/categories/transactions/budgets/reports modules (Phases 2–6) will all reuse.

**Example:**
```typescript
// Source: NestJS official docs (docs.nestjs.com/recipes/passport) + project's own nestjs-conventions skill
// current-user.decorator.ts
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.user.userId;
  },
);

// jwt.strategy.ts
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: { sub: string }) {
    return { userId: payload.sub };
  }
}

// jwt-auth.guard.ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```
[CITED: docs.nestjs.com/recipes/passport — `JwtStrategy`/`AuthGuard` pattern fetched and verified this session]

### Pattern 2: Generic login error + timing-attack mitigation (D-05)

**What:** `LocalStrategy`/`AuthService.validateUser()` must throw the identical `UnauthorizedException('credenciais inválidas')` whether the email doesn't exist or the password is wrong — AND must take a comparable amount of time in both branches, otherwise an attacker can distinguish "user exists" from "user doesn't exist" purely by measuring response latency (argon2 verification is deliberately slow; skipping it when the user isn't found makes that branch measurably faster).

**When to use:** `AuthService.validateUser()`, this phase only (the only place credentials are checked).

**Example:**
```typescript
// auth.service.ts
// A fixed, pre-computed dummy hash — NOT tied to any real user, generated once at module load
// or hardcoded as an env-configured constant, so a non-existent-user lookup still pays the
// argon2 cost and the two branches are timing-indistinguishable.
async validateUser(email: string, password: string): Promise<User> {
  const user = await this.usersRepository.findOne({ where: { email } });
  const hashToVerify = user?.passwordHash ?? this.dummyHash;
  const isValid = await argon2.verify(hashToVerify, password);

  if (!user || !isValid) {
    throw new UnauthorizedException('credenciais inválidas');
  }
  return user;
}
```
[ASSUMED: the dummy-hash timing mitigation is a well-known technique for this exact class of bug (user-enumeration via login timing), but it was not found stated as an explicit step in any single official source fetched this session — treat as a recommended hardening addition on top of D-05's already-locked generic-error-message requirement, not a re-litigation of D-05 itself]

### Pattern 3: Refresh token rotation with reuse detection

**What:** Each `/auth/refresh` call (a) hashes the presented token and looks it up, (b) if found and not yet revoked, marks it revoked and issues a brand-new access+refresh pair (standard rotate-and-invalidate-the-used-token, matching D-04's discretion default), (c) if the presented token's hash IS found but already marked revoked, that's a replay of an already-rotated token — the standard signal a refresh token was stolen and both the legitimate user and the attacker are now racing to use it. The response is to revoke every refresh token belonging to that `userId` (not just the one presented), forcing a full re-login everywhere.

**When to use:** `AuthService.refresh()`, this phase only.

**Trade-offs:** Slightly more DB writes per refresh (one `UPDATE` to revoke + one `INSERT` for the new token, vs. a stateless refresh that needs neither) — this is exactly the cost D-04 already accepted in exchange for revocability, so no new trade-off is introduced by adding reuse detection on top.

**Example:**
```typescript
// refresh-token.entity.ts
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  userId: string;

  @Column({ unique: true })
  tokenHash: string; // sha256 hex digest of the raw refresh token

  @Column()
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}

// auth.service.ts (refresh flow)
async refresh(rawRefreshToken: string) {
  const tokenHash = this.hashToken(rawRefreshToken);
  const stored = await this.refreshTokenRepo.findOne({ where: { tokenHash } });

  if (!stored) throw new UnauthorizedException();

  if (stored.revokedAt) {
    // Reuse of an already-rotated token — treat as compromise.
    await this.refreshTokenRepo.update({ userId: stored.userId, revokedAt: IsNull() }, { revokedAt: new Date() });
    throw new UnauthorizedException();
  }

  if (stored.expiresAt < new Date()) throw new UnauthorizedException();

  await this.refreshTokenRepo.update(stored.id, { revokedAt: new Date() });
  return this.issueTokenPair(stored.userId); // new access + new refresh, new RefreshToken row
}

private hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
```
[CITED: Auth0 refresh-token-rotation docs (auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation) — "token family" reuse-detection pattern, cross-checked against 3+ independent community sources this session, confidence MEDIUM per the classify-confidence seam's verified-websearch tier]

### Pattern 4: `User` entity — password never leaves the service layer as plaintext or in responses

**What:** `passwordHash` is a real column but must never appear in any API response. Use `class-transformer`'s `@Exclude()` on the entity (paired with global `ClassSerializerInterceptor`) or a dedicated `UserResponseDto` that simply omits the field.

**Example:**
```typescript
// user.entity.ts
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  @Index()
  email: string;

  @Exclude()
  @Column()
  passwordHash: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```
[CITED: typeorm.io/docs/entity/entities — `@Column({unique: true})`, `@CreateDateColumn`/`@UpdateDateColumn` syntax fetched and verified this session]

### Anti-Patterns to Avoid

- **Hashing the refresh token with argon2 instead of SHA-256:** Wastes CPU on every single refresh call for zero security benefit — argon2's slowness defends against brute-forcing a *guessable* secret, and a 512-bit random token isn't guessable. Use fast SHA-256 for this specific case (see Alternatives Considered).
- **Reading `Request` directly in a service to get `userId`:** Already forbidden by the `nestjs-conventions` skill and `ARCHITECTURE.md`'s Anti-Pattern 2 — makes services request-scoped (perf cost) and makes the isolation boundary easy to forget in new methods (the root cause of IDOR bugs, per `PITFALLS.md` Pitfall 3).
- **Different error messages/response codes for "email not found" vs "wrong password":** Directly violates D-05; also don't let response **timing** leak the same information even if the message is generic (see Pattern 2).
- **Storing the raw refresh token value in the DB:** Defeats the purpose of hashing it — if the DB is ever read (backup leak, SQL injection, insider access), raw tokens let an attacker impersonate every user immediately. Always store only the hash, exactly as done for the access-token-signing secret's own handling (never logged, never in plaintext at rest).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Password hashing/verification | Custom PBKDF2 loop, custom salt handling | `argon2` package's `hash()`/`verify()` | Argon2's memory-hard KDF and salt management are exactly the kind of security-critical primitive where a hand-rolled version reliably gets subtle details wrong (salt reuse, insufficient work factor, timing side-channels) |
| JWT signing/verification | Manual HMAC-SHA256 + base64 encode/decode | `@nestjs/jwt` (wraps `jsonwebtoken`) | Handles algorithm confusion attacks, expiry checks, and standard claim validation correctly out of the box |
| Extracting/parsing the Bearer token from the Authorization header | Custom header-parsing middleware | `passport-jwt`'s `ExtractJwt.fromAuthHeaderAsBearerToken()` | One-line, battle-tested, handles malformed-header edge cases |
| Rate limiting | In-memory counter + manual IP tracking | `@nestjs/throttler` | Handles storage backend abstraction (swap in Redis later without touching route code), per-route override syntax, and the tricky "what counts as the same client" logic |
| Random token generation | `Math.random()`-based token strings | Node's built-in `crypto.randomBytes()` | `Math.random()` is not cryptographically secure — a hand-rolled refresh token generator using it is guessable, defeating the entire purpose of D-04's revocable-token design |
| Env var validation at boot | Manual `if (!process.env.X) throw ...` chains | Zod schema inside `@nestjs/config`'s `validate()` | Already the project convention (STACK.md, CLAUDE.md) — one schema, typed `ConfigService.get<T>()`, fails fast with a clear message listing every missing var at once |

**Key insight:** Every piece of hand-rolled logic in an auth module is a piece of security-critical code reviewed by nobody but this project — every item above has an existing, widely-audited library that already handles the edge cases (timing attacks, algorithm confusion, salt reuse) a first implementation is statistically likely to miss.

## Common Pitfalls

### Pitfall 1: Timing-attack user enumeration despite a generic error message

**What goes wrong:** D-05's generic error message ("credenciais inválidas") is implemented correctly for the *message*, but the code still returns faster when the email doesn't exist (skips the argon2 verify call entirely) than when it exists but the password is wrong (runs the ~250ms-class argon2 verify). An attacker scripting login attempts can still enumerate valid emails by measuring response time, even though the error text never differs.

**Why it happens:** The natural early-return code (`if (!user) throw ...`) is the simplest thing to write and passes every functional test — the timing difference only shows up under instrumented/scripted measurement, not manual testing.

**How to avoid:** Always call `argon2.verify()` — against a real hash if the user exists, against a fixed dummy hash if not (see Pattern 2) — so both branches do comparable work before returning.

**Warning signs:** An `if (!user) throw new UnauthorizedException(...)` that returns before any call to `argon2.verify()`.

### Pitfall 2: `@nestjs/throttler`'s `ttl` unit confusion (seconds vs milliseconds)

**What goes wrong:** `@nestjs/throttler` v6's `ttl` option is in **milliseconds** (a change from earlier major versions which used seconds) — copying an older tutorial's `ttl: 60` (intending 60 seconds) actually configures a 60-**millisecond** window, effectively disabling rate limiting (the limit resets almost instantly).

**Why it happens:** Many older blog posts/tutorials predate the seconds→milliseconds change and are still the top search results.

**How to avoid:** Use the package's own `seconds()`/`minutes()` helper functions (`import { seconds } from '@nestjs/throttler'`) instead of raw numbers, or double-check any copied `ttl` value against the v6 docs. [CITED: docs.nestjs.com/security/rate-limiting, fetched this session — confirms `ttl` is "the time to live in milliseconds"]

**Warning signs:** A `ttl` value that looks like a small round number (`10`, `60`) without a comment clarifying the unit.

### Pitfall 3: Rate limiting applied globally but silently bypassed on `/auth/register`

**What goes wrong:** `@Throttle()` is added to the login route during development (the "obvious" brute-force target) and the register route is forgotten — but unauthenticated signup spam (creating many accounts) is exactly as real a threat and D-06 explicitly names both endpoints.

**How to avoid:** Add `@Throttle()` to both `/auth/login` and `/auth/register` in the same PR/commit, and include both in the phase's security-checklist verification, not just login.

**Warning signs:** `security-review` skill checklist item "Rate limiting configurado em endpoints públicos (login, cadastro)" checked off after only testing `/auth/login`.

### Pitfall 4: `argon2` native module build failing in the Docker build stage (deferred risk, flagged now)

**What goes wrong:** `argon2` is a native Node addon (napi bindings, `node-gyp-build` install script) — this doesn't affect local development on a normal machine, but the project's later Docker/Alpine build stage needs either a prebuilt binary for the target platform or a working native toolchain in the builder stage. This phase doesn't touch Docker, but the dependency choice happens here.

**How to avoid:** Not an action item for this phase (no Dockerfile yet) — but note it as a carry-forward risk for the Containerization phase (Phase 7), consistent with STACK.md's existing guidance on `bcrypt`'s equivalent native-module concern.

**Warning signs:** `npm install` failing during Docker build with `node-gyp` / Python / build-essential errors — not expected on `npm install` locally on a normal dev machine.

## Code Examples

### Global `ValidationPipe` setup (main.ts)
```typescript
// Source: NestJS community pattern, cross-checked across multiple sources this session (MEDIUM confidence)
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,              // strips properties not in the DTO
    forbidNonWhitelisted: true,   // 400s on unexpected extra fields, not silent-strip
    transform: true,              // payload -> DTO instance, enables typed DTOs in controllers
  }),
);
```

### `ThrottlerModule` registration + per-route override
```typescript
// Source: docs.nestjs.com/security/rate-limiting, fetched and verified this session
// app.module.ts
@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 100 }], // sane global default (100 req/min)
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

// auth.controller.ts — tighter limits on the two sensitive endpoints (D-06)
@Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 attempts / 60s
@Post('login')
login(@Body() dto: LoginDto) { ... }

@Throttle({ default: { limit: 3, ttl: 60000 } }) // 3 signups / 60s
@Post('register')
register(@Body() dto: RegisterDto) { ... }
```
[ASSUMED: the specific numeric limits (5/60s for login, 3/60s for register) are a reasonable starting point but not sourced from an authoritative "correct number" — no such universal number exists; flag for the planner as a tunable default, add to Assumptions Log]

### argon2 hashing with OWASP-minimum parameters
```typescript
// Source: OWASP Password Storage Cheat Sheet, fetched and verified this session
import * as argon2 from 'argon2';

const passwordHash = await argon2.hash(plainPassword, {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB — OWASP minimum-recommended
  timeCost: 2,
  parallelism: 1,
});

const isValid = await argon2.verify(passwordHash, plainPassword);
```
[CITED: cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html — "m=19456 (19 MiB), t=2, p=1 (minimum recommended)" among several equal-strength configs trading CPU for RAM, fetched and verified this session]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| bcrypt as the default password hash | argon2id as OWASP's top recommendation | Ongoing OWASP guidance shift, reaffirmed in current cheat sheet | Already reflected in D-01 — no action, just context for why argon2 was the right call |
| `@nestjs/throttler` `ttl` in seconds | `ttl` in milliseconds (v5+) | Confirmed against current (v6.5.0) docs this session | Existing tutorials/StackOverflow answers using pre-v5 syntax will silently misconfigure the rate limit if copied verbatim (see Pitfall 2) |

**Deprecated/outdated:** None directly relevant beyond the throttler `ttl` unit change above.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | Dummy-hash timing-attack mitigation for non-existent users (Pattern 2) is a recommended addition, not explicitly documented as a required step in any single official source checked this session | Architecture Patterns → Pattern 2, Common Pitfalls → Pitfall 1 | Low — if skipped, D-05's stated goal (prevent enumeration) is only partially achieved via message text; timing side-channel remains. Worth a deliberate accept/reject decision at plan time, not a silent gap. |
| A2 | Specific numeric rate limits (5 login attempts / 60s, 3 registrations / 60s) are a reasonable starting point, not a sourced "correct" number | Code Examples → ThrottlerModule | Low — too strict locks out legitimate users retrying a typo; too loose weakens brute-force protection. Easy to tune post-launch since it's a single decorator argument. |
| A3 | `@nestjs/jwt`/`@nestjs/passport`'s newly-released `12.x` lines being peer-compatible with the pinned `@nestjs/core@^11.2.3` was confirmed via `npm view ... peerDependencies` this session, but the recommendation to *stay* on the `^11.x` versions already in CLAUDE.md is a judgment call, not a verified requirement | Standard Stack → Core (version-drift note) | Low — either version line installs and runs correctly per the verified peer ranges; the only cost of picking wrong is minor version-consistency drift within the project's own dependency tree. |

## Open Questions (RESOLVED)

1. **AUTH-03 ("stateless session") vs. D-04 (DB-backed refresh token) — is this a real conflict? RESOLVED:**
   - What we know: AUTH-03's requirement text says "sem persistência de sessão no servidor" (no server-side session persistence). D-04 (a locked CONTEXT.md decision) explicitly stores a refresh token hash in the DB.
   - What's unclear: Whether AUTH-03 should be read as "the *access* token / primary auth mechanism is stateless" (satisfied — the access token needs no DB lookup to verify) or as an absolute "zero DB rows related to auth session state" (not satisfied by D-04).
   - Recommendation: Treat AUTH-03 as satisfied by the access token's statelessness — this is consistent with how the phase description frames it ("AUTH-03 (stateless session)" listed alongside "AUTH-02 (login+JWT)" as a JWT-mechanism requirement, not a blanket "no auth-related DB tables" requirement) and D-04 is a later, more specific, explicitly-locked decision that a reasonable person reads as the user consciously accepting this scoped exception in exchange for revocability. Flag this reasoning to the planner so it's an explicit, visible call rather than a silent assumption — no code change is implied, just documentation of the interpretation.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| npm registry access | Installing all packages above | ✓ | — | — |
| Node.js 24.x | Running the app locally | Not probed this session — greenfield repo, no `package.json`/`node_modules` yet | — | Wave 0 task: confirm local Node version matches `engines` requirement before first `npm install` |
| PostgreSQL (local, via Docker Compose per STACK.md) | `User`/`RefreshToken` persistence | Not probed this session — no `docker-compose.yml` present yet | — | Wave 0 task: local Postgres via Docker Compose, per STACK.md's existing recommendation |

**Missing dependencies with no fallback:** None identified — this phase has no dependency without a documented fallback/setup path.

**Missing dependencies with fallback:** Node.js/PostgreSQL local availability wasn't probed (fully greenfield repo, nothing to detect yet) — both already have an established setup path from project-level STACK.md; treat as Wave 0 scaffolding tasks, not a research gap.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest (per STACK.md — default for NestJS v11/CommonJS projects) |
| Config file | none — Wave 0 (no `package.json` exists yet; this is a fully greenfield repo) |
| Quick run command | `npm run test -- auth` (once scaffolded) |
| Full suite command | `npm run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| AUTH-01 | Signup hashes password with argon2, never stores/returns plaintext | unit | `npm run test -- auth.service.spec.ts -t "register"` | ❌ Wave 0 |
| AUTH-01 | `passwordHash` never appears in the register response body | integration | `npm run test:e2e -- auth.e2e-spec.ts -t "register response excludes passwordHash"` | ❌ Wave 0 |
| AUTH-02 | Valid login returns access + refresh tokens; invalid login returns generic 401 | integration | `npm run test:e2e -- auth.e2e-spec.ts -t "login"` | ❌ Wave 0 |
| AUTH-02 | Login with wrong password and login with non-existent email return the identical error body | integration | `npm run test:e2e -- auth.e2e-spec.ts -t "generic credentials error"` | ❌ Wave 0 |
| AUTH-03 | A valid access token authorizes a protected route with no DB session lookup | unit/integration | `npm run test:e2e -- protected-route.e2e-spec.ts` | ❌ Wave 0 |
| AUTH-04 | Cross-tenant isolation: user A cannot access/modify user B's data via any endpoint this phase exposes | integration | `npm run test:e2e -- auth.e2e-spec.ts -t "cross-tenant"` | ❌ Wave 0 (this phase only has auth endpoints themselves to test against — the full cross-tenant suite per `PITFALLS.md` Pitfall 3 activates module-by-module starting Phase 2) |
| D-04 | Refresh token rotation: using a refresh token twice (reuse) invalidates the entire token family | integration | `npm run test:e2e -- auth.e2e-spec.ts -t "refresh token reuse detection"` | ❌ Wave 0 |
| D-06 | `/auth/login` and `/auth/register` both return 429 after exceeding the configured throttle limit | integration | `npm run test:e2e -- auth.e2e-spec.ts -t "rate limiting"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test -- auth` (unit tests for the module being touched)
- **Per wave merge:** `npm run test:e2e` (full e2e suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `package.json` + NestJS project scaffold (`@nestjs/cli new` or manual) — nothing exists yet
- [ ] `jest.config.js` / `test/jest-e2e.json` — standard NestJS CLI-generated config
- [ ] `docker-compose.yml` for local PostgreSQL, per STACK.md
- [ ] `test/auth.e2e-spec.ts` — covers AUTH-01..04 and D-04/D-06 per the table above
- [ ] `test/setup.ts` or equivalent — shared test DB setup/teardown (create/drop schema or truncate tables between tests)
- [ ] `src/config/env.validation.ts` — Zod schema including the four JWT env vars, so tests can boot the app with a known-good test env

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | yes | argon2id password hashing (D-01), generic login error (D-05), rate limiting on login/register (D-06) |
| V3 Session Management | yes | Short-lived (15 min) stateless access token (D-02/D-03), revocable hashed refresh token with rotation + reuse detection (D-04, Pattern 3) |
| V4 Access Control | yes | `userId`-scoped queries enforced at the service layer via `@CurrentUser()` (Pattern 1) — the pattern this whole phase exists to establish |
| V5 Input Validation | yes | `class-validator` DTOs (`RegisterDto`, `LoginDto`) with global `ValidationPipe({whitelist, forbidNonWhitelisted, transform})` |
| V6 Cryptography | yes | `argon2` for passwords (never hand-rolled), Node `crypto.randomBytes` for refresh token generation (never `Math.random()`), SHA-256 for refresh-token-at-rest hashing (fast hash chosen deliberately for a high-entropy secret, not a password) |

### Known Threat Patterns for NestJS + Passport JWT auth

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| User enumeration via differing login error messages or response timing | Information Disclosure | Generic error message (D-05) + timing-indistinguishable branches (Pattern 2) |
| Brute-force credential stuffing against `/auth/login` | Denial of Service / Elevation of Privilege | `@nestjs/throttler` on `/auth/login` (D-06) |
| Automated mass-account creation against `/auth/register` | Denial of Service | `@nestjs/throttler` on `/auth/register` (D-06) |
| Stolen refresh token used to mint unlimited new access tokens | Elevation of Privilege | Rotation + reuse detection revokes the whole token family on replay (Pattern 3) |
| IDOR — client-supplied `userId`/resource ID trusted without ownership check | Tampering / Information Disclosure | `@CurrentUser()` → service method signature requires `userId` on every query (Pattern 1); this phase's guard is the mechanism every later module's IDOR defense depends on |
| JWT algorithm confusion / signature bypass | Spoofing | `@nestjs/jwt`/`passport-jwt` handle algorithm pinning correctly out of the box — never hand-roll JWT verification (Don't Hand-Roll table) |

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view <pkg> version / peerDependencies / engines --json`) — direct verification of every package version, peer-compatibility claim, and legitimacy signal in this document, run this session against: `argon2`, `@nestjs/jwt` (both `11.0.2` and `12.0.1`), `@nestjs/passport` (both `11.0.5` and `12.0.0`), `passport-jwt`, `passport-local`, `@nestjs/throttler`, `class-validator`, `class-transformer`, `@nestjs/config`, `zod`, `uuid`, `@nestjs/core` (both `11.2.3` and `12.0.1`).
- `.claude/skills/nestjs-conventions/SKILLS.md`, `.claude/skills/security-review/SKILLS.md`, `.claude/CLAUDE.md` — project-authoritative constraints, read this session.

### Secondary (MEDIUM confidence — official docs, fetched and verified this session)
- [docs.nestjs.com/recipes/passport](https://docs.nestjs.com/recipes/passport) — `LocalStrategy`, `JwtStrategy`, `AuthGuard`, `JwtModule.register()` code patterns.
- [docs.nestjs.com/security/rate-limiting](https://docs.nestjs.com/security/rate-limiting) — `ThrottlerModule.forRoot()`, `@Throttle()`/`@SkipThrottle()` syntax, `ttl` in milliseconds confirmation.
- [typeorm.io/docs/entity/entities](https://typeorm.io/docs/entity/entities) — `@Column({unique: true})`, `@CreateDateColumn`/`@UpdateDateColumn`, `@OneToMany`/`@ManyToOne` syntax.
- [cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — Argon2id minimum-recommended parameters (m=19456, t=2, p=1, and equal-strength alternatives).
- [auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation) — token-family reuse-detection pattern.

### Tertiary (LOW confidence — WebSearch synthesis, cross-checked across multiple community sources but not a single authoritative source)
- SHA-256-vs-slow-KDF-for-high-entropy-tokens reasoning — cross-checked across `mojoauth.com`, `janeer.com`, and a GitHub issue thread (`markitosgv/JWTRefreshTokenBundle#289`) discussing the exact same design question; consistent conclusion across all three.
- Specific numeric rate-limit starting points (5/60s, 3/60s) — not sourced from an authoritative number, flagged in Assumptions Log (A2).
- Dummy-hash timing-mitigation technique (Pattern 2) — general security-engineering pattern, not found as an explicit step in the official sources checked; flagged in Assumptions Log (A1).

## Metadata

**Confidence breakdown:**
- Standard stack (package choices/versions): HIGH — every version and peer-compatibility claim verified directly against the npm registry this session.
- Architecture (Passport strategy/guard wiring, entity design): HIGH — core patterns fetched from official NestJS/TypeORM docs this session; refresh-token rotation/reuse-detection design is MEDIUM (industry-standard pattern, cross-checked, not from a NestJS-specific official source since NestJS's own docs explicitly say refresh tokens are "beyond the scope" of their guide).
- Pitfalls: MEDIUM — the throttler `ttl` unit pitfall is directly confirmed against current official docs (HIGH); the timing-attack and rate-limit-tuning pitfalls are well-established general security-engineering knowledge (MEDIUM), not NestJS-specific official guidance.

**Research date:** 2026-09-11
**Valid until:** 30 days (stable, mature libraries — `@nestjs/jwt`/`@nestjs/passport`/`argon2`/`@nestjs/throttler` version drift is the most likely thing to go stale; re-verify versions if planning is delayed past early October 2026)

---
*Phase 1 research for: Authentication & Multi-Tenant Foundation*
*Researched: 2026-09-11*
