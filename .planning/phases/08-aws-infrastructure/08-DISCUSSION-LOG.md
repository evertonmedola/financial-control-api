# Phase 8: AWS Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-23
**Phase:** 8-AWS Infrastructure
**Areas discussed:** IaC, Rede/saída, HTTPS/domínio, RDS+Secrets+migration

---

## IaC
Terraform ✓ (vs CloudFormation, AWS CLI, Console). State: S3 com locking ✓ (vs local). Layout: `infra/` root module único ✓ (vs módulos). Bucket criado por CLI fora do destroy ✓.

## Rede
NAT Gateway único ✓ (vs VPC endpoints, tasks públicas). 2 AZs ✓.

## HTTPS/domínio
HTTP agora, HTTPS depois ✓ (vs ACM+domínio agora, HTTP definitivo).

## RDS / Secrets / migration
db.t4g.micro single-AZ ✓ (vs Multi-AZ). Secret do RDS gerenciado pela AWS ✓ (vs random_password no Terraform). JWT secret criado por CLI fora do Terraform ✓. Migration via `run-task` one-off ✓ (vs bastion/SSM).

## Claude's Discretion
CIDRs, nomes, região, task size, logs, parâmetros do target group.

## Deferred Ideas
HTTPS/ACM, Multi-AZ, VPC endpoints, rotação de secrets.
