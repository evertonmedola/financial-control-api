# Controle Financeiro Pessoal — API

## What This Is

Uma API de controle financeiro pessoal construída com NestJS + PostgreSQL, com deploy em AWS (ECS Fargate, ALB, RDS, Secrets Manager, CI/CD via GitHub Actions). Serve três propósitos ao mesmo tempo: uso pessoal real para controlar finanças, projeto de portfólio para vagas backend, e prática hands-on para a certificação AWS Cloud Practitioner.

## Core Value

A API funciona localmente, com segurança tratada como requisito central (não como extra), e evolui em etapas incrementais claras até chegar a um deploy AWS completo e auditável.

## Requirements

### Validated

- ✓ Autenticação JWT (registro + login com email/senha) — Phase 1
- ✓ Isolamento multi-tenant — cada usuário só acessa seus próprios dados — Phase 1
- ✓ Cadastro de contas (corrente, poupança, carteira, cartão de crédito) com saldo atual — Phase 2
- ✓ Categorias de receita/despesa customizáveis pelo usuário — Phase 3
- ✓ Lançamento de transações (receita/despesa) vinculadas a conta e categoria — Phase 4
- ✓ Transferências entre contas — Phase 4
- ✓ Orçamento mensal por categoria com cálculo de consumido/restante — Phase 5

### Active

