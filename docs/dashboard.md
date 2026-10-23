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

`getDashboardData` takes two clients on purpose: the base `prisma` for Better Auth's `user` and `session` (no `tenant_id`, outside RLS) and `tx` for the tenant row. Open gaps: *Convergence* below.

## The overview — `overview.ts` (v3, feature inventory §3.14)

`dashboardOverview(tx, caller, today, since)` is computed on request from the modules' read models — nothing stored:

- **To do** (`items`, the owner's; the accountant gets the month-end and the quarter only): bank lines to justify (`banking.listTransactions` on the main accounts, states open / partial → `/banking/inbox`), documents to review (`documents.inboxTotals` — the inbox's pending + ready, → `/documents/inbox`, [[document-inbox]]), documents linked to nothing (`linking.unlinkedDocuments`), supplier invoices overdue / due within 14 days (`supplierInvoices.kpis`), client invoices overdue, the owner's liability and the company-paid expenses awaiting their row (`expenses.ledgerSnapshot`), expenses without a receipt, ECB days without a rate in the last 30 days (`rates.rateGaps`, every fetched pair — EUR/SEK, EUR/CHF, EUR/USD — inner gaps of ≥ 3 weekdays and the trailing gap once a pair's newest rate is 4 days old, so the item shows the day before `getRate` refuses; the count is the distinct days missing in any pair, F81 → `/settings/rates`), last month's package not built / built with flags (`package.listBuilds` + `livePreview`), last quarter's Swiss VAT not declared / not paid — **one item per CH registration** (`exports.declaredOn(tx, quarter, registrationId)`, F56), opening `/exports?period=…&registration=…`. Each item carries its count, the amount when there is one, and the page that resolves it (list pages take `?f.<col>=in:<value>` filters). Sorted high → medium → low.
- **Business pulse** (`pulse`): the main accounts' balances as of their last booking date, receivables open per currency (Σ `remaining` of issued / sent / partially paid / overdue **invoices** — quotes and credit notes are no claim, F57; the hint counts the same invoices), payables open (SEK, the supplier KPIs), owed to the owner (SEK), invoiced this year (SEK base, credit notes deducted).
- **Briefing** (`briefing`): the audit trail since the last login grouped by entity type and action (`kernel/audit.activitySince`) — "2 bank transaction(s) created", "1 facture(s) modifié(s)": each type and action read through `dashboard.briefing.entity.*` / `.action.*` (`briefing-label.ts`); a type no dictionary knows yet reads as its spaced name. A new audited entity type adds its key in the three dictionaries (`briefing-label.pure.test.ts` lists them). Every write is audited, so the trail is the briefing; nothing else records events.

Strings `dashboard.*` (en + fr + sv); the widgets in `components/dashboard-widgets.tsx` on the D40 kit (F71): figures through `formatMoney`, each to-do line a `<StateIcon>` of its priority (`priority-family.ts` — high attention, medium in progress, low neutral) and a grey `<CountBadge>`, the page on `EntityPage`; the page `src/app/(app)/dashboard/page.tsx`. Tests: `overview.test.ts` (a world with every kind of item, the accountant's subset, an empty tenant), `e2e/dashboard.spec.ts`.

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

The suspects (the briefing's audit read, the rates gap check) are cheap; the 2.5–3 s seen in dev is the dev server. Nothing in this module is slow; the two biggest reads are other modules' list read models used as counters — F82 (banking) and F83 (package) if the page ever feels slow after B1.

## Convergence (F79, 2026-10-23)

`specs/dashboard/tasks.md` Phase 1: T001 the header's `try / catch` inside the tenant transaction (and the unused `getDashboardDataAction`), T002 the quarter's name and the *main* role re-stated here, T003 SC-001's world misses four item kinds, ~~T004 the briefing's English entity names and two missing actions (i18n)~~ (2026-10-23), ~~T005 the page's dates~~ (2026-10-23), T006 the *due within 14 days* link unfiltered. Owned elsewhere: F66 (the partner / contract counts), F70 (`SEK`), ~~F71 (money and badges)~~ (T007, 2026-10-23), F82 / F83 (speed).

## Related

- [[server-actions]] — Middleware chain and RBAC patterns
- [[hexagonal-architecture]] — Import boundary rules
- [[observability]] — Request-scoped logging
