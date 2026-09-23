# Phase 8: AWS Infrastructure - Context

**Gathered:** 2026-09-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Provisionar, via Terraform, a infraestrutura AWS onde a API (imagem da Fase 7, já no ECR) roda: VPC com subnets públicas/privadas em 2 AZs, ALB público, ECS Fargate em subnets privadas, RDS PostgreSQL privado, e Secrets Manager para credenciais do banco e o segredo JWT. Inclui a execução da migration inicial via `run-task` one-off.

Fora desta fase: pipeline CI/CD, OIDC e automação de deploy/migration (Fase 9); HTTPS/domínio (adiado); Multi-AZ no RDS (adiado).

Requisito: INFRA-02. Critérios: API acessível só via ALB; tasks e RDS privados; credenciais injetadas em runtime via Secrets Manager; ALB roteia só para tasks saudáveis em `/health`.

</domain>

<decisions>
## Implementation Decisions

### IaC (Terraform)
- **D-01:** Provisionar com **Terraform** (não CloudFormation/CLI/console) — padrão de mercado, `plan/apply/destroy` reprodutível e auditável. — **Reversibility:** costly — trocar de ferramenta exige reescrever toda a infra e reimportar recursos.
- **D-02:** Código em `infra/` na raiz do repo da API, **um único root module** com arquivos por tema (`network.tf`, `alb.tf`, `ecs.tf`, `rds.tf`, `secrets.tf`, etc.). Sem módulos separados — um único ambiente.
- **D-03:** **State remoto em bucket S3** com locking nativo (`use_lockfile`, sem DynamoDB), versionamento e criptografia ligados, acesso privado. O bucket é criado **uma vez via AWS CLI**, documentado no README, e fica **fora** do `terraform destroy`. — **Reversibility:** reversible — migrar state entre backends é um `terraform init -migrate-state`.

### Rede
- **D-04:** **2 AZs** (ALB e RDS subnet group exigem no mínimo 2), com subnets públicas (ALB, NAT) e privadas (ECS, RDS).
- **D-05:** **1 NAT Gateway** (na AZ a) para a saída das tasks privadas (pull do ECR, Secrets Manager, logs CloudWatch). VPC endpoints descartados por ora (custo/complexidade similares ou maiores). Custo (~US$32/mês) mitigado por `terraform destroy` quando ocioso. Tasks em subnet pública com IP público foram rejeitadas (violam o critério de sucesso 1).
- Security groups: RDS aceita 5432 **apenas do SG das tasks ECS** (referência SG-a-SG, conforme CLAUDE.md); tasks aceitam apenas do SG do ALB.

### HTTPS / domínio
- **D-06:** **HTTP apenas** no ALB nesta fase, usando o DNS padrão `*.elb.amazonaws.com`. Listener 80 e security group ficam preparados para acrescentar o 443 depois. **Restrição de uso:** até HTTPS existir, não usar dados financeiros reais na AWS (senha/JWT trafegam sem criptografia). `ALLOWED_ORIGINS` ajustado conforme necessário. — **Reversibility:** reversible — adicionar ACM + listener 443 é aditivo.

### RDS e Secrets
- **D-07:** RDS **`db.t4g.micro`, Postgres 16, single-AZ, 20 GB gp3, backup automático de 7 dias, storage criptografado**, `publicly_accessible = false`, `skip_final_snapshot = true` e `deletion_protection = false` (para o `destroy` funcionar). Multi-AZ descartado.
- **D-08:** Senha do banco via **secret gerenciado pelo RDS** (`manage_master_user_password`) — nunca passa pelo Terraform/state. ECS injeta `DB_USER`/`DB_PASSWORD` via `secrets` com `valueFrom` `arn:...:secret:...:username::` / `:password::`; `DB_HOST`, `DB_PORT`, `DB_NAME` como variáveis normais. Permissão `secretsmanager:GetSecretValue` na **task execution role**.
- **D-09:** `JWT_ACCESS_SECRET` em **secret separado no Secrets Manager, criado por AWS CLI fora do Terraform** (nunca entra no state); o Terraform apenas referencia o ARN existente (data source). Injetado via `secrets`/`valueFrom` no task definition, mesma execution role.
- **D-10:** **Migration inicial via `aws ecs run-task` one-off** com a mesma imagem e comando `migration:run`, rodando dentro da VPC (RDS é privado). É o mesmo mecanismo que a Fase 9 automatiza. Nunca no boot do container (INFRA-04). Verificar se a imagem de produção inclui o CLI do TypeORM e os arquivos de migration compilados; ajustar a Fase 7 se faltarem.

