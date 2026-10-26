# F93 — Global search (Ctrl K)

LIGHT lane (D45) · decision D56 · branch `feat/search-palette` · docs [[search]]

One palette, opened from anywhere, finds a page **or an entity** by what the owner has in front of him: a key, a name, a number on a bank row, an amount.

## What is searched

| Group (kind) | Module | Matched on | Opens |
|---|---|---|---|
| Pages | `kernel/ui/shell` (client side, no query) | page name in the UI language (today's Ctrl P) | the page |
| Partners | partners | name, short code, org / VAT number | `/partners/<id>` |
| Invoices (quotes, invoices, credit notes; drafts too) | invoices | number `VA23-INV-001`, period label, total | `/invoices/<id>` |
| Supplier invoices | supplier-invoices | key `SI213-Acc-01`, the supplier's number `9160`, total / paid amount | `/supplier-invoices?open=<id>` |
| Expenses | expenses | key `Ex213-Tr-01`, description, amount / paid amount | `/expenses?open=<id>` |
| Settlements | expenses | number `ST23-001`, note, refund amount | `/expenses/settlements/<id>` |
| Documents | documents | business key, file name | `/documents/<id>` |
| Bank rows | banking | description, name, message, details, reference, own notes, counterparty; amount (either sign) | `/banking?open=<id>` |

**Amounts** — a query that reads as a number is also an amount: `1250`, `1 250`, `1250.00`, `1250,00`, `1'250`, `1’250.50`, `1,250.00`, `1.250,00` all mean 1250(.00). Spaces (incl. no-break / thin), `'` `’` group thousands; a `.` or `,` followed by **exactly three** digits is a thousands separator, followed by one or two digits it is the decimal mark (no amount has three decimals). Any currency matches; the hit shows its own.

**Not searched (yet)**: contracts, journal entries, traktamente trips, OCR text. A module joins later by adding one search function (below).

## Ranking

Inside a group, best first, then newest:

```
0 exact key (or short code, or the supplier's number)   VA23-INV-001
1 key starts with the query                              VA23-INV
2 amount equal                                           1 250
3 key / name contains                                     INV-00
4 another text contains (bank row details, file name …)
```

Groups: those with an exact-key hit first, then Pages, then the others by their best hit; ties in the table's order. **≤ 5 hits per group**; when more exist, *See all* opens the module's list with `?q=` (the list's own search applies there).

## How modules plug in

```
app/(app)/layout.tsx ── searchAction (app/(app)/search.actions.ts, the composition root)
        │                   │ one tenant tx, sequential:
        ▼                   ├─ partners.searchPartnerHits(tx, caller, q)        ┐
   AppShell → Topbar        ├─ invoices.searchInvoiceHits(tx, caller, q)        │ each: can(read) → []
        → SearchPalette     ├─ supplierInvoices.searchSupplierInvoiceHits(…)    │ one query (+ one batched
          (kernel/ui/shell, ├─ expenses.searchExpenseHits / searchSettlementHits│ partner-name lookup for the
           the action as a  ├─ documents.searchDocumentHits(…)                  │ ≤ 5 shown hits)
           prop)            └─ banking.searchBankTransactionHits(…)             ┘
```

- `kernel/search` owns the shared shapes and the pure rules: `SearchHit {kind, id, key, label, date, amount?, currency?, href, rank}`, `SearchGroup {kind, hits, more, seeAllHref}`, `parseSearchQuery` (text + amount), `rankOf`, `toGroup`, `orderGroups`. It imports no module.
- Each module owns `search.ts` → `search<Kind>Hits(tx, caller, q): Promise<ServiceResult<SearchGroup>>`, exported from its `index.ts`. It checks `can(caller, "read", <subject>)` (an empty group otherwise), runs **one** query (`take` 50, newest first), ranks with the kernel rules, keeps 5. Documents also filter relationship documents out for a role that may not read them (the accountant).
- **No registry**: nothing imports every module at load (the linking-cycle lesson). The app layer — already the place that composes the sidebar counts — lists the functions in one array; a new module is one line there plus its `search.ts` + test.
- RLS is the tenant wall (the tx carries `app.tenant_id`); `can()` is the role wall. The action is `authedAction` (any role, rate-limited like every action).

## The palette

- **Ctrl K / ⌘ K** opens it from anywhere, **Ctrl P / ⌘ P** too (one search, the browser's print stays suppressed). The top bar keeps its search box, now a button that opens the palette.
- A dialog (the kit's `Dialog`, no new dependency) with a `combobox` input and a `listbox` of groups (`group` + `option`, `aria-activedescendant`). ↑ ↓ move, Enter opens, Esc closes; mouse works too.
- Empty query → the top-level pages. ≥ 2 characters → entities (debounced 150 ms; an older answer never overwrites a newer one).
- Strings en / fr / sv; landmark names stay English literals (af-design).

## Done when

- Per module: a test with an exact key, a partial name, the amount formats, another tenant's row never found, and a role that may not read gets nothing.
- `kernel/search` pure tests (amount formats, ranking, group order).
- e2e `search.spec.ts`: creates its own invoice, Ctrl K, types the key, Enter opens it.
- Volume measured (`scripts/seed-volume.ts`, ~1 600 bank rows, ~2 400 documents); a trigram index only if the numbers ask for it (a schema PR of its own).
- Screenshot in `specs/search/screenshots/`, `docs/search.md`, row F93 in [[features]].
