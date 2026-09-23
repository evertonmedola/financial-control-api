---
name: security-review
description: Use esta skill sempre que gerar ou revisar código relacionado a endpoints da API, queries de banco de dados, configuração de infraestrutura AWS (IAM, Secrets Manager, Security Groups, ECS task definitions) ou pipeline de CI/CD neste projeto de controle financeiro. Também use ao finalizar qualquer feature, antes de considerá-la pronta.
---

# Revisão de Segurança — Projeto de Controle Financeiro

Este projeto lida com dados financeiros pessoais reais do usuário. Trate qualquer código gerado como candidato a revisão de segurança antes de ser considerado concluído.

## Checklist obrigatório

Ao gerar ou revisar código, verifique cada item abaixo e reporte explicitamente ao usuário quais foram aplicados e quais precisam de atenção.

### Aplicação (NestJS)

- [ ] Todo endpoint tem DTO com validação (`class-validator`) — nenhum payload é aceito sem schema
- [ ] Toda query usa TypeORM/Prisma parametrizado — nunca string concatenada ou template literal com input do usuário
- [ ] Nenhum segredo, connection string ou chave de API hardcoded no código
- [ ] Todo endpoint que retorna/modifica dados financeiros verifica que o recurso pertence ao usuário autenticado (evitar IDOR — usuário A não pode acessar transação do usuário B trocando o ID na URL)
- [ ] Rate limiting configurado em endpoints públicos (login, cadastro)
- [ ] CORS configurado com origem explícita, nunca `*`
- [ ] Mensagens de erro não vazam stack trace, nome de tabela ou versão de dependência
- [ ] Senhas com hash (bcrypt/argon2), nunca texto plano ou hash fraco (MD5/SHA1)
- [ ] JWT com expiração curta; refresh token tratado separadamente

### Infraestrutura AWS

- [ ] IAM role do ECS segue menor privilégio — nunca `AdministratorAccess` ou `*:*`
- [ ] Credenciais de banco vêm do Secrets Manager, nunca em variável de ambiente em texto plano no task definition
- [ ] RDS com `publicly_accessible = false` e Security Group restrito apenas ao SG do ECS
- [ ] ALB força HTTPS
- [ ] Nenhum dado sensível (saldo, senha, token) em log do CloudWatch

### Pipeline

- [ ] `npm audit` (ou equivalente) roda no CI antes do deploy
- [ ] `.env`, chaves e certificados estão no `.gitignore` e `.dockerignore`
- [ ] Imagem Docker não roda como root

## Como reportar

Ao final de uma feature ou revisão, apresente um resumo curto no formato:

```
✅ Aplicado: [itens]
⚠️  Atenção: [itens que precisam de decisão ou ajuste do usuário]
```

Não marque um item como aplicado sem ter, de fato, escrito ou verificado o código correspondente.
