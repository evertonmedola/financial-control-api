# Phase 9: CI/CD Pipeline - Context

**Gathered:** 2026-09-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Automatizar, via GitHub Actions, o caminho de um push em `main` até a nova versão rodando no ECS: testes → build da imagem → push ao ECR → migration → deploy. Autenticação na AWS exclusivamente por OIDC (sem chaves estáticas). Inclui a criação/conexão do repositório GitHub e o OIDC provider + deploy role (Terraform em `infra/`).

Fora desta fase: HTTPS/domínio, rotação de secrets, ambientes múltiplos (staging), hardening de segurança final (fase dedicada posterior).

Requisitos: INFRA-03, INFRA-04. Critérios: push em main dispara test/build/push com credenciais OIDC de curta duração; migrations rodam como step explícito e separado antes do update do serviço (nunca no boot, nunca `synchronize`); pipeline bem-sucedido = nova versão no ECS sem intervenção manual.

</domain>

<decisions>
## Implementation Decisions

### Repositório e triggers
- **D-01:** Renomear a branch local `master` → `main` e criar o repositório GitHub via `gh` CLI, adicionando o remote e fazendo o push inicial. Passo de setup do plano (o roadmap e a trust policy do OIDC assumem `main`). — **Reversibility:** reversible — renomear branch/remote é local e barato.
- **D-02:** Repositório **público** (portfólio). Antes do primeiro push: remover do git/ignorar artefatos de infra (`infra/tfplan`, `infra/tfplan.txt`, `infra/tfplan.apply.log`), confirmar `.gitignore` (`.terraform/`, `*.tfstate*`, `.env`) e garantir que nenhum segredo está no histórico. O account ID da AWS não é segredo, mas preferir variáveis a literais onde for barato. — **Reversibility:** costly — publicar histórico com segredo exige rewrite de histórico + rotação; por isso a checagem é pré-requisito do push.
- **D-03:** Triggers: `push` em `main` **+ `workflow_dispatch`** (redeploy manual sem commit). Sem `pull_request` por ora.

### Gate de testes
- **D-04:** Antes de build/deploy devem passar **lint (modo check, sem `--fix`) + testes unitários + e2e**. O e2e usa um **service container Postgres 16** no Actions (espelha o `docker-compose.yml`). O script `npm run lint` atual usa `--fix`; o plano deve adicionar um script check-only (ex. `lint:check`) para CI.
- **D-05:** Workflow com **2 jobs**: `test` (sem permissões AWS) → `deploy` (`needs: test`, único job com `id-token: write` e que assume o role OIDC). Least privilege por construção.

### OIDC e IAM
- **D-06:** OIDC provider (`token.actions.githubusercontent.com`) + deploy role + policy criados no **Terraform de `infra/`** (novo `oidc.tf`, mesmo root module — D-01/D-02 da Fase 8). O ARN do role vai para o workflow via variável de repositório do GitHub (não é segredo, mas evita literal no YAML). Nota: `terraform destroy` remove o role; um `apply` posterior o recria com o mesmo nome/ARN.
- **D-07:** Trust policy com condição exata `sub = repo:<owner>/<repo>:ref:refs/heads/main` e `aud = sts.amazonaws.com` — só execuções em `main` assumem o role.
- **D-08:** Permissões **least-privilege com escopo de recurso**: ECR push só no repositório da API; `ecs:RegisterTaskDefinition`, `UpdateService`, `DescribeServices`, `DescribeTaskDefinition`, `RunTask`, `DescribeTasks` restritos ao cluster/serviço onde a AWS permite (RegisterTaskDefinition/Describe* não aceitam escopo de recurso — `*` só onde obrigatório); `iam:PassRole` apenas para os roles de execution e task, com condição `iam:PassedToService = ecs-tasks.amazonaws.com`; leitura de logs só se necessário para exibir falha de migration.

### Deploy, migration e imagem
- **D-09:** **CI registra novas revisões do task definition**: `aws-actions/amazon-ecs-render-task-definition` troca a imagem pela tag do commit no task def vivo, e `aws-actions/amazon-ecs-deploy-task-definition` atualiza o serviço e espera estabilização. Terraform ganha `lifecycle { ignore_changes = [task_definition] }` no `aws_ecs_service` (já anunciado no comentário de `infra/ecs.tf`) para que `apply` não reverta deploys do CI. O deploy role **não** recebe permissões amplas de infra (sem `terraform apply` no CI). — **Reversibility:** reversible — remover o `ignore_changes` devolve o controle ao Terraform.
- **D-10:** **Migration via `aws ecs run-task`** com a **imagem nova** (task def recém-registrada) + `infra/migrate-overrides.json` (comando `node node_modules/typeorm/cli.js -d dist/database/data-source.js migration:run`), usando as mesmas subnets privadas e security group das tasks. O job espera `aws ecs wait tasks-stopped` e **falha o pipeline se o exit code do container ≠ 0** — o serviço nunca é atualizado sobre migration falha (INFRA-04). Migrations permanecem forward-only e retrocompatíveis com a versão anterior do app (não há auto-revert de schema).
- **D-11:** Imagem taggeada com o **git SHA** (imutável — ECR já tem immutability ON); nunca `:latest`.
- **D-12:** **ECS deployment circuit breaker com rollback** habilitado no serviço (falha de rollout volta ao task def anterior) e **ECR lifecycle policy** mantendo as ~10 imagens mais recentes (adiado na Fase 7, agora relevante com push a cada commit). — **Reversibility:** reversible — ambos são atributos aditivos.