- [ ] Relatórios (JSON): resumo por categoria/período, saldo consolidado, comparação entre meses
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
| Autenticação via JWT próprio (não Cognito) | Menos setup inicial, mais rápido para ter a API funcionando; Cognito fica como evolução futura | ✓ Shipped Phase 1 — access+refresh JWT pair via `@nestjs/jwt`/passport-jwt, stateless verification |
| v1 = API local completa (Docker), deploy AWS é fase separada | Evita empurrar a primeira entrega funcional para depois de toda a infra AWS estar pronta | — Pending (Phase 1 delivered locally; Docker is Phase 7) |
| Relatórios v1 são só endpoints JSON | Front-end está fora de escopo nesta fase; visualização fica para depois | — Pending |
| argon2 (não bcrypt) para hash de senha | OWASP recommends argon2id over bcrypt for new systems (stronger memory-hardness); resolved during Phase 1 planning per STATE.md's earlier open decision | ✓ Shipped Phase 1 |
| Refresh token: rotação + detecção de reuso por família | Um token roubado usado após rotação revoga toda a família, forçando novo login — limita o raio de impacto de um token vazado (D-04) | ✓ Shipped Phase 1 — atomic conditional `UPDATE` (hardened post-execution via code review, closing a TOCTOU race in the original read-then-write implementation) |
| Rate limiting em `/auth/login` e `/auth/register` via `@nestjs/throttler` (D-06) | Mitiga brute-force e criação em massa de contas; aplicado nos dois endpoints, não só login | ✓ Shipped Phase 1 |
| `userId`-scoping via `@CurrentUser()` decorator, nunca de input do cliente | Estabelece o padrão de isolamento multi-tenant que toda fase futura reutiliza sem alteração | ✓ Shipped Phase 1 — provado sob suíte adversarial de dois usuários (`cross-tenant.e2e-spec.ts`) |
| Saldo de cartão de crédito segue a mesma convenção de sinal das demais contas: negativo = dívida em aberto; `getNetBalance` soma todos os saldos uniformemente (opção B; substitui a D-01 da Phase 2 e o netting por tipo da Phase 6) | Despesas e pagamentos já movem o saldo via `adjustBalance` sem ramificação por tipo, então manter uma convenção especial só para cartão fazia um cartão em 0.00 com uma despesa de R$ 100 aumentar o saldo líquido em vez de reduzi-lo | ✓ Quick 261001-k0j |
| `balance` e `type` são imutáveis após a criação da conta (D-02); apenas `AccountsService.adjustBalance()` (stub reservado, sem rota) poderá alterar saldo — via transações na Phase 4 | Garante a invariante de "no drift": único write-path de saldo é a criação até a Phase 4 implementar transações | ✓ Shipped Phase 2 |
| Soft-delete de contas (`deletedAt`, nunca hard-delete) (D-03) | Contas deletadas continuam referenciáveis pelas transações que a Phase 4 vai vincular a elas | ✓ Shipped Phase 2 |
| Unicidade de nome+tipo por usuário aplicada via índice único parcial no Postgres, nunca checagem em app-layer (D-03) | Fecha a race condition (TOCTOU) que uma checagem prévia em app-layer deixaria aberta — o Postgres aborta o INSERT inteiro, garantindo exatamente um 201 e um 409 mesmo sob criação concorrente | ✓ Shipped Phase 3 |
| `type` é permanentemente travado após a criação da categoria (D-02, Prohibition P2) | Consistência com o padrão já estabelecido em Accounts (Phase 2) — nenhuma feature futura pode reinterpretar o significado de uma categoria já em uso | ✓ Shipped Phase 3 |
| Soft-delete de categorias (`deletedAt`, nunca hard-delete), liberando nome/tipo para reuso via índice parcial (D-01, D-03) | Preserva referências futuras (Phase 4/5 vincularão transações a categorias) e ainda permite recriar um nome antes usado | ✓ Shipped Phase 3 |
| Code review pós-execução (antes do fechamento de fase) encontrou e corrigiu 1 bug crítico e 3 warnings: `update()` não traduzia unique-violation para 409 (500 não tratado), `:id` malformado gerava 500 em vez de 400, e `name` não era normalizado (trim) antes da checagem de unicidade | Corrigidos e cobertos com testes de regressão dedicados antes de marcar a fase como completa — nenhum gap deixado para a Phase 4 | ✓ Shipped Phase 3 — ver `03-REVIEW.md`/`03-REVIEW-FIX.md` |
| Aritmética monetária via BigInt-cents (`src/common/decimal.util.ts`), nunca `parseFloat`/`Number()` | Elimina drift de ponto flutuante em somas repetidas; provado sob stress test de 1000 somas sequenciais e 12 transações intercaladas via API real | ✓ Shipped Phase 4 |
| Transferências são uma entidade separada de transações no nível de endpoint (`POST /transfers`, sem `PATCH`), mas a mesma tabela `transactions` com `type=transfer` e `categoryId` sempre `null` (D-01/D-02/D-03) | Exclusão estrutural de transferências dos totais de categoria via CHECK constraint no Postgres, não por convenção de código | ✓ Shipped Phase 4 |
| Todo write de saldo de conta passa por um único método (`AccountsService.adjustBalance`), sempre com lock `pessimistic_write` dentro de uma `QueryRunner` transaction compartilhada; contas com múltiplas pernas (transferências) são sempre lockadas em ordem ascendente de id, independente da direção | Elimina lost-update e deadlock sob concorrência — provado sob testes de concorrência dedicados (dupla-delete, transferências opostas simultâneas) | ✓ Shipped Phase 4 |
| Code review pós-execução encontrou e corrigiu 1 bug crítico (CR-01) e 3 warnings (WR-01/02/03): `TransactionsService.update()`/`AccountsService.update()`/`remove()` faziam um read-then-full-save desprotegido que podia ressuscitar uma linha concorrentemente soft-deletada (mesma classe de bug que `remove()` já prevenia via lock); UUID com casing misto podia escapar da guarda de self-transfer; `adjustBalance()` não tinha teto de overflow para `numeric(12,2)` | Todos os 4 corrigidos via update condicional escopado (`repository.update({...,deletedAt:IsNull()}, dto)` com `affected===0` → 404) antes do fechamento da fase; suíte completa re-executada limpa (50/50 unit, 130/130 e2e). Um gap não-bloqueante permanece: nenhum teste de regressão dedicado para a interleaving específica PATCH-vs-DELETE (mitigação em código confirmada, teste ainda não escrito) | ✓ Shipped Phase 4 — ver `04-REVIEW.md`/`04-REVIEW-FIX.md`/`04-SECURITY.md` |
| Cálculo de `spent`/`remaining`/`overBudget` via `SUM(...) GROUP BY` filtrado por `type = EXPENSE` (não apenas `!= TRANSFER`) | Uma transação de RECEITA lançada contra uma categoria de DESPESA (ex.: reembolso registrado como receita) não deve inflar o gasto do orçamento — nada no schema impede esse mismatch entre `transaction.type` e `category.type`, então o filtro precisa ser explícito | ✓ Shipped Phase 5 |
| Guarda de corpo vazio no `PATCH` (`hasNoUpdatableFields()`, `src/common/patch.util.ts`) derivada das próprias chaves do DTO, nunca uma lista de campos mantida à mão | Uma lista hardcoded ficaria dessincronizada na primeira vez que um campo opcional fosse adicionado a um DTO — o `update()` faria um no-op silencioso (200 + nada mudou) em vez de um erro, perda de dados pior que o crash que a guarda substituiu | ✓ Shipped Phase 5 — reutilizado por `BudgetsService` e `TransactionsService` |
| Code review pós-execução (loop de 3 iterações, cap atingido) encontrou e corrigiu 2 bugs críticos (agregação de gasto sem filtro de tipo; `limit: null` no PATCH de budget contornava validação) e 1 warning (race TOCTOU no `BudgetsService.update()`) — a própria correção do warning introduziu uma regressão (corpo `{}` no PATCH crashava com 500 via `UpdateValuesMissingError` do TypeORM), corrigida na iteração seguinte, que por sua vez revelou o mesmo bypass de `null` em `UpdateTransactionDto.date`/`description` (bug pré-existente da Phase 4, não coberto até agora) | Cada correção foi re-verificada com testes reais contra o Postgres, não apenas leitura de código; a fase só foi selada após uma re-revisão confirmatória final retornar limpa (0 crítico, 0 warning) | ✓ Shipped Phase 5 — ver `05-REVIEW.md`/`05-REVIEW-FIX.md` |

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
*Last updated: 2026-09-22 after Phase 5*
