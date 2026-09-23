# Multi-stage build: builder compiles TypeScript and installs native
# bindings; runner ships only dist/ + production node_modules (no /src,
# no tsconfig.json, no devDependencies-only packages).

FROM node:24-alpine AS builder
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

FROM node:24-alpine AS runner
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

# Mirrors package.json's existing start:prod script exactly.
CMD ["node", "dist/main"]