### Claude's Discretion
- Versões exatas das actions (`actions/checkout`, `setup-node`, `aws-actions/*`) — majors atuais, idealmente pinadas.
- Cache de npm, nomes de jobs/steps, timeouts, `concurrency` (sugerido: um deploy por vez, sem cancelar deploy em andamento).
- Como obter subnets/SG para o `run-task` (variáveis do repositório vs. `terraform output` vs. lookup via `describe-services`) — preferir ler a configuração de rede do próprio serviço ECS para não duplicar IDs.
- Nome do script check-only de lint e ajustes mínimos em `package.json`.
- Explicar, durante planejamento/execução, o motivo de cada serviço/conceito AWS (OIDC/STS, IAM roles, ECR, ECS deploy) para apoio ao Cloud Practitioner e produzir o checklist de testes ao final da fase (constraint do projeto).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Projeto e requisitos
- `.planning/ROADMAP.md` §Phase 9 — goal e Success Criteria (OIDC sem chaves estáticas, migration como step separado antes do update, deploy sem intervenção).
- `.planning/REQUIREMENTS.md` §INFRA-03, INFRA-04 — OIDC no lugar de chaves estáticas; migrations como step explícito do pipeline.
- `.planning/PROJECT.md` — Constraints (GitHub Actions build → push ECR → deploy; discutir escolhas AWS para estudo; checklist ao fim da fase).
- `.claude/CLAUDE.md` — Architecture Notes (AWS): pipeline padrão (configure-aws-credentials OIDC → ecr-login → build/push por SHA → render-task-definition → deploy-task-definition), "What NOT to Use" (chaves estáticas), execution role vs task role.

### Fases anteriores
- `.planning/phases/08-aws-infrastructure/08-CONTEXT.md` — D-10 (migration via run-task, mecanismo que esta fase automatiza), state S3 remoto, `ignore_changes` previsto para o service.
- `.planning/phases/07-containerization/07-CONTEXT.md` — D-05 (ECR: immutability + scan on push; lifecycle adiado), Dockerfile, `/health`.

### Código de infra existente
- `infra/ecs.tf` — cluster, task definition (container `api`), service (comentário sobre `ignore_changes`), roles execution/task.
- `infra/migrate-overrides.json` — override de comando do `run-task` para `migration:run`.
- `infra/variables.tf` — `region`, `ecr_repository_name`, `image_tag`.
- `infra/README.md` e `infra/scripts/verify-phase8.sh` — runbook e verificação da Fase 8 (padrão para o checklist da Fase 9).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `infra/migrate-overrides.json`: override do `run-task` (container `api`) — reutilizar no step de migration.
- `infra/ecs.tf` (task def `financial-control-api`, cluster `financial-control`, service `financial-control-api`): alvos do render/deploy do CI.
- `Dockerfile` (raiz) e ECR privado (immutable tags, scan on push): destino do build/push.
- `docker-compose.yml`: referência para o service container Postgres 16 do e2e no Actions.
- `package.json`: scripts `test`, `test:e2e`, `lint` (com `--fix`), `build`, `migration:run`.

### Established Patterns
- Migrations apenas via CLI explícita (`migration:run`), `synchronize: false`; nunca no boot.
- Segredos via Secrets Manager `valueFrom` — CI não manipula valores de segredo da app.
- Terraform: um root module em `infra/`, state remoto S3 com `use_lockfile`.

### Integration Points
- Não existe `.github/` nem remote git ainda — serão criados nesta fase.
- Terraform: novo `oidc.tf`; ajustes em `ecs.tf` (`ignore_changes`, circuit breaker). O repositório ECR foi criado fora do Terraform na Fase 7 — o plano decide entre `aws ecr put-lifecycle-policy` via CLI ou importar o repo.
- `infra/tfplan*` são artefatos que não devem ir para o repositório público.

</code_context>

<specifics>
## Specific Ideas

- Repo público como peça de portfólio: workflow legível, com comentários curtos explicando cada etapa (OIDC, migration antes do deploy).
- Custo: a infra pode estar destruída (`terraform destroy`) quando o pipeline rodar — o runbook deve deixar claro que o deploy exige a infra de pé (`apply` antes).

</specifics>

<deferred>
## Deferred Ideas

- Trigger `pull_request` (checks de PR sem acesso à AWS) — fácil de adicionar depois.
- GitHub Environment `production` com aprovação manual — cerimônia desnecessária para uso solo.
- Terraform plan/apply no CI — exigiria permissões amplas; possível fase futura.
- HTTPS/ACM/domínio, rotação de secrets, VPC endpoints (herdados da Fase 8).
- Gate de vulnerabilidades (scan findings) bloqueando o deploy — candidato à fase final de hardening.

</deferred>

---

*Phase: 9-CI/CD Pipeline*
*Context gathered: 2026-09-23*
