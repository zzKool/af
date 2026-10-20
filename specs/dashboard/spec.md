# Feature Specification: Dashboard — to do, pulse, briefing

**Feature Branch**: `feat/dashboard-overview` · **Created**: 2026-10-20 · **Status**: Built (feature inventory §3.14; D14's cash-planning widget stays Growth)

**Input**: "When I open the app I want to see what I have to do — lines to justify, receipts missing, the package to send, the VAT to declare — each with the number and a link, the figures of the moment, and what happened since I last looked."

## User Stories

- **US1 To do** (P1): every item with its count (and amount), ordered by urgency, leading to the page that resolves it. Nothing to do → says so. The accountant sees only the month-end and the quarter.
- **US2 Pulse** (P1): balances of the main accounts as of their last booking date, receivables open per currency, payables open, owed to the owner, invoiced this year.
- **US3 Briefing** (P2): what happened since the last login, from the audit trail, grouped by entity and action.

## Requirements

- **FR-001** `dashboardOverview(tx, caller, today, since)` — computed on request from the modules' read models (no stored state, no notification system); the items of `docs/dashboard.md`.
- **FR-002** `kernel/audit.activitySince(tx, since)` — the trail grouped by entity type and action.
- **FR-003** Strings `dashboard.*` en + fr; the three widgets; the page uses the user's locale.

## Success Criteria

- **SC-001** `overview.test.ts`: a world with one of each item → the expected kinds, counts, amounts, hrefs, priorities; the pulse figures; the briefing lines; the accountant's subset; an empty tenant.
- **SC-002** `e2e/dashboard.spec.ts`: an imported row shows as *bank line(s) to justify* and leads to the inbox; the accountant's page.
