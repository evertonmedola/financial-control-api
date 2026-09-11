# Phase 1: Authentication & Multi-Tenant Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-11
**Phase:** 1-Authentication & Multi-Tenant Foundation
**Areas discussed:** Hash de senha, Estratégia de JWT, Respostas de erro

---

## Hash de senha

| Option | Description | Selected |
|--------|-------------|----------|
| argon2 (Recomendado) | Recomendação atual da OWASP — mais resistente a ataques GPU/ASIC. Vale o esforço extra de build (módulo nativo) no Dockerfile dado que segurança é requisito central | ✓ |
| bcrypt | Mais simples de buildar em Alpine (binários prontos via napi no v6), track record enorme | |

**User's choice:** argon2
**Notes:** Escolhido por alinhar com a prioridade de segurança declarada no PROJECT.md.

---

## Estratégia de JWT

| Option | Description | Selected |
|--------|-------------|----------|
| Access token apenas (Recomendado) | Mais simples; usuário faz login de novo quando expira | |
| Access + refresh token | Sessão mais longa sem re-login; mais complexidade | ✓ |

**User's choice:** Access + refresh token
**Notes:** —

| Option | Description | Selected |
|--------|-------------|----------|
| 15 minutos (Recomendado se com refresh) | Janela de exposição curta, padrão quando há refresh token | ✓ |
| 1 hora | Equilíbrio razoável se access-token-only | |
| 24 horas | Mais conveniente, janela de exposição maior | |

**User's choice:** 15 minutos
**Notes:** —

| Option | Description | Selected |
|--------|-------------|----------|
| 7 dias, hash no banco (Recomendado) | Permite revogação e rotação a cada uso | ✓ |
| 30 dias, hash no banco | Sessão mais longa, mesma abordagem de storage | |
| Stateless (sem storage) | Mais simples, sem revogação antes de expirar | |

**User's choice:** 7 dias, hash no banco
**Notes:** —

---

## Respostas de erro

| Option | Description | Selected |
|--------|-------------|----------|
| Genérico (Recomendado) | 'Credenciais inválidas' para ambos os casos — evita user enumeration | ✓ |
| Específico | 'Email não encontrado' vs 'senha incorreta' — melhor UX, vaza informação | |

**User's choice:** Genérico
**Notes:** —

| Option | Description | Selected |
|--------|-------------|----------|
| Sim (Recomendado) | @nestjs/throttler em /auth/login e /auth/register desde a Fase 1 | ✓ |
| Não agora | Adicionar depois em passada de security-review específica | |

**User's choice:** Sim
**Notes:** —

---

## Claude's Discretion

- Exact DTO/entity field names, module file layout (follow `nestjs-conventions` skill)
- Refresh token rotation implementation detail (rotate-and-invalidate-used-token pattern)
- No email verification gate in this phase (no SES in scope)

## Deferred Ideas

- Email verification before login — deferred to a future phase alongside the CSV/S3/Lambda/SES extension, if picked up
