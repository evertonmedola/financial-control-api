# Phase 7: Containerization - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-23
**Phase:** 07-Containerization
**Areas discussed:** Health check, docker-compose, Base image, ECR config, HEALTHCHECK tool

---

## Health check

| Option | Description | Selected |
|--------|-------------|----------|
| @nestjs/terminus completo | TypeOrmHealthIndicator — só reporta "healthy" se processo E conexão com Postgres estiverem OK | ✓ |
| Controller mínimo custom | Só verifica que o processo está vivo, sem checar o banco | |

**User's choice:** @nestjs/terminus completo
**Notes:** Alinhado ao que a Fase 8 (ALB) vai precisar para tirar tasks quebradas de rotação.

---

## docker-compose

| Option | Description | Selected |
|--------|-------------|----------|
| Sim, adicionar serviço api | docker-compose up sobe API + Postgres juntos, com depends_on + healthcheck do Postgres | ✓ |
| Não, só o Dockerfile por enquanto | Build + docker run manual; integração via compose fica para depois | |

**User's choice:** Sim, adicionar serviço api

---

## Base image

| Option | Description | Selected |
|--------|-------------|----------|
| node:24-alpine + build real como validação | Validação do argon2 é o próprio docker build + smoke test, sem pesquisa separada | ✓ |
| node:24-alpine, mas com fallback documentado | Mesma tag, com comentário no Dockerfile sobre toolchain de compilação caso o binário prebuilt falhe | |

**User's choice:** node:24-alpine + build real como validação

---

## ECR config

| Option | Description | Selected |
|--------|-------------|----------|
| Tag immutability ON | Impede sobrescrever uma tag já publicada | ✓ |
| Scan on push ON | ECR escaneia a imagem por CVEs a cada push | ✓ |
| Lifecycle policy | Expira imagens antigas automaticamente | |

**User's choice:** Tag immutability ON + Scan on push ON
**Notes:** Lifecycle policy descartada para esta fase — mais relevante quando a Fase 9 (CI/CD) passar a fazer push a cada commit.

---

## HEALTHCHECK tool

| Option | Description | Selected |
|--------|-------------|----------|
| Script Node inline | http.get contra /health, sem pacotes extras (zero curl/wget) | ✓ |
| Instalar wget via apk | Mais legível, mas adiciona pacote/camada extra na imagem final | |

**User's choice:** Script Node inline

---

## Claude's Discretion

- `.dockerignore` — escopo exato de exclusões
- Estratégia de `npm ci`/prune de dependências de produção no build stage
- Porta exposta e mapeamento no docker-compose (padrão 3000)
- Nome/tag do repositório ECR e região específica

## Deferred Ideas

- Automação de build+push (GitHub Actions → ECR) — Fase 9
- Lifecycle policy no ECR — revisitar na Fase 9
- Infraestrutura AWS completa (VPC, ALB, RDS, Secrets Manager) — Fase 8
