# Phase 7: Containerization - Context

**Gathered:** 2026-09-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Empacotar a API NestJS (já com as 6 fases de domínio concluídas) como uma imagem Docker de produção, via multi-stage build, que roda localmente de forma idêntica ao que rodará depois no ECS Fargate (Fase 8). Inclui: Dockerfile multi-stage, usuário não-root, `.dockerignore`, endpoint `/health` (app + conexão com Postgres), `HEALTHCHECK` no Dockerfile, integração com `docker-compose.yml` para teste local fim-a-fim, e criação de um repositório ECR privado com push manual da imagem.

CI/CD automatizado (build+push a cada commit) e toda a infraestrutura AWS (VPC, ALB, RDS, Secrets Manager) ficam fora desta fase — são as Fases 8 e 9.

</domain>

<decisions>
## Implementation Decisions

### Health check
- **D-01:** Implementar `/health` com `@nestjs/terminus` completo, incluindo `TypeOrmHealthIndicator` — o endpoint só reporta "healthy" se o processo estiver de pé **e** a conexão com o Postgres estiver OK. Adiciona `@nestjs/terminus` como nova dependência (ainda não presente no `package.json`). — **Reversibility:** reversible — trocar por um controller custom depois é uma mudança local, sem migração.
- **D-02:** O `HEALTHCHECK` do Dockerfile usa um script Node inline (`http.get` contra `/health`) em vez de instalar `curl`/`wget` via `apk` — zero pacotes extras na imagem final, menor superfície de ataque.

### docker-compose (dev local)
- **D-03:** Adicionar um serviço `api` ao `docker-compose.yml` (hoje só tem `db`) nesta fase. `docker-compose up` deve subir API + Postgres juntos, API lendo variáveis de ambiente locais (mesmo padrão do `.env.example`), com `depends_on` usando a condição `service_healthy` do `healthcheck` já existente no serviço `db`. Isso torna "containerizado conecta no Postgres" testável localmente sem depender da Fase 8.

### Imagem base
- **D-04:** Usar a tag `node:24-alpine` (Node 24.x Active LTS, conforme já travado no `CLAUDE.md`/stack doc do projeto). A validação de que `argon2` tem binário compatível com musl/Alpine é o próprio `docker build` bem-sucedido + um smoke test do container rodando (não uma etapa de pesquisa separada) — se o build falhar por causa do argon2, resolver ali mesmo, na hora (toolchain de compilação no build stage), sem precisar reabrir esta discussão.

### ECR
- **D-05:** Repositório ECR privado criado nesta fase com **tag immutability ON** (impede sobrescrever uma tag já publicada — consistente com a prática de referenciar por tag imutável/git SHA já descrita para a Fase 9) e **scan on push ON** (ECR escaneia a imagem por CVEs conhecidas a cada push — sem custo extra, e é conteúdo direto do Cloud Practitioner). Lifecycle policy (expiração automática de imagens antigas) foi explicitamente descartada para esta fase — mais relevante quando o CI/CD da Fase 9 passar a fazer push a cada commit.

### Claude's Discretion
- `.dockerignore` — escopo exato (excluir `node_modules`, `.env*`, `dist` local, `test/`, `.git`, etc.) fica a critério da implementação, seguindo a prática padrão de multi-stage build.
- Estratégia exata de `npm ci`/prune de dependências de produção no build stage.
- Porta exposta e mapeamento de porta no `docker-compose.yml` (padrão: 3000, mesmo do `.env.example`).
- Nome/tag do repositório ECR e região específica — decisão operacional no momento do `aws ecr create-repository`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Stack e decisões técnicas já travadas
- `.claude/CLAUDE.md` — Technology Stack, "What NOT to Use", Architecture Notes (AWS-specific) — Node 24.x, `@nestjs/terminus` para `/health`, referência de imagem por tag imutável (git SHA), padrão `HEALTHCHECK`, argon2 vs bcrypt no contexto Alpine.
- `.planning/PROJECT.md` — Constraints (Docker multi-stage build não-negociável, ordem incremental de fases, segurança como requisito central) e Key Decisions (argon2 já shipped na Fase 1).
- `.planning/REQUIREMENTS.md` §INFRA-01..04 — requisitos formais de infraestrutura, com INFRA-01 mapeado a esta fase.
- `.planning/ROADMAP.md` — Phase 7 Success Criteria (build multi-stage sem dev deps/source; API containerizada conecta ao Postgres e serve requests identicamente à versão local; `/health` pronto para uso futuro por um load balancer AWS).

### Convenções do projeto
- `.claude/skills/nestjs-conventions/SKILLS.md` — padrões de módulo por domínio, `@nestjs/config` + validação de env vars na inicialização — relevante para como o `HealthModule` deve ser estruturado.
- Skill `security-review` — checklist de segurança a aplicar antes de fechar a fase (segredos fora da imagem, etc.).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `docker-compose.yml` (raiz) — já define o serviço `db` (Postgres 16) com `healthcheck` via `pg_isready`. O novo serviço `api` deve reutilizar esse padrão de healthcheck e usar `depends_on: condition: service_healthy`.
- `.env.example` — lista as variáveis de ambiente esperadas (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_ACCESS_SECRET`, etc.) — o Dockerfile/compose não devem hardcodar nenhuma delas; tudo vem de fora do build.
- `package.json` scripts — `build` (`nest build`), `start:prod` (`node dist/main`), `migration:run` — o runtime stage do Dockerfile deve usar `start:prod`; migrations continuam fora do boot do container (INFRA-04, roda como step explícito de CI/CD na Fase 9, não no `CMD` do container).

### Established Patterns
- Nenhum módulo `health` existe ainda em `src/` — será novo, seguindo o padrão de módulo por domínio (`src/health/` com module/controller).
- `@nestjs/terminus` ainda não está no `package.json` — precisa ser adicionado como dependência de produção (não dev), já que roda dentro do container.

### Integration Points
- O runtime stage do Dockerfile expõe a porta usada por `PORT` (`.env.example`, padrão 3000).
- O `HEALTHCHECK` do Dockerfile consulta o mesmo `/health` que a Fase 8 vai configurar como target group health check do ALB — a implementação de D-01 precisa responder de forma compatível com ambos os consumidores (Docker `HEALTHCHECK` e, futuramente, ALB).

</code_context>

<specifics>
## Specific Ideas

Nenhuma referência específica adicional além das decisões acima — usuário aceitou as opções recomendadas em cada gray area discutida.

</specifics>

<deferred>
## Deferred Ideas

- Automação de build+push da imagem (GitHub Actions → ECR) — explicitamente Fase 9 (CI/CD), não esta fase (push é manual aqui).
- Lifecycle policy no ECR (expiração automática de imagens antigas) — considerada e descartada para esta fase; revisitar na Fase 9 quando push passar a ser automático a cada commit.
- Toda a infraestrutura AWS (VPC, ALB, RDS, Secrets Manager) — Fase 8.

None além dessas — discussão ficou dentro do escopo da fase.

</deferred>

---

*Phase: 7-Containerization*
*Context gathered: 2026-09-23*
