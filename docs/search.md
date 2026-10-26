# Global search — the Ctrl K palette

F93 · D56 · spec `specs/search/spec.md` · built 2026-10-26.

One palette, opened from anywhere with **Ctrl K / ⌘ K** (Ctrl P / ⌘ P too — the old page search is now its *Pages* group), finds a page or an entity: a key, a name, the supplier's number, a bank row's text, an amount in any format and any currency. Enter opens the entity by its deep link; *See all* opens the module's list with `?q=`.

## How it is built

```
app/(app)/layout.tsx ── search={globalSearchAction}            the composition root (like the sidebar counts)
        │                       │
        ▼                       ▼ app/(app)/search.actions.ts  authedAction → searchAll(tx, caller, q)
 AppShell → Topbar             app/(app)/search.ts             SEARCHES = [one function per kind] — sequential, one tx
   → SearchPalette                  │
     kernel/ui/shell                ├─ modules/partners/search.ts           searchPartnerHits
     (Dialog + combobox,            ├─ modules/invoices/search.ts           searchInvoiceHits
      Pages filtered here)          ├─ modules/supplier-invoices/search.ts  searchSupplierInvoiceHits
                                    ├─ modules/expenses/search.ts           searchExpenseHits · searchSettlementHits
                                    ├─ modules/subscriptions/search.ts      searchSubscriptionHits (F94)
                                    ├─ modules/documents/search.ts          searchDocumentHits
                                    └─ modules/banking/search.ts            searchBankTransactionHits
 kernel/search: SearchHit / SearchGroup types · parseSearchQuery (text + amount) · rankOf · toGroup · orderGroups
```

- **The kernel composes nothing it would have to import.** The palette takes the action as a prop; the module list lives in the app layer. No registry imports every module at load ([[lessons]], the linking cycle).
- **Each module owns its search**: `search<Kind>Hits(tx, caller, q) → ServiceResult<SearchGroup>`, exported from its `index.ts`, tested in its own `search.test.ts`. `can(caller, "read", …)` first (an empty group otherwise); one query, `take` 50 newest first, ranked in code by the kernel rules, 5 kept. Invoices and supplier invoices add one batched read of the partner names for the ≤ 5 shown hits.
- **Walls**: RLS by the tenant transaction; `can()` per kind. The accountant searches too — no relationship documents, no contracts. The editor gets no invoices, supplier invoices or settlements.
- **Adding a kind**: a `search.ts` + `search.test.ts` in the module (the fixture `kernel/test-utils/search-fixtures.ts` has one of each entity), its export, one line in `SEARCHES`, a `shell.search.group.<kind>` key in en / fr / sv, the kind in `SEARCH_KINDS`.
- `searchAll` lives in a plain file, not in the `"use server"` one: every async export of a `"use server"` file is a callable endpoint, and this one takes a transaction.

## Rules

| What | Rule |
|---|---|
| Amount | `1250`, `1 250` (also no-break / thin spaces), `1250.00`, `1250,00`, `1'250`, `1’250`, `1,250.00`, `1.250,00`, `−1250` → 1250.00. `.` / `,` before exactly three digits groups thousands, before one or two it is the decimal mark. Either sign, any currency. |
| Ranking | exact key 0 · key prefix 1 · amount 2 · key / name contains 3 · other text 4; then newest. Keys: business keys, a partner's short code / org / VAT number, the supplier's own number, a bank row's reference. |
| Groups | ≤ 5 hits, *See all* when cut. Order: groups with an exact key → Pages → the rest by best hit, ties in `SEARCH_KINDS` order. |
| Query | pages from the first character; entities from 2, debounced 150 ms, the newest answer wins. |

## Volume (2026-10-26)

`scripts/seed-volume.ts` (tenant *Volume AB*: 1 600 bank rows, 2 400 documents, 800 expenses, 300 supplier invoices, 150 invoices, 60 partners — invented) then `scripts/measure-search.ts` as the app role, 20 runs per query, cloud session Postgres 17:

| | median | p95 |
|---|---|---|
| one module | 1–5 ms | ≤ 9 ms |
| the whole palette call (7 queries + name lookups) | 8–16 ms | ≤ 30 ms |

`contains` is a sequential scan on these sizes and stays well under the debounce, so **no trigram index** (no migration). Re-measure when a table passes ~50 000 rows; `pg_trgm` + a GIN index on the scanned columns is the next step, as a schema PR of its own.

## UI (af-design)

A `Dialog` from the kit (no `cmdk`, no new dependency): `combobox` input with `aria-activedescendant`, a `listbox` of `group`s labelled by their heading, `option`s; ↑ ↓ Enter, Esc closes (the dialog's own). Keys as `<CodeChip>`, dates `yyyy-mm-dd`, money through `formatMoney` (bank rows signed). The top bar's box is a button that opens it, named by its visible text. Landmark names (`Main navigation`, `Breadcrumb`) are untouched English literals; the palette's strings are `shell.search.*` in en / fr / sv.

Screenshots: `specs/search/screenshots/` (light + dark, on the volume tenant).

Related: [[ui-conventions]] (the shell) · [[linking]] (the `Link to…` picker is a separate, linking-only search) · [[constitution]]
