# Dashboard

The dashboard is the landing page for all authenticated users. It follows the **Dashboard** page archetype.

## Page Archetypes

DefterFab uses five page archetypes to maintain consistent UX:

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

## Dashboard Data Flow

```
page.tsx → actions/dashboard.ts → services/dashboard.ts → Prisma
                                       ↓
                              Dual client pattern:
                              - prisma (base): user, session tables
                              - tx (RLS-scoped): tenant table
```

The dashboard service is an **intentional exception** to the single-client pattern because Better Auth's `user` and `session` tables have no `tenant_id` column.

## The overview — `overview.ts` (v3, feature inventory §3.14)

`dashboardOverview(tx, caller, today, since)` is computed on request from the modules' read models — nothing stored:

- **To do** (`items`, the owner's; the accountant gets the month-end and the quarter only): bank lines to justify (`banking.listTransactions` on the main accounts, states open / partial → `/banking/inbox`), documents to review (`documents.getDocumentStats`), documents linked to nothing (`linking.unlinkedDocuments`), supplier invoices overdue / due within 14 days (`supplierInvoices.kpis`), client invoices overdue, the owner's liability and the company-paid expenses awaiting their row (`expenses.ledgerSnapshot`), expenses without a receipt, ECB days without a rate in the last 30 days (`rates.detectGaps`, ≥ 3 weekdays → `/settings/rates`), last month's package not built / built with flags (`package.listBuilds` + `livePreview`), last quarter's Swiss VAT not declared / not paid (`exports.declaredOn`). Each item carries its count, the amount when there is one, and the page that resolves it (list pages take `?f.<col>=in:<value>` filters). Sorted high → medium → low.
- **Business pulse** (`pulse`): the main accounts' balances as of their last booking date, receivables open per currency (Σ `remaining` of issued / sent / partially paid / overdue invoices), payables open (SEK, the supplier KPIs), owed to the owner (SEK), invoiced this year (SEK base, credit notes deducted).
- **Briefing** (`briefing`): the audit trail since the last login grouped by entity type and action (`kernel/audit.activitySince`) — "2 bank transaction created, 1 invoice updated". Every write is audited, so the trail is the briefing; nothing else records events.

Strings `dashboard.*` (en + fr); the widgets in `components/dashboard-widgets.tsx`; the page `src/app/(app)/dashboard/page.tsx`. Tests: `overview.test.ts` (a world with every kind of item, the accountant's subset, an empty tenant), `e2e/dashboard.spec.ts`.

## Toast Infrastructure

[[Sonner]] is installed as the toast provider via `<Toaster />` in the root layout. No toast calls exist yet — first consumers arrive in Epic 3 mutations.

## Related

- [[server-actions]] — Middleware chain and RBAC patterns
- [[hexagonal-architecture]] — Import boundary rules
- [[observability]] — Request-scoped logging