### Claude's Discretion
- Ranges CIDR, nomes/tags dos recursos, região (padrão: a do ECR existente), tamanho do task Fargate (começar conservador, ex. 0.25 vCPU/512 MB, conforme CLAUDE.md), retenção de logs CloudWatch, parâmetros do target group (intervalo, thresholds) e health check grace period.
- Imagem referenciada por tag imutável (git SHA/tag existente), nunca `:latest`.
- Explicar, durante o planejamento/execução, o motivo de cada serviço AWS (apoio ao Cloud Practitioner, conforme constraints do projeto) e produzir checklist de testes ao final da fase.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Projeto e requisitos
- `.planning/ROADMAP.md` — Phase 8 goal e Success Criteria (ALB-only, RDS/ECS privados, secrets em runtime, health check no ALB).
- `.planning/REQUIREMENTS.md` §INFRA-02..04 — INFRA-02 é desta fase; INFRA-03/04 (OIDC, migrations no pipeline) são da Fase 9.
- `.planning/PROJECT.md` — Constraints (ECS Fargate + ALB, Secrets Manager, discutir escolhas AWS para estudo, checklist de fim de fase).
- `.claude/CLAUDE.md` — Architecture Notes (AWS): SG-a-SG, `secrets` com `valueFrom`, execution role vs task role, task sizing, tag imutável, health check grace period, RDS privado.

### Fase anterior
- `.planning/phases/07-containerization/07-CONTEXT.md` — Dockerfile, `/health` (Terminus), ECR privado (tag imutável, scan on push), HEALTHCHECK.
- `src/config/env.validation.ts` e `.env.example` — variáveis exigidas no boot (`DB_*`, `JWT_ACCESS_SECRET`, `ALLOWED_ORIGINS`, etc.); o app falha ao subir se faltar alguma.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Dockerfile` (raiz) e imagem já publicada no ECR (conta 796897109626) — base do task definition.
- `docker-compose.yml` — referência das variáveis de ambiente que o container espera.
- `/health` (`src/health/`) — alvo do health check do target group do ALB.

### Established Patterns
- Env vars validadas com Zod na inicialização; segredos nunca hardcoded na imagem.
- Migrations via `npm run migration:run`, fora do boot; `synchronize: false`.

### Integration Points
- Não existe `infra/` ainda — será criado. AWS CLI 2.37 instalado e autenticado; **Terraform não está instalado** (instalar é pré-requisito do plano).
- Fase 9 reutilizará o state S3, o task definition e o padrão `run-task` de migration.

</code_context>

<specifics>
## Specific Ideas

- Custo é preocupação: usar `terraform destroy` quando a infra estiver ociosa (NAT + RDS + ALB cobram por hora).

</specifics>

<deferred>
## Deferred Ideas

- HTTPS: ACM + domínio + Route 53 + listener 443 com redirect do 80 — etapa posterior.
- RDS Multi-AZ — exagero para uso solo.
- VPC endpoints para substituir o NAT — possível otimização de custo/segurança depois.
- Rotação automática de secrets.

</deferred>

---

*Phase: 8-AWS Infrastructure*
*Context gathered: 2026-09-23*
