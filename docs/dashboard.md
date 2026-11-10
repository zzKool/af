# Dashboard

The dashboard is the landing page for all authenticated users. It follows the **Dashboard** page archetype.

## Page Archetypes

AF uses five page archetypes to maintain consistent UX:

| Archetype | Example | Key Traits |
|---|---|---|
| **Dashboard** | `/dashboard` | Welcome + widgets, server-rendered, no forms |
| **Entity List** | `/journal`, `/partners` | Filterable table, pagination, bulk actions |
| **Entity Detail** | `/partners/[id]` | Read/edit form, related entities, audit trail |
| **Workbench** | `/reconciliation` | Split-pane interactive workspace |
| **Multi-step Flow** | `/banking/import` | Wizard with progress indicator |

## Route Configuration

Navigation items are centralized in `src/kernel/nav/constants.ts` as the `NAV_ITEMS` array.

### Enabling a new route

1. Build the page in `src/app/(app)/[route]/page.tsx`
2. Set `enabled: true` for the corresponding entry in `NAV_ITEMS`
3. The sidebar automatically picks up the change via [[nav-filter]] logic

### NAV_ITEMS structure

```ts
type NavItem = {
  path: string;      // Route path (e.g., "/journal")
  label: string;     // Display label
  icon: string;      // lucide-react icon name
  roles: Role[];     // Which roles can see this item
  enabled: boolean;  // Whether the page exists yet
};
```

### Role-based filtering

The sidebar filters items by `enabled && roles.includes(userRole)`. This is **UI convenience only** — [[server-actions]] enforce RBAC server-side via `ownerAction` / `authedAction`.

## Locale Resolution

Display formatting uses the browser's `Accept-Language` header, resolved via `src/kernel/i18n/locale.ts`:

- **NEVER** hardcode `sv-SE` for display formatting
- `resolveLocale(header)` parses quality factors and returns the best match
- `formatDateTime(date, locale)` and `formatDateShort(date, locale)` take explicit locale parameters
- Server components read locale from `headers()` → `Accept-Language`

Note: `clock.ts` uses `sv-SE` internally for YYYY-MM-DD business keys — that's a server-side format choice, not a display locale.

Dates on the page: timestamps (last login, the briefing's *since*) through `formatDateTime` in the UI language; days (a balance's *as of*) as `yyyy-mm-dd` (D40).

## Dashboard Data Flow

```
page.tsx ── withTenantTransaction (one interactive transaction, the reads one after the other)
   ├─ dashboard.ts  getDashboardData(prisma, tx, caller)   the header: name, company, last login
   ├─ settings      getUserPreferences                      the locale
   └─ overview.ts   dashboardOverview(tx, caller, today, since)   items · pulse · briefing
```

`getDashboardData` takes two clients on purpose: the base `prisma` for Better Auth's `user` and `session` (no `tenant_id`, outside RLS) and `tx` for the tenant row. The `tx` read is never caught: a failed statement aborts the page's one transaction, so an error reaches `error.tsx` with its first cause, not as an empty company name and a misleading *current transaction is aborted* on the next read (T001). The base-client `session` read keeps its fallback (no last login). The header has no partner or contract counts — nothing rendered them (lessons audit 25). Open gaps: *Convergence* below.

## The overview — `overview.ts` (v3, feature inventory §3.14)

`dashboardOverview(tx, caller, today, since)` is computed on request from the modules' read models — nothing stored:

- **To do** (`items`, the owner's; the accountant gets the month-end and the quarter only): bank lines to justify (`banking.rowsToJustifyCount` — the main accounts' open / partial rows as a count, the sidebar's number, F82 → `/banking/inbox`), documents to review (`documents.inboxTotals` — the inbox's pending + ready, → `/documents/inbox`, [[document-inbox]]), documents linked to nothing (`linking.unlinkedDocuments`), supplier invoices overdue / due within 14 days (`supplierInvoices.kpis`; *due* opens `?f.status=in:unpaid|partially_paid&f.dueDate=dates:from=<today>|to=<today+DUE_SOON_DAYS>`, the KPI's own window), client invoices overdue, the owner's liability and the company-paid expenses awaiting their row (`expenses.ledgerSnapshot`), expenses without a receipt, ECB days without a rate in the last 30 days (`rates.rateGaps`, every fetched pair — EUR/SEK, EUR/CHF, EUR/USD — inner gaps of ≥ 3 weekdays and the trailing gap once a pair's newest rate is 4 days old, so the item shows the day before `getRate` refuses; the count is the distinct days missing in any pair, F81 → `/settings/rates`), last month's package not built / built with flags (`package.listBuilds` + `periodFlags` — the flags without collecting the package, F83), the subscription periods that need the owner (F94 — `subscriptions.attentionCounts`: *to confirm*, *charge missing*, *receipt / bill missing*, the three counts in the sentence through the item's `params`; an overdue supplier-invoice period is left to the supplier-invoices item; medium; → `/subscriptions?f.attention=range:1:`), last quarter's Swiss VAT not declared / not paid — the quarter named by `exports.periodOfDate` (the stored `declaration_period`), **one item per CH registration** (`exports.declaredOn(tx, quarter, registrationId)`, F56), opening `/exports?period=…&registration=…`. Each item carries its count, the amount when there is one, and the page that resolves it (list pages take `?f.<col>=in:<value>` filters). Sorted high → medium → low.
- **Business pulse** (`pulse`): the main accounts' balances (`banking.listMainAccountIds` says which) as of their last booking date, receivables open per currency (Σ `remaining` of issued / sent / partially paid / overdue **invoices** — quotes and credit notes are no claim, F57; the hint counts the same invoices), payables open (SEK, the supplier KPIs), owed to the owner (SEK), invoiced this year (SEK base, credit notes deducted).
- **Briefing** (`briefing`): the audit trail since the last login grouped by entity type and action (`kernel/audit.activitySince`) — "2 bank transaction(s) created", "1 facture(s) modifié(s)": each type and action read through `dashboard.briefing.entity.*` / `.action.*` (`briefing-label.ts`); a type no dictionary knows yet reads as its spaced name. A new audited entity type adds its key in the three dictionaries (`briefing-label.pure.test.ts` lists them). Every write is audited, so the trail is the briefing; nothing else records events.

Strings `dashboard.*` (en + fr + sv); the widgets in `components/dashboard-widgets.tsx` on the D40 kit (F71): figures through `formatMoney`, each to-do line a `<StateIcon>` of its priority (`priority-family.ts` — high attention, medium in progress, low neutral) and a grey `<CountBadge>`, the page on `EntityPage`; the page `src/app/(app)/dashboard/page.tsx`. Tests: `overview.test.ts` (a world with one of every kind of item — `documents_to_review` and `vat_not_paid` in their own tests —, the accountant's subset, an empty tenant), `e2e/dashboard.spec.ts`.

## Home — the year at a glance (F138, D76 phase 4b)

`/dashboard`, rebuilt from the board *Pulse* (D77) with the owner's picks: the cash with its trend, the next moves, the currencies and the exposure, the close's line and the streak (must); the situation sentence and the year's ring (nice, cheap).

```
┌ Cash · all accounts, in SEK ──────────────────────┐ ┌ Next moves  3 of N ────────────┐
│ 127 500  SEK   ▲ 27 500 this month  ╱╲_╱‾ (12 mo) │ │ 1 … [Open]  2 …  3 …          │
│ N thing(s) are late. July is 57 % done — next: …  │ │ Show the other N               │
│ Receivables · Payables · Owed to you · Invoiced   │ │ ▬▬▬▬░░ July · 35 of 41 rows    │
│                                   ( 87 % ring )   │ │ 3 month(s) closed in a row     │
└───────────────────────────────────────────────────┘ └────────────────────────────────┘
┌ Since your last visit (briefing) ─────────────────┐ ┌ Currencies  SEK per unit · 90 d ┐
                                                      │ CHF  EUR  USD (now, %, line)   │
                                                      │ ▬▬▬▬▬▬▬░░ shares · 1 % move    │
```

- `homeData(tx, caller, today, since)` (`home.ts`): the overview (read once, handed to `workData`), the cash, the tickers, the year's rows (the Months panel's counts), and the owner's Work (null for the accountant — no close line).
- **The cash** (`cashSummary`, pure): `banking.balanceHistory(tx, days)` gives each statement account's balance on each day — the balance of the latest booking date on or before it, the file's first row of that date (the rule of `accountBalances`); the days are the last day of each of the twelve months before this one, then today. Each balance through that day's nearest-day rate to the base; an account with no rate today is left out of the total and the hero says so. The month's move = today − last month's last day (it includes the currency effect — it is the cash in the base). The 1 % sentence takes the largest foreign holding.
- **The tickers**: the rates page's cross over 90 days (`TICKER_DAYS`), now and the change over the window; a ticker links to `/rates`.
- **The sentence** (`homeSentence`, server-side): the high-priority items, then the close's month, percent and current step in Work's words.
- Retired: `ActionItemsWidget` and `BusinessPulseWidget` (the moves and the hero's figures replace them; the per-account balances moved to the currencies' shares). `BriefingWidget` stays.

Tests: `home.pure.test.ts`, `home.test.ts` (an invented world: balances in CHF and SEK, rates at 12.5), `components/home.test.tsx` (F71's money and state checks carried over), `e2e/dashboard.spec.ts`.

### The year, week by week (F158, the owner's gap audit 2026-11-09)

Under the cash and the next moves, full width: `YearStrip` (`components/year-strip.tsx`) over `yearWeeks` (`year-weeks.ts`, pure, `year-weeks.pure.test.ts`). Fifty-two weeks back from today's (Monday → Sunday, the ISO number): on top the money in (up) and out (down) of the statement accounts in the base (a square-root scale, as the bank's day strip); under it one square per statement account per week — **done** (every row justified) · **open** (rows to justify, in last month or this one: the close still runs) · **late** (rows to justify in a month before last month: its close is past) · **nothing that week**. A week is a button: its range, in and out (whole units), how many rows are still to justify, *Open this week* → Banking filtered to the week (`f.bookingDate=dates:from=…|to=…`). Built from the day cells `bankMonths` already gives the home — no new read.

**The books' rows (F171)** under the accounts, the board's *Invoices · Expenses · Documents*: one square per week, the worst of the week's things (late › open › done › nothing). `bookFacts` (`home.ts`) reads each module's own list through its `index.ts` — `invoices.listInvoices` (issued that week), `expenses.listExpenses` (dated that week), `documents.listDocuments` (received that week, the Stockholm day of `created_at`) — and the pure mappers in `year-weeks.ts` turn each module's derived state into the strip's family; nothing stored:

| Row | done | open | late |
|---|---|---|---|
| Invoices (`invoiceCell`) | paid · credited | issued · sent · partly paid | overdue (the invoice's own state) |
| Expenses (`expenseCell`) | paid / refunded **and** justified (receipt attached, declared lost, or a per diem) | otherwise | otherwise, dated before last month |
| Documents (`documentCell`) | filed · archived | in the inbox (OCR pending / failed, ready) | in the inbox, received before last month |

| Subscriptions (`subscriptionCell`, F181) | the period *done* (charged and justified: paid with its receipt / bill; a private one with its receipt) | expected but not seen, or seen and not justified (*upcoming* this week, *due*, *charged* without a receipt, *documented* not paid) | the same, expected before last month |

Drafts, quotes, credit notes and the app's own PDFs are not on the rows. The week's panel lists each row that has something (*2 invoice(s) issued · 1 not paid yet*).

**The subscriptions row (F181)**, the board's last lane: one square per expected charge, on its expected date — the subscriptions module's own periods (`subscriptions.expectedCharges(tx, caller, from, to, today)`, `queries.ts`: every period of the strip's weeks with its derived state and marks, over `loadSubscriptions`). A paused period (*skipped*) is not on the row; the periods after this week's Sunday are not in the strip. Nothing stored.

The cash headline and its month are **whole units** (`formatMoney(…, { whole: true })`, half up — the board's *693 295 SEK*); every other figure keeps its cents.

## Work — the monthly close (F137, D76 phase 4)

`/work` — *Work* in the rail, the owner's (the accountant has no Work; `requireCaller` sends him to the dashboard) — is the owner's monthly loop as he wrote it (2026-11-07): the exchange rates up to date, the bank statements imported, every bank row justified, the private expenses added — and the package that ends the month. Built from the board *Pulse · Work* (D77). The linking inbox stays at `/banking/inbox` (Banking › Inbox). Its rail badge is the one count of `specs/justify` FR-007 — the rows to justify + the documents to review (`kernel/nav/nav-counts.ts`, F182).

```
workData(tx, caller, today, month?)          close.ts — read only, nothing stored
   ├─ package.listBuilds        the day each month's first package was built (Stockholm day)
   ├─ banking.bankMonths        the months' rows justified / to justify · each account's completeTo
   ├─ rates.rateCoverage        the weekdays without an ECB rate, per month (FR-009's gaps)
   ├─ expenses.listExpenses     the privately paid expenses dated in the months shown
   ├─ invoices.listInvoices     the invoices of the two invoice windows (the reminder)
   └─ dashboardOverview         Also waiting = its items minus the close's own (rows, rate gaps, package)
```

- **The steps** (`closeSteps`, pure): *rates* done when no weekday of the month misses a rate; *statements* done when every **main** account's balance chain reaches the month's last day (savings come once a year — not a monthly step); *justified* done when no row is left to justify (and the month has rows, or its statements are in); *private expenses* and *month closed* done when the package is built — nothing else can know every receipt is in (an open question to the owner: a *nothing more to add* tick would be a stored fact). The first step not done is *current*; the package *waits* until the four before it are done. The percent: each step a fifth, the rates / statements / rows by their fraction.
- **The month**: `?month=yyyy-mm`; without it, last month until its package is built, then this month (`defaultCloseMonth`). ‹ › move one month, between the first month the Months panel knows and this month.
- **The invoice reminder** (FR-005, `invoiceReminders`): a client invoiced in the month before's window and not in this one's — a window runs from the 21st of the work month to the 20th of the next; a draft counts as prepared. Shown from the window's first day.
- **Past months**: the six before this month — *closed {day}* or how far — and the streak of months closed in a row back from last month (last month still open does not break it, `closeStreak`).

Strings `work.*` (en only, D62); the view `components/work-page.tsx` (`MonthlyCloseView`, `WorkMonthNav`), the header's sentence `work-text.ts`; the page `src/app/(app)/work/page.tsx` on the ground (D76). Links that look like buttons are `<Link className={buttonVariants()}>` — a link stays a link. Tests: `close.pure.test.ts` (the steps, the default month, the streak, the reminder), `close.test.ts` (a small world on the real modules), `work-page.test.tsx`, `e2e/work.spec.ts`; `/work` in `screenshots.spec.ts`.

## Speed (F55, measured 2026-10-23)

`next build` + `next start`, the seeded tenant filled with ~3.5 years of the owner's volume (2023-04 → 2026-10: 1 596 bank rows, 49 invoices, 336 expenses, 210 supplier invoices, 1 764 documents, 64 000 audit rows), 12 requests, median. The page's one transaction runs the reads **one after the other** (an interactive transaction is one connection), so the page time is their sum.

```
/dashboard (server, prod)      ≈ 0.35 s   ← dev server on the same data ≈ 0.8 s warm, 22 s the first compile
 ├─ banking.listTransactions   ≈ 117 ms   rows to justify: lists + derives every main-account row for a count
 ├─ package.livePreview        ≈  75 ms   last month's flags: collects the whole package
 ├─ documents.inboxTotals      ≈  29 ms
 ├─ expenses.listExpenses      ≈  25 ms   receipts missing: a list for a count
 ├─ linking.unlinkedDocuments  ≈  13 ms
 ├─ audit.activitySince        ≈  11 ms   (≈ 43 ms with a last login in 2023)
 ├─ rates.rateGaps             ≈   4 ms   (measured as detectGaps, one pair; now one query for three)
 └─ eight more                 <  10 ms each
```

The suspects (the briefing's audit read, the rates gap check) are cheap; the 2.5–3 s seen in dev is the dev server. Nothing in this module is slow; the two biggest reads were other modules' list read models used as counters — F82 (banking) and F83 (package), done below.

### F82 · F83 (2026-10-24) — counts, not lists

The same volume rebuilt through the services with invented data (1 591 bank rows, 43 invoices, 344 expenses, 215 supplier invoices, 2 394 documents, 1 868 links), timed inside one tenant transaction in the server test runner (12 runs after 2 warm-ups, median — slower than the prod server above, so compare the columns, not with F55):

```
                                   before     after
rows to justify                    140 ms  →   57 ms   banking.listTransactions → rowsToJustifyCount (F72's count, same 110)
last month's flags                 144 ms  →   53 ms   package.livePreview → periodFlags (same 19 flags)
dashboardOverview                  452 ms  →  281 ms   −38 %
```

- **F82** — the count already existed: F72's `banking.rowsToJustifyCount` (the sidebar's badge); the dashboard now reads it. `open-work.test.ts` holds it equal to the list's `total` (open rows, a fee, savings, a transfer pair, a fully and a partly justified row).
- **F83** — `package.periodFlags(tx, period, today)`: the rows and selection of the collector, its flag builders, and the three lists read in a **date window** (the period widened to the dates of what a period row justifies, from each owner's linkable `facts`) instead of whole — no notes, sheets, key index or ledger. `package.test.ts` holds it equal to `livePreview(…).flags` on the fixture month and on a month whose rows pay an April expense, a May supplier invoice and a June invoice; on the volume, all 43 months gave identical flags.
- Left: `rowsToJustifyCount` is now the biggest read (≈ 50 ms here) — its last step loads whole journal entries for one flag ([[lessons]] F72: `journal.noDocumentFlags`, the journal's lane).

## Convergence (F79, 2026-10-23)

`specs/dashboard/tasks.md` Phase 1: ~~T001 the header's `try / catch` inside the tenant transaction (and the unused `getDashboardDataAction`)~~ (2026-10-23), ~~T002 the quarter's name and the *main* role re-stated here~~ (2026-10-23), ~~T003 SC-001's world misses four item kinds~~ (2026-10-23), ~~T004 the briefing's English entity names and two missing actions (i18n)~~ (2026-10-23), ~~T005 the page's dates~~ (2026-10-23), ~~T006 the *due within 14 days* link unfiltered~~ (2026-10-23). Owned elsewhere: ~~F66 (the partner / contract counts)~~ (gone with T001), F70 (`SEK`), ~~F71 (money and badges)~~ (T007, 2026-10-23), ~~F82 / F83 (speed)~~ (2026-10-24).

## Related

- [[server-actions]] — Middleware chain and RBAC patterns
- [[constitution]] — Import boundary rules
- [[observability]] — Request-scoped logging
