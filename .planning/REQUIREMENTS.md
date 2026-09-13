# Requirements: Controle Financeiro Pessoal — API

**Defined:** 2026-09-11
**Core Value:** A API funciona localmente, com segurança tratada como requisito central (não como extra), e evolui em etapas incrementais claras até chegar a um deploy AWS completo e auditável.

## v1 Requirements

Requirements for initial release (API local completa, containerizada). Deploy AWS é fase separada — ver Constraints em PROJECT.md.

### Authentication

- [x] **AUTH-01**: User can sign up with email and password (senha com hash bcrypt/argon2, nunca em texto plano)
- [x] **AUTH-02**: User can log in and receive a JWT that authenticates subsequent requests
- [x] **AUTH-03**: User session is stateless via JWT (sem persistência de sessão no servidor)
- [x] **AUTH-04**: User can only access their own data — every domain entity is scoped by `userId`, enforced at the service layer (never trusting client-supplied IDs)

### Accounts

- [x] **ACCT-01**: User can create an account with type (corrente, poupança, carteira, cartão de crédito) and initial balance
- [x] **ACCT-02**: User can list, view, update, and delete their own accounts
- [x] **ACCT-03**: Credit card accounts behave as liabilities (balance represents amount owed, not amount held)
- [x] **ACCT-04**: Account balance reflects the sum of its transactions (income, expense, and transfer legs) consistently — no drift between stored and derived balance

### Categories

- [ ] **CAT-01**: User can create custom categories with a type (receita or despesa)
- [ ] **CAT-02**: User can list, view, update, and delete their own categories

### Transactions

- [ ] **TXN-01**: User can create a transaction (receita/despesa) with amount, date, description, linked account, and linked category
- [ ] **TXN-02**: User can list, view, update, and delete their own transactions
- [ ] **TXN-03**: User can create a transfer between two of their own accounts, recorded so both account balances update atomically
- [ ] **TXN-04**: Transfers are excluded from category spend totals and budget consumption calculations (a transfer is not new spending)
- [ ] **TXN-05**: Monetary amounts are stored and calculated without floating-point rounding errors (decimal-safe representation)

### Budgets

- [ ] **BUD-01**: User can set a monthly spending limit for a category
- [ ] **BUD-02**: User can view consumed vs. remaining amount for a category's monthly budget (`remaining = limit - spent`, excluding transfers)
- [ ] **BUD-03**: Over-budget state is explicitly representable in the response (not just a negative number silently returned)

### Reports

- [ ] **REP-01**: User can retrieve a category/period spending summary (JSON) for a given date range
- [ ] **REP-02**: User can retrieve a consolidated balance across all their accounts (JSON)
- [ ] **REP-03**: User can retrieve a month-over-month comparison report (JSON) showing spending deltas per category

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap, with one exception noted below.

### Deployment & Infrastructure

> **Note:** INFRA-01..04 are formally v2 scope, but PROJECT.md's Constraints section mandates the incremental order "API local funcionando → containerização → infraestrutura AWS → CI/CD, sem pular etapas" and the Core Value explicitly targets a full AWS deployment. Per that explicit project constraint, INFRA-01..04 were pulled into the v1 roadmap as Phases 7-9 (Containerization, AWS Infrastructure, CI/CD) — see Traceability below.

- **INFRA-01**: Application runs in Docker (multi-stage build) locally and in ECS Fargate
- **INFRA-02**: Infrastructure provisioned on AWS: VPC (public/private subnets), RDS PostgreSQL (private, not publicly accessible), ECS Fargate behind an Application Load Balancer, Secrets Manager for credentials
- **INFRA-03**: CI/CD pipeline via GitHub Actions (build → push ECR → deploy to ECS), using OIDC federation instead of static AWS keys
- **INFRA-04**: Database migrations run as an explicit CI/CD pipeline step, never on container boot and never via `synchronize: true`

### Finance Differentiators

- **FIN-01**: Net worth tracking over time (assets − liabilities), building on liability-signed credit card accounts
- **FIN-02**: Budget rollover — unspent/overspent balance carries to the next month
- **FIN-03**: Category grouping/templates (e.g. Needs/Wants/Savings)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Front-end / UI | Fica para fase futura separada, possivelmente em Angular |
| Feature de IA/Bedrock | Só depois da base estar pronta e estável |
| AWS Cognito | v1 usa JWT emitido pela própria API; Cognito é evolução futura possível |
| Upload de extrato CSV → S3 → Lambda → SES | Extensão futura mencionada; arquitetura deve deixar espaço mas não é foco inicial |
| Exportação de relatórios (CSV/PDF), dashboards | Relatórios v1 são só endpoints JSON; visualização é trabalho de front-end |
| Live bank sync (Plaid/Open Banking) | Escopo/custo/complexidade desproporcional para projeto pessoal/portfólio; conflita com abordagem incremental e self-built |
| Multi-currency | Sem necessidade declarada; complexidade de conversão/arredondamento não justificada |
| Budgets/contas compartilhados entre usuários | Conflita com o modelo de isolamento multi-tenant já escolhido |
| Investimentos/criptoativos | Fora do modelo de conta/categoria/transação já definido |
| Categorização automática via ML | Só compensaria com bank sync/import, que também está fora de escopo |
| Transações recorrentes/agendadas | Sem necessidade declarada; adiado para v2+ |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Complete |
| AUTH-02 | Phase 1 | Complete |
| AUTH-03 | Phase 1 | Complete |
| AUTH-04 | Phase 1 | Complete |
| ACCT-01 | Phase 2 | Complete |
| ACCT-02 | Phase 2 | Complete |
| ACCT-03 | Phase 2 | Complete |
| ACCT-04 | Phase 2 | Complete |
| CAT-01 | Phase 3 | Pending |
| CAT-02 | Phase 3 | Pending |
| TXN-01 | Phase 4 | Pending |
| TXN-02 | Phase 4 | Pending |
| TXN-03 | Phase 4 | Pending |
| TXN-04 | Phase 4 | Pending |
| TXN-05 | Phase 4 | Pending |
| BUD-01 | Phase 5 | Pending |
| BUD-02 | Phase 5 | Pending |
| BUD-03 | Phase 5 | Pending |
| REP-01 | Phase 6 | Pending |
| REP-02 | Phase 6 | Pending |
| REP-03 | Phase 6 | Pending |
| INFRA-01 | Phase 7 | Pending |
| INFRA-02 | Phase 8 | Pending |
| INFRA-03 | Phase 9 | Pending |
| INFRA-04 | Phase 9 | Pending |

**Coverage:**

- v1 requirements: 21 total
- Mapped to phases: 21/21 ✓
- Unmapped: 0
- Additionally mapped (v2 pulled forward per PROJECT.md constraint): INFRA-01..04 → Phases 7-9

---
*Requirements defined: 2026-09-11*
*Last updated: 2026-09-11 after roadmap creation*
