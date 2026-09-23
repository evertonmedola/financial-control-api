# Phase 9: CI/CD Pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-23
**Phase:** 9-CI/CD Pipeline
**Areas discussed:** GitHub repo & triggers, Test gate scope, OIDC role & IAM scope, Deploy/migration/image tags

---

## GitHub repo & triggers

| Question | Options | Chosen |
|---|---|---|
| Branch/repo | Rename to main + create repo / Keep master / Repo exists | Rename to main + create repo |
| Visibility | Public / Private | Public |
| Triggers | PR tests + push main / Push main only / Push main + manual dispatch | Push main + workflow_dispatch |

## Test gate scope

| Question | Options | Chosen |
|---|---|---|
| Gate | Lint+unit+e2e / Lint+unit / Unit+e2e | Lint + unit + e2e |
| Jobs | test→deploy (2 jobs) / Single job | 2 jobs |

## OIDC role & IAM scope

| Question | Options | Chosen |
|---|---|---|
| Where created | infra/ Terraform / AWS CLI | Terraform |
| Trust sub | main branch only / whole repo / Environment | refs/heads/main only |
| IAM scope | Least privilege resource-scoped / Managed broad | Least privilege |

## Deploy, migration & image tags

| Question | Options | Chosen |
|---|---|---|
| Task def rollout | CI render+register / Terraform apply from CI | CI render + register (+ ignore_changes) |
| Migration | run-task, wait, gate exit code / fire-and-forget | Wait and gate on exit code |
| Rollback/ECR | Circuit breaker + lifecycle / neither / breaker only | Circuit breaker + ECR lifecycle |

## Claude's Discretion

Action versions, npm cache, concurrency, how to source subnets/SG for run-task, lint check script name.

## Deferred Ideas

PR trigger, GitHub Environment approvals, terraform in CI, HTTPS/secret rotation, vulnerability gating (hardening phase).
