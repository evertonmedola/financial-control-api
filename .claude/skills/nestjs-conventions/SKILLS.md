---
name: nestjs-conventions
description: Use esta skill sempre que criar novos módulos, controllers, services, DTOs ou entidades neste projeto NestJS de controle financeiro. Garante consistência de estrutura e nomenclatura em todo o código gerado.
---

# Convenções do Projeto — API de Controle Financeiro (NestJS)

## Estrutura de módulos

Cada domínio (contas, categorias, transações, orçamentos, relatórios, auth) é um módulo próprio em `src/<dominio>/`, contendo:

- `<dominio>.module.ts`
- `<dominio>.controller.ts`
- `<dominio>.service.ts`
- `dto/` — DTOs de entrada e saída, sempre com `class-validator`
- `entities/` — entidades TypeORM

## Regras de código

- Toda entidade tem `userId` (ou relação equivalente) para garantir isolamento multi-tenant simples
- Services nunca acessam o `Request` diretamente — o `userId` do usuário autenticado é passado como parâmetro pelo controller
- Toda resposta de API segue um formato consistente (definir um `ResponseDto` ou interceptor de resposta padrão)
- Migrations do TypeORM são geradas, nunca `synchronize: true` em produção
- Variáveis de ambiente são validadas na inicialização (ex: com `@nestjs/config` + schema Joi/Zod) — a aplicação não deve subir com env faltando

## Nomenclatura

- Endpoints em inglês, kebab-case (`/monthly-budgets`, não `/orcamentos-mensais`)
- Nomes de variáveis e classes em inglês
- Mensagens de erro e labels voltados ao usuário final podem ser em português

## Testes

- Todo service novo deve vir com ao menos um teste unitário cobrindo o caso principal e um caso de erro
- Testes de integração para endpoints que envolvem regra de negócio (ex: cálculo de orçamento consumido, transferência entre contas)
