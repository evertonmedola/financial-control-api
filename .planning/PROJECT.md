# Controle Financeiro Pessoal — API

## What This Is

Uma API de controle financeiro pessoal construída com NestJS + PostgreSQL, com deploy em AWS (ECS Fargate, ALB, RDS, Secrets Manager, CI/CD via GitHub Actions). Serve três propósitos ao mesmo tempo: uso pessoal real para controlar finanças, projeto de portfólio para vagas backend, e prática hands-on para a certificação AWS Cloud Practitioner.

## Core Value

A API funciona localmente, com segurança tratada como requisito central (não como extra), e evolui em etapas incrementais claras até chegar a um deploy AWS completo e auditável.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Cadastro de contas (corrente, poupança, carteira, cartão de crédito) com saldo atual
- [ ] Categorias de receita/despesa customizáveis pelo usuário
- [ ] Lançamento de transações (receita/despesa) vinculadas a conta e categoria
- [ ] Transferências entre contas
- [ ] Orçamento mensal por categoria com cálculo de consumido/restante
- [ ] Relatórios (JSON): resumo por categoria/período, saldo consolidado, comparação entre meses
- [ ] Autenticação JWT (registro + login com email/senha)
- [ ] Isolamento multi-tenant — cada usuário só acessa seus próprios dados
- [ ] Containerização com Docker (multi-stage build)
- [ ] Infraestrutura AWS: ECS Fargate atrás de ALB, RDS (PostgreSQL), Secrets Manager
- [ ] CI/CD via GitHub Actions (build → push ECR → deploy)

### Out of Scope

- Front-end — fica para fase futura separada, possivelmente em Angular
- Feature de IA/Bedrock — só depois da base estar pronta e estável
- AWS Cognito — v1 usa JWT emitido pela própria API; Cognito é evolução futura possível
- Upload de extrato CSV → S3 → Lambda → SES — mencionado como extensão futura; arquitetura deve deixar espaço mas não é foco inicial
- Visualização/exportação de relatórios (CSV/PDF, dashboards) — relatórios v1 são só endpoints JSON

## Context

**Motivação:** uso próprio para controle financeiro real, combinado com objetivo de portfólio (busca de vaga backend) e estudo prático para a certificação AWS Cloud Practitioner — cada escolha de serviço AWS deve ser explicada durante a discussão de fase, não só implementada.

**Convenções já definidas** (skill `nestjs-conventions`, `.claude/skills/nestjs-conventions/SKILLS.md`):
- Cada domínio (contas, categorias, transações, orçamentos, relatórios, auth) é um módulo próprio em `src/<dominio>/` com module/controller/service/dto/entities
- TypeORM com migrations geradas (nunca `synchronize: true` em produção)
- Toda entidade tem `userId` para isolamento multi-tenant; services nunca acessam `Request` diretamente — `userId` é passado pelo controller
- DTOs sempre com `class-validator`; resposta de API em formato consistente (ResponseDto/interceptor)
- Variáveis de ambiente validadas na inicialização (`@nestjs/config` + schema Joi/Zod)
- Endpoints em inglês, kebab-case; nomes de variáveis/classes em inglês; mensagens de erro ao usuário podem ser em português
- Todo service novo tem teste unitário (caso principal + caso de erro); testes de integração para regras de negócio (cálculo de orçamento, transferências)

**Segurança como requisito central** (skill `security-review`): toda feature passa pelo checklist da skill antes de ser considerada concluída — validação de entrada, queries parametrizadas, isolamento por usuário (evitar IDOR), IAM de menor privilégio, segredos fora do código, RDS sem acesso público, etc.

## Constraints

- **Tech stack**: NestJS + TypeScript, PostgreSQL (RDS), TypeORM, Docker multi-stage build — definido, não negociável
- **Infraestrutura AWS**: ECS Fargate + ALB, Secrets Manager para credenciais, CI/CD via GitHub Actions (build → push ECR → deploy)
- **Ordem de execução**: incremental e sem pular etapas — API local funcionando → containerização → infraestrutura AWS → CI/CD
- **Processo de fase**: antes de cada fase de execução, discutir a arquitetura proposta e o motivo de cada escolha de serviço AWS (apoio ao estudo para Cloud Practitioner); ao final de cada fase, produzir um checklist do que testar antes de avançar
- **Segurança**: toda feature passa pelo checklist da skill `security-review` antes de ser considerada concluída

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Autenticação via JWT próprio (não Cognito) | Menos setup inicial, mais rápido para ter a API funcionando; Cognito fica como evolução futura | — Pending |
| v1 = API local completa (Docker), deploy AWS é fase separada | Evita empurrar a primeira entrega funcional para depois de toda a infra AWS estar pronta | — Pending |
| Relatórios v1 são só endpoints JSON | Front-end está fora de escopo nesta fase; visualização fica para depois | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-11 after initialization*
