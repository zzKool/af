# Partners — the reference slice

Phase-0 item 6 (2026-10-20). `src/modules/partners` is the module every other module copies: the layout of [[feature-folders]], the surfaces of 3b, the read API of D20, the pages of D19. The `module-slice` skill is distilled from it. Older pattern notes ([[partner-crud-pattern]], [[entity-view-pattern]]) describe v2's version of the same module and stay as history.

## What a partner is
A client, vendor or employee (`types[]`, at least one) with org/VAT numbers, defaults for invoicing (currency, language, BAS category), labelled external identifiers (supplier number, PO…), contact details, an address, and since 4.4 a **short code** (`VA`): the invoice series key is `{short_code}{yy}` → `VA26-INV-001` ([[numbering]]). Short codes are 2–6 upper-case letters/digits, unique per tenant, optional until the partner is invoiced. Deactivation is soft (`is_active`); a partner that is linked anywhere cannot be deleted ([[linking]]).

## The module, file by file
```
prisma/schema/partners.prisma      model + partial unique indexes (org number, short code)
src/modules/partners/
  types.ts            PartnerDto, PartnerSummaryDto, PartnerType, ExternalIdentifier, PartnerAddress
  partners.ts         service: Zod schemas, toPartnerDto, create/update/deactivate/reactivate, getPartner(s), searchPartners
  queries.ts          READ API — PARTNER_COLUMNS (ColumnMap), listPartners(tx, q), distinctPartnerValues, partnerDateHierarchy
  partners.actions.ts ownerAction wrappers: CRUD + distinctPartnersAction + partnerDateHierarchyAction (ListQuery validated by listQuerySchema)
  linkable.ts         partnerLinkable (exists/summary) registered in modules/linking/linkables.ts
  components/
    partner-table.tsx   the list on kernel DataTable: columns, filterSource (the two actions), create form, row actions
    partner-form.tsx    autosave-on-blur edit form (short code, numbers, defaults, identifiers, address)
    partner-detail-tabs.tsx  entity page: header + tabs (overview, contracts, transactions, documents)
  partners.test.ts    service rules (types, FK validation, soft delete, RLS)
  queries.test.ts     the ListQuery contract on the real DB: paging, sorting, every filter kind, search, distinct with Excel semantics, date hierarchy
  index.ts / ui.ts    surfaces
src/app/(app)/partners/page.tsx        list page: parseListQuery(searchParams) → listPartners → <ListPage><PartnerTable/></ListPage>
src/app/(app)/partners/[id]/page.tsx   entity page: <EntityPage> around the tabs
```

## The list page, end to end (copy this for every list)
1. **URL = query.** `parseListQuery(await searchParams, { columns: PARTNER_COLUMN_KEYS, defaultSort })` on the server page; `useListQuery` in the client table reads the same URL and writes it back (`router.replace`, `useTransition` → `isPending` dims the table).
2. **One page from the server.** `listPartners(tx, q)` = `buildWhere` + `buildOrderBy` + `paginate` over `PARTNER_COLUMNS`; returns `{ rows: Dto[], total }`. Pages serialise Dates to ISO strings at the boundary.
3. **Header filters ask the module.** The table's `filterSource` calls `distinctPartnersAction` / `partnerDateHierarchyAction` with the current query; the queries drop the column's own filter (`exceptColumn`) so the list shows what the other filters leave — Excel semantics, counts included, capped at 500.
4. **Columns declare, the kernel renders.** `type` picks the filter UI and alignment; `cell` overrides rendering; `width`, `defaultHidden`, `alwaysVisible`, `truncate` shape the layout. Column visibility is remembered per table key (browser storage for now; per-user table preferences come with the documents migration).
5. **Mutations** go through the module's actions and `router.refresh()`.

## The entity page's relationships (2026-10-21)

`/partners/[id]` composes three read models of other modules on top of the partner itself — the page does it, never the partners module (cycles): `linking.linksTouching(tx, "partner", [id])` → the documents linked to the partner (`documents.documentsByIds`) for the *Documents* tab; `journal.listJournalEntries` filtered on `partnerId` (newest 25, with the total) for the *Transactions* tab, which links to the journal filtered on the partner; the tab labels and the overview carry the counts. The header's *Graph* button opens `/links/partner/<id>` (the linking graph). The strings are `partners.*` in the dictionary (en / fr / sv) since the same day.

## The supplier match — `match.ts` (specs/documents US1, harvest R39 — 2026-10-21)

`matchPartners(tx, { name?, vatNumber?, address?, type? })` scores the active partners (`scorePartnerMatch`, pure): VAT exact (alnum, case-fold) 100 · name exact 80 | contains 60 | ≤ 3 edits 40 − 10·d · address contains 20 · the wanted type 10; `percent = min(100, round(score / 140 × 100))`; zeros dropped, best five (`rankPartnerMatches`). The dialog's card shows a best match from 60 %. `matchPartnersAction` (owner). Tested on the harvest's cases (`match.pure.test.ts`).

## Tests that define the slice
- `queries.test.ts` — the contract: 5 partners + 1 in another tenant; paging/sorting; `in` on an array column and with blanks; text ops; boolean; search; date year/month/range; mapped-column sorting; distinct narrowed by other filters but not by its own; array unnest; boolean counts; date hierarchy.
- `kernel/list-query/*.pure.test.ts` — codec round trip (fast-check) and every filter → Prisma `where`.
- `kernel/ui/data-table/data-table.test.tsx` — rendering, sort cycling, chips, each popover applying its filter, pagination.

## Decisions carried
- Short code lives on the partner, not on a contract: one client, one series, whatever the contract.
- No "show inactive" checkbox: `Status` is a column with a boolean filter like any other.
- Distinct values are computed in JS over `select { column }` of the filtered set, capped at 20 000 rows — right for a one-person company; swap for `groupBy` when a table proves big.
