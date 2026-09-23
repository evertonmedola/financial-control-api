# Multi-stage build: builder compiles TypeScript and installs native
# bindings; runner ships only dist/ + production node_modules (no /src,
# no tsconfig.json, no devDependencies-only packages).

# Single source of truth for the base image so builder and runner always
# resolve to the same tag (native-ABI parity for argon2). Override with
# --build-arg NODE_IMAGE=node:24.x-alpine3.y@sha256:... to pin a digest.
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS builder
WORKDIR /app

# Defensive native-module build toolchain (D-04) — argon2@^0.45.1 may need
# to compile from source if no prebuilt musl binary matches this exact
# Alpine/Node combination. Resolved at build time; no separate research task
# needed.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
# Full install (including dev deps) — needed for `nest build`.
RUN npm ci

COPY . .
RUN npm run build

# Trim node_modules down to production-only packages in place, keeping the
# already-compiled native bindings — avoids a second native compile in the
# runtime stage.
RUN npm prune --omit=dev

# typeorm@1.1.1 lists ts-node as a regular (non-dev) dependency for its CLI's
# TS-migration support — `npm prune --omit=dev` correctly leaves it (and its
# own typescript dependency) in place since npm's dependency graph sees them
# as production. Neither is ever imported by the compiled dist/ output (the
# TypeORM CLI/ts-node path is only reachable via `npm run typeorm`/
# migration:*, which never runs inside this container — INFRA-04). Stripped
# explicitly here so the runtime image has no typescript compiler, matching
# ROADMAP Success Criterion #1.
RUN rm -rf node_modules/typescript node_modules/ts-node

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production

# Dedicated non-root user (T-07-02) — the container's main process never
# runs as root.
RUN addgroup -S nestjs && adduser -S nestjs -G nestjs

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

USER nestjs

# Documentation only — the real port comes from the PORT env var read by
# ConfigService.getOrThrow<number>('PORT') in src/main.ts, unchanged this
# phase.
EXPOSE 3000

# D-02: Node's built-in http module, no curl/wget installed anywhere in the
# image. Reads process.env.PORT directly inside the script (not shell
# ${PORT} interpolation, which CMD's shell form does not guarantee is
# exported the way the script needs) — defaults to 3000 when unset.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "require('http').get({host:'localhost',port:process.env.PORT||3000,path:'/health'},(res)=>{process.exit(res.statusCode>=200&&res.statusCode<300?0:1)}).on('error',()=>process.exit(1))"

# Mirrors package.json's existing start:prod script exactly.
CMD ["node", "dist/main"]
