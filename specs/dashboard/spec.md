# Feature Specification: Dashboard — to do, pulse, briefing

**Feature Branch**: `feat/dashboard-overview` · **Created**: 2026-10-20 · **Status**: Built (feature inventory §3.14; D14's cash-planning widget stays Growth)

**Input**: "When I open the app I want to see what I have to do — lines to justify, receipts missing, the package to send, the VAT to declare — each with the number and a link, the figures of the moment, and what happened since I last looked."

## User Stories

- **US1 To do** (P1): every item with its count (and amount), ordered by urgency, leading to the page that resolves it. Nothing to do → says so. The accountant sees only the month-end and the quarter.
- **US2 Pulse** (P1): balances of the main accounts as of their last booking date, receivables open per currency, payables open, owed to the owner, invoiced this year.
- **US3 Briefing** (P2): what happened since the last login, from the audit trail, grouped by entity and action.

- **US4 Work — the monthly close** (P1, D76 phase 4, F137): the owner's loop as he wrote it (2026-11-07): "1. make sure the exchange rates are up to date 2. import the bank CSV files 3. for each transaction make sure it is justified 4. add private expenses — this should be enough to tell me: you have completed everything needed for this month (like a progress line)". `/work` — *Work* in the rail — shows one month (default: last month until its package is built, then this month; ‹ › to move): the title *July 2026 is 62 % done* and one sentence of what is left; a **progress line of five steps** — *Exchange rates* (every weekday of the month has its ECB rate — FR-009's gaps), *Bank statements* (every main account's balance chain complete to the month's last day), *Every bank row justified* (the Months panel's counts), *Private expenses* (how many the month has — no derivation can know they are all there: the step is done when the month is closed), *Month closed* (the package for the accountant built) — each with its facts and the one action that moves it; **Also waiting** (the dashboard's items that are not part of the close: overdue invoices, documents to review, subscriptions, VAT…); **Past months** (the last six: closed on which day, or what is left) and the streak of months closed in a row. Built from the board *Pulse · Work* (D77). The linking inbox stays at `/banking/inbox` (Banking › Inbox; the reconcile phase reworks it).

- **US5 Home — the year at a glance** (P1, D76 phase 4b, F138): the dashboard rebuilt from the board *Pulse* (D77) with the owner's picks of 2026-11-07 — **must**: the cash with its trend, the next moves, the currencies and the exposure, the monthly close's line, the past months and the streak; **nice** (taken when cheap): the situation sentence, the year's justified ring. The hero: *Cash · all accounts, in {base}* — every statement account's latest balance through today's rate, the month's move, the twelve months' line; one sentence (what is late, where the close stands and its next step); the year's figures (receivables, payables, owed to you, invoiced) and a ring of the year's bank rows justified. *Next moves*: the dashboard's items, the most urgent first, three shown and the others on demand; for the owner a line to Work — the close's month, rows done, the streak. *Currencies*: each currency against the base over 90 days (now, the change, a line), each account's share of the cash, what a 1 % move of the main foreign currency is worth. The briefing since the last visit stays. Left for later: the year heat map, the cash forecast, the money-flow chart, the tax set-aside, *move CHF to SEK*.

## Requirements

- **FR-001** `dashboardOverview(tx, caller, today, since)` — computed on request from the modules' read models (no stored state, no notification system); the items of `docs/dashboard.md`.
- **FR-002** `kernel/audit.activitySince(tx, since)` — the trail grouped by entity type and action.
- **FR-004** (F137) `monthlyClose(tx, caller, month, today)`: the five steps of US4 for a month, each `done | current | todo | waiting` with its counts, derived from the owners' reads — `rates.rateGaps`, `banking.bankMonths` (completeness per main account, justified / to justify), `expenses.listExpenses` (the month's privately paid expenses), `package.listBuilds` (built, when); `pastCloses` the six months before with the day each was built and the streak. Nothing stored.
- **FR-005** (F137) The invoice reminder: for the month shown, the clients with an invoice (type invoice, any state — a draft counts as prepared) issued in the month before's window and none in this month's; a window runs from the 21st of the work month to the 20th of the next. Shown from the window's first day on; *Prepare the invoice* opens a new invoice.
- **FR-006** (F138) `cashSummary`: the cash in the base — per statement account the balance of the latest booking date on or before the day (`banking.balanceHistory`), through the nearest-day rate of that day (`rates.rateToBase`); the total today, at the end of each of the last twelve months, the move since last month's last day; an account without a rate today is left out and the summary says so; each account's share; 1 % of what is held in each foreign currency, in the base. Nothing stored.
- **FR-007** (F138) The tickers: each of the app's currencies ≠ base over the last 90 days — the rates page's cross (`rates.crossSeries`), now, the change over the window (1 dp), the points.
- **FR-008** (F138) `homeSentence`: *N thing(s) are late* (the high-priority items) — then, for the owner, *{month} is P % done — next: {the current step's words}* or *{month} is closed*.
- **FR-003** Strings `dashboard.*` en + fr; the three widgets; the page uses the user's locale.

## Success Criteria

- **SC-001** `overview.test.ts`: a world with one of each item → the expected kinds, counts, amounts, hrefs, priorities; the pulse figures; the briefing lines; the accountant's subset; an empty tenant.
- **SC-002** `e2e/dashboard.spec.ts`: an imported row shows as *bank line(s) to justify* and leads to the inbox; the accountant's page.
