# Phase 1 — API Coverage Declaration

No external API integration: the detector fired on the phrase "integration tests" in
`01-RESEARCH.md`'s testing-convention note ("business-logic endpoints need integration
tests") — a reference to this project's *own* NestJS endpoints under Jest, not a
third-party API/SDK. This phase implements self-hosted JWT authentication
(`@nestjs/jwt` + `passport-jwt` + `argon2`, all local libraries with no network calls to
a vendor API) against the project's own PostgreSQL database. There is no external
service, SDK, or webhook in scope for Phase 1 — confirmed against `01-RESEARCH.md`'s
Standard Stack (all packages are self-hosted auth tooling) and `01-CONTEXT.md`'s
Deferred Ideas (email verification / SES explicitly deferred, so no external mail API
either). No coverage matrix is produced.
