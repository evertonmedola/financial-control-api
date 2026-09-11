# Feature Research

**Domain:** Personal finance / budgeting API (accounts, categories, transactions, monthly budgets, reports)
**Researched:** 2026-09-11
**Confidence:** MEDIUM (web search, cross-checked across multiple independent sources: YNAB, Monarch Money, Actual Budget, EveryDollar, Copilot Money, PocketSmith)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete for a personal finance tracker.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Multiple account types (checking, savings, wallet/cash, credit card) | Every mainstream app (YNAB, Monarch, Actual, Copilot) models accounts as typed containers with a current balance; a tracker that only handles one account type can't represent a real financial life | LOW-MEDIUM | Credit card is the tricky one: it's a *liability*, so its balance sign convention and "spending increases balance owed" logic differ from asset accounts (checking/savings/wallet). Matches PROJECT.md's explicit requirement. |
| Current balance per account | Users check "how much do I have" constantly; it's the single most-viewed number in every finance app | LOW | Derivable (sum of transactions) or stored+reconciled — pick one and be consistent. Storing a running balance risks drift if not recalculated transactionally. |
| User-defined categories (income/expense) | Every budgeting tool (YNAB categories, Monarch categories, EveryDollar line items) lets users tailor categories to their life instead of forcing a fixed taxonomy | LOW | Matches PROJECT.md requirement directly. Categories need a `type` (income/expense) since budgets only apply to expense categories in most tools. |
| Transaction CRUD tied to account + category | The atomic unit of every finance app; without it there's nothing to budget or report on | LOW-MEDIUM | Needs amount, date, description, account, category, type (income/expense/transfer). |
| Transfers between own accounts, excluded from budget/spending totals | Verified across Actual Budget and Monarch Money docs: transfers are explicitly excluded from budget/cash-flow/spending totals because "they aren't new spending, just money moving." Users who see a transfer inflate their "spending" lose trust in the numbers fast. | MEDIUM | Implementation pattern (cross-checked): a transfer is really a *linked pair* of transactions (debit from source, credit to destination) that reference each other, or a single transaction entity with a `type=TRANSFER` and both `fromAccountId`/`toAccountId` that both leg balances update atomically. Must be excluded from category-spend and budget-consumed calculations. Directly relevant: paying a credit card bill from checking is itself best modeled as a transfer (checking → credit card liability account), not as a spending category — otherwise the same money is counted twice (once as the original purchase, once as the "payment" expense). |
| Monthly budget limit per category | The core planning primitive in every budgeting app (YNAB "assign," Monarch "budget," EveryDollar "planned") | LOW-MEDIUM | Ties to PROJECT.md requirement: "orçamento mensal por categoria." |
| Spent vs remaining calculation | Confirmed formula pattern across sources: `Remaining = Planned - Spent`, `% used = Spent / Planned`. This is the universal mental model users bring from every budgeting tool they've used before. | LOW | Straightforward aggregation query (sum of expense transactions in category for the month), but must correctly exclude transfers (see above) and handle categories with no transactions (remaining = full planned amount). Over-budget must be representable (negative remaining or `overBudget: true` flag) — every app surfaces this distinctly. |
| Category/period spending summary report | Baseline reporting expectation once budgets exist — "where did my money go this month" is the #1 question users ask | LOW-MEDIUM | Matches PROJECT.md requirement. Group transactions by category for a date range, sum by type. |
| Consolidated balance across accounts | Users think in terms of "how much money do I have total," not per-account; every app aggregates this on a dashboard/summary view | LOW | Sum of current balances across all user accounts (credit card liabilities should logically reduce net figures, even if v1 doesn't compute full net worth). |
| Authentication + per-user data isolation | Not a "finance feature" per se, but table stakes for any personal-data product; already scoped in PROJECT.md as JWT + multi-tenant isolation | MEDIUM | Already a first-class requirement in PROJECT.md — not elaborated further here since it's covered by the security/architecture dimension of this research effort. |

### Differentiators (Competitive Advantage)

Not required for a functional tracker, but where a more mature/premium product distinguishes itself. Reasonable candidates for post-MVP or explicit "nice to have" framing.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Month-over-month comparison report | Matches PROJECT.md requirement directly ("comparação entre meses"); lets users see spending trend, not just a snapshot — cited as a distinguishing feature in Monarch/Copilot/PocketSmith | MEDIUM | Compare two periods' category summaries; delta + percentage change per category. Straightforward once the category/period summary exists — it's a differentiator mainly because many *simple* trackers skip it, not because it's technically hard. |
| Budget rollover (unspent/overspent carries to next month) | YNAB's key innovation over classic envelope budgeting: unspent balances roll forward instead of resetting to zero, letting users save toward irregular "true expenses" (annual fees, car repairs) inside a category | MEDIUM-HIGH | Explicitly out of scope territory for a v1 unless PROJECT.md requirements are revisited — adds statefulness (each month's budget depends on the prior month's leftover) and cross-period query complexity. Good candidate for "add after validation." |
| Net worth tracking (assets − liabilities over time) | Cited by Copilot/Monarch/MonthlyWorth as a headline feature; requires liability accounts (credit cards, loans) to be modeled with negative/owed semantics, which this project already has via credit card accounts | MEDIUM | Natural extension of "consolidated balance" once credit card accounts are properly signed as liabilities — worth flagging as a near-term differentiator since the groundwork (credit card as liability) is already a v1 requirement. |
| Recurring/scheduled transactions | Common in mature apps (subscriptions, rent, salary) to reduce manual entry and enable forecasting | MEDIUM-HIGH | Not in PROJECT.md scope; would need a scheduler/cron concept. Good v2 candidate. |
| Budget templates / category grouping (e.g. "Needs/Wants/Savings", 50/30/20) | Wallethub and multiple budgeting guides reference percentage-based category grouping as a popular differentiator for guiding new budgeters | LOW-MEDIUM | Pure UX/organization layer on top of existing categories; low technical cost if pursued, but adds product-opinion surface area. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Live bank sync (Plaid/Open Banking aggregation) | Users expect "connect my bank" like Monarch/Copilot/Mint did — feels like the modern standard | Massive scope/security/compliance surface (third-party credentials, webhook reconciliation, provider costs, PCI-adjacent handling) for a personal/portfolio project; directly conflicts with PROJECT.md's incremental, security-first, self-built approach | Manual transaction entry in v1; CSV import is already noted in PROJECT.md as a possible *future* extension (S3/Lambda pipeline), not bank aggregation |
| Multi-currency support | "Real" finance apps often support it | Currency conversion rates, historical FX, rounding rules — significant complexity with no stated user need (PROJECT.md doesn't mention multiple currencies) | Single currency (BRL or whichever the user operates in) for v1; revisit only if genuinely needed |
| Real-time collaborative/shared budgets (multi-user households) | Couples/family budgeting apps (Monarch, Copilot) support shared accounts | Conflicts directly with the multi-tenant isolation model already chosen (each user only accesses their own data); adds permission-sharing complexity disproportionate to a personal-use v1 | Keep single-owner-per-account model; shared budgeting is a distinct product shape, not a natural extension |
| Investment/brokerage tracking (stocks, crypto) | "Complete financial picture" apps (Copilot, Empower) include this | Requires market-data feeds, valuation logic, and asset classes entirely outside the account/category/transaction model already defined | Out of scope; not mentioned in PROJECT.md, keep the domain to cash-flow accounts |
| Automatic categorization via ML/rules engine | Mint/Monarch auto-categorize imported transactions to reduce manual work | Meaningful complexity (rule engine or ML classifier) for a feature that only pays off once bank sync/import exists — premature without that dependency | Manual category selection at transaction entry (already the plan, since there's no bank sync in v1) |
| Reports as CSV/PDF export or dashboards | Natural "next step" once JSON reports exist | Explicitly called out in PROJECT.md as out of scope for v1 ("relatórios v1 são só endpoints JSON") — building export/visualization now duplicates future front-end work | Return structured JSON from report endpoints; defer visualization to the future front-end phase |

## Feature Dependencies

```
Account management (typed accounts + balance)
    └──requires──> nothing (foundational)

Category management
    └──requires──> nothing (foundational)

Transaction tracking (income/expense)
    └──requires──> Account management
    └──requires──> Category management

Transfers between accounts
    └──requires──> Account management (2+ accounts)
    └──enhances──> Transaction tracking (reuses transaction model with type=TRANSFER)

Monthly budget limit per category
    └──requires──> Category management

Spent/remaining calculation
    └──requires──> Monthly budget limit per category
    └──requires──> Transaction tracking
    └──requires──> Transfers excluded from spend totals (correctness dependency, not sequencing)

Category/period summary report
    └──requires──> Transaction tracking
    └──requires──> Category management

Consolidated balance report
    └──requires──> Account management

Month-over-month comparison report
    └──requires──> Category/period summary report (reuses its aggregation twice)

Net worth tracking (differentiator)
    └──requires──> Account management (credit card as liability, signed correctly)
    └──enhances──> Consolidated balance report

Budget rollover (differentiator)
    └──requires──> Spent/remaining calculation
    └──requires──> Monthly budget limit per category (cross-period state)
```

### Dependency Notes

- **Transfers requires Account management (2+ accounts) and reuses Transaction tracking:** a transfer is not a new domain concept — cross-checked sources model it as a transaction pair or a transaction with a `TRANSFER` type touching two accounts. Build the transaction model with this in mind from the start (a `type` discriminator: `INCOME | EXPENSE | TRANSFER`) rather than retrofitting later — retrofitting risks breaking the spend-calculation exclusion rule.
- **Spent/remaining requires transfers to be correctly excluded:** this is the single most-cited pitfall pattern in the research (Actual Budget, Monarch both call it out explicitly). If budgets/reports sum "all transactions" instead of "all EXPENSE transactions," a credit-card-bill transfer will double-count spending that was already recorded when the original purchases happened. This should be flagged for the PITFALLS research file as well, but the dependency itself matters for phase ordering: transfers should be modeled *before* or *together with* the budget-consumption calculation, not after.
- **Month-over-month comparison enhances/reuses category summary:** don't build it as a separate aggregation path — implement the period-summary query once, parameterized by date range, and call it twice (current month, previous month) to diff.
- **Net worth enhances consolidated balance:** if credit card accounts are stored with a liability sign convention from the start (per Table Stakes), net worth becomes "sum of asset balances minus sum of liability balances" — nearly free once accounts are typed correctly. Getting the sign convention right early avoids a rewrite later.
- **Budget rollover requires cross-period state:** flagged as a differentiator specifically because it changes the budget model from stateless (compute on the fly from transactions + limit) to stateful (each month's effective limit depends on prior month's leftover). This is a meaningful complexity jump — recommend treating it as a deliberate "add after validation" decision, not baked into the v1 budget entity.

## MVP Definition

### Launch With (v1)

Minimum viable product — matches PROJECT.md's "Active" requirements directly; these are the table-stakes items with clear precedent across every finance app reviewed.

- [ ] Account CRUD with type (checking/savings/wallet/credit card) and current balance — foundational, nothing else works without it
- [ ] Category CRUD (income/expense types, user-defined) — foundational
- [ ] Transaction CRUD (income/expense) linked to account + category — the core recordable unit
- [ ] Transfers between accounts, excluded from spend/budget totals — required correctness behavior once 2+ accounts exist, and explicitly required by PROJECT.md
- [ ] Monthly budget limit per category — the planning primitive
- [ ] Spent/remaining calculation per category per month — the payoff of having budgets
- [ ] Category/period summary report (JSON) — "where did my money go"
- [ ] Consolidated balance report (JSON) — "how much do I have total"
- [ ] Month-over-month comparison report (JSON) — explicitly in PROJECT.md scope, cheap once period summary exists

### Add After Validation (v1.x)

Features to add once the core loop (record → budget → report) is proven to work end-to-end.

- [ ] Net worth over time — trigger: credit card accounts are already liability-signed, so this is a thin addition once the base reports are stable
- [ ] Budget rollover — trigger: real usage shows users want unspent category balances to carry forward (a genuine behavior change, not just a report)
- [ ] Category grouping/templates (Needs/Wants/Savings) — trigger: if the user (dual-purpose: real use + portfolio piece) wants a more opinionated budgeting UX

### Future Consideration (v2+)

Features to defer until the API + AWS deployment foundation (PROJECT.md's actual stated priority order) is complete and stable.

- [ ] Recurring/scheduled transactions — defer: needs a scheduling mechanism, no stated user need yet
- [ ] CSV import pipeline (S3 → Lambda → SES, per PROJECT.md future extension) — defer: explicitly called out as a future architecture extension, not initial focus
- [ ] Front-end/dashboards/exports — defer: explicitly out of scope in PROJECT.md; v1 is JSON-only

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|----------------------|----------|
| Account management (incl. credit card) | HIGH | LOW | P1 |
| Category management | HIGH | LOW | P1 |
| Transaction tracking | HIGH | LOW | P1 |
| Transfers between accounts | HIGH | MEDIUM | P1 |
| Monthly budget + spent/remaining | HIGH | MEDIUM | P1 |
| Category/period summary report | HIGH | LOW | P1 |
| Consolidated balance report | HIGH | LOW | P1 |
| Month-over-month comparison | MEDIUM | LOW | P1 (already scoped in PROJECT.md, cheap given summary exists) |
| Net worth tracking | MEDIUM | LOW-MEDIUM | P2 |
| Budget rollover | MEDIUM | MEDIUM-HIGH | P2 |
| Recurring transactions | LOW-MEDIUM | MEDIUM-HIGH | P3 |
| Bank sync (anti-feature) | HIGH (perceived) | VERY HIGH | Rejected |

**Priority key:**
- P1: Must have for launch (matches PROJECT.md Active requirements)
- P2: Should have, add when possible (differentiators with clear technical precedent already laid by P1 choices)
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | YNAB | Monarch Money / Actual Budget | Our Approach |
|---------|------|-------------------------------|--------------|
| Budgeting model | Zero-based envelope: every dollar assigned, unspent rolls over, "age your money" | Similar planned/spent/remaining model; Monarch offers opt-in rollover budgets | v1: simple `limit - spent = remaining` per category per month, no rollover (P1); rollover as explicit P2 addition once validated |
| Transfers | Modeled as a distinct transaction type excluded from budget category totals | Linked transaction pairs, excluded from spend/cash-flow totals; credit card payments modeled as transfers | Same pattern: `type=TRANSFER` transactions with two account legs, excluded from all budget/spend aggregations |
| Credit cards | Tracked as accounts; payments are transfers, not expenses | Same — credit card balance is a liability, payment is a transfer | Model credit card as an account type with liability-style balance semantics; card payment = transfer to that account |
| Reporting | Category-level "Age of Money," spending reports | Net worth dashboard, month-over-month trend charts, category breakdowns | v1 matches the reporting *content* (category/period, consolidated balance, month-over-month) but stays JSON-only per PROJECT.md — no dashboards/visualization yet |

## Sources

- [The Cash Envelope System (with Printable Workbook) | YNAB](https://www.ynab.com/blog/what-is-a-cash-envelope-system)
- [Envelope Budgeting in the Digital Age: Best Apps + Setup Guide](https://symplelending.com/insights/envelope-budgeting-in-the-digital-age-best-apps-setup-guide?hs_amp=true)
- [We Compared the Features of 126 Personal Finance Apps – Steal What Works](https://stealwhatworks.com/blogs/news/personal-finance-app-features)
- [Top Money Management Apps That Sync with Bank and Credit Accounts 2026 | Quicken](https://www.quicken.com/blog/top-money-management-apps-that-sync-with-bank-and-credit-accounts-2026/)
- [Transfers and Credit Card Payments – Help | Monarch Money](https://help.monarch.com/hc/en-us/articles/360048393292-Transfers-and-Credit-Card-Payments)
- [Transfers | Actual Budget](https://actualbudget.org/docs/transactions/transfers/)
- [How to Budget Using Multiple Accounts - Experian](https://www.experian.com/blogs/ask-experian/how-to-budget-using-multiple-accounts/)
- [I have two imported transactions for my credit card payment. What should I do? | Goodbudget](https://goodbudget.com/help/automatic-bank-sync/i-have-two-imported-transactions-what-should-i-do/)
- [Rollover Budgets – Help | Monarch Money](https://help.monarch.com/hc/en-us/articles/4411119762196-Rollover-Budgets)
- [Differences Between Planned, Spent, and Remaining – EveryDollar](https://everydollar.help.ramseysolutions.com/hc/en-us/articles/22368992992397-Differences-Between-Planned-Spent-and-Remaining)
- [How Budgeting Works | Actual Budget](https://actualbudget.org/docs/budgeting/)
- [MonthlyWorth - Simple Net Worth Tracker](https://www.monthlyworth.com/)
- [Copilot Money – Personal Finance App](https://www.copilot.money/)
- [Best Net Worth Tracker Apps & Websites: 7 Tools to See Your Complete Financial Picture - Wealthtender](https://wealthtender.com/insights/money-management/wealth-tracker-apps-and-websites-know-your-net-worth/)
- [Budget Percentages: How Much to Spend by Category in 2026 - WalletHub](https://wallethub.com/edu/b/budget-percentages/145359)
- Confidence tiers assigned via `gsd-tools query classify-confidence` (websearch, cross-checked = MEDIUM)

---
*Feature research for: Personal finance tracking API (accounts, categories, transactions, budgets, reports)*
*Researched: 2026-09-11*
