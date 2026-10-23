# Partners — the reference slice

Phase-0 item 6 (2026-10-20). `src/modules/partners` is the module every other module copies: the layout of [[feature-folders]], the surfaces of 3b, the read API of D20, the pages of D19. The `module-slice` skill is distilled from it. Older pattern notes ([[partner-crud-pattern]], [[entity-view-pattern]]) describe v2's version of the same module and stay as history.

## What a partner is
A client, vendor or employee (`types[]`, at least one) with org/VAT numbers, defaults for invoicing (currency, language, BAS category), labelled external identifiers (supplier number, PO…), contact details, an address, and since 4.4 a **short code** (`VA`): the invoice series key is `{short_code}{yy}` → `VA26-INV-001` ([[numbering]]). Short codes are 2–6 upper-case letters/digits, unique per tenant, optional until the partner is invoiced. Deactivation is soft (`is_active`); a partner that is linked anywhere cannot be deleted ([[linking]]).

## The module, file by file
```
prisma/schema/partners.prisma      models Partner + PartnerContact; partial unique indexes (org number, short code)
src/modules/partners/
  types.ts            PartnerDto, PartnerSummaryDto, PartnerType, ExternalIdentifier, PartnerAddress
  state-family.ts     the one state → D40 family map: active → done, inactive → neutral (from is_active, never typed)
  partners.ts         service: Zod schemas, toPartnerDto, create/update/deactivate/reactivate, getPartner(s), searchPartners
                      (reads other modules through their index: settings' getBasCategory / isBasActivated for the default
                      category, contracts' activeContractCount — a lazy import(), contracts imports partners — for the type-removal guard)
  contacts.ts         contact persons (F08): schemas, toPartnerContactDto, list / create / update / delete, audited
  queries.ts          READ API — PARTNER_COLUMNS (ColumnMap), listPartners(tx, q), distinctPartnerValues, partnerDateHierarchy,
                      getPartner(s), listPartnerContacts (re-exported: pages read through queries.ts)
  partners.actions.ts ownerAction wrappers: CRUD + distinctPartnersAction + partnerDateHierarchyAction (ListQuery validated by listQuerySchema)
  linkable.ts         partnerLinkable (exists/summary) registered in modules/linking/linkables.ts
  components/
    partner-table.tsx   the list on kernel DataTable: columns, filterSource (the two actions), Types quick filter, ⋮ rowActions
    new-partner-button.tsx   the list's one primary: Add partner → a dialog (name, short code, types)
    partner-labels.tsx  PartnerStateLabel (StateLabel through state-family) · PartnerTypeTags (grey <Tag>s)
    partner-form.tsx    autosave-on-blur edit form in DetailsSections (basic, defaults, address, identifiers)
    partner-detail-tabs.tsx  entity page: PageHeader (state, type tags, ⋮, Graph) + underline tabs with count badges
    partner-contacts.tsx     the Contacts tab: inline add, row view ↔ row edit, Edit / Delete in the row's ⋮
  partners.test.ts    service rules (types, FK validation, soft delete, RLS)
  contacts.test.ts    contact rules (validation, sort, scoping to the partner and the tenant, audit)
  queries.test.ts     the ListQuery contract on the real DB: paging, sorting, every filter kind, search, distinct with Excel semantics, date hierarchy
  index.ts / ui.ts    surfaces
src/app/(app)/partners/page.tsx        list page: parseListQuery(searchParams) → listPartners → <ListPage actions={<NewPartnerButton/>}><PartnerTable/></ListPage>
src/app/(app)/partners/[id]/page.tsx   entity page: <EntityPage> around the tabs
```

## The list page, end to end (copy this for every list)
1. **URL = query.** `parseListQuery(await searchParams, { columns: PARTNER_COLUMN_KEYS, defaultSort })` on the server page; `useListQuery` in the client table reads the same URL and writes it back (`router.replace`, `useTransition` → `isPending` dims the table).
2. **One page from the server.** `listPartners(tx, q)` = `buildWhere` + `buildOrderBy` + `paginate` over `PARTNER_COLUMNS`; returns `{ rows: Dto[], total }`. Pages serialise Dates to ISO strings at the boundary.
3. **Header filters ask the module.** The table's `filterSource` calls `distinctPartnersAction` / `partnerDateHierarchyAction` with the current query; the queries drop the column's own filter (`exceptColumn`) so the list shows what the other filters leave — Excel semantics, counts included, capped at 500.
4. **Columns declare, the kernel renders.** `type` picks the filter UI and alignment; `cell` overrides rendering; `width`, `defaultHidden`, `alwaysVisible`, `truncate` shape the layout. Column visibility is remembered per table key (browser storage for now; per-user table preferences come with the documents migration).
5. **Mutations** go through the module's actions and `router.refresh()`.

## On the D40 kit (F71 — 2026-10-23)

```
/partners                                  /partners/<id>
┌ Partners · 8 partners      [Add partner] ┌ Partners ›
│ [Filter rows…] [Types ▾]                 │ (icon) Name  ✓ Active  client      ⋮  Graph
│ Name  Short  Types   …  Status    ⋮      │ Overview  Contracts ①  Contacts ⓪  Transactions ⓪  Documents ⓪
│ Acme  AC     client     ✓ Active  ⋮      │ ▾ About · ▾ Basic information · ▾ Defaults · ▾ Address · ▾ Identifiers
```

- **State**: `state-family.ts` is the one map (active → done ✓, inactive → neutral –), shown by `PartnerStateLabel` in the list's Status cell, the title row and About. Never a coloured badge.
- **Types** are metadata: grey `<Tag>`s (`PartnerTypeTags`), no per-type colour. The list has a **Types** quick filter.
- **One primary per title row**: the list's *Add partner* opens a dialog (it used to be an inline form above the table); the partner page has none — *Deactivate* / *Reactivate* sit in the title row's ⋮ (*More actions*, through a `ConfirmDialog`), *Graph* is the secondary. In the list they are the row's ⋮ (`rowActions`).
- **The partner page** is a `PageHeader` (no back link, the breadcrumb names *Partners*; the title once) with underline tabs whose counts are `<CountBadge>`s (`partners.tab.*` without a count: *Contracts 1*). Overview = an *About* section (state, types, active contracts, created `yyyy-mm-dd`) and the form's four groups as collapsible `DetailsSection`s. A saved name or types change updates the title row without a reload.
- **Transactions tab**: amounts through `formatMoney` with the plain decimal on `data-amount`, the base beside a foreign amount (`BASE_CURRENCY` until F70), the BAS label a `<Tag>`. **Documents tab**: the key a `<CodeChip>`, the category a `<Tag>`. The stored OCR step (`status`) is not shown; each row carries the derived state instead — `documentsByIds`' `documentState` through `DocumentStateLabel` from `documents/ui` (T011, `components/partner-documents.tsx`).
- **Contacts**: *Edit* / *Delete* in the row's ⋮ (`RowActionsMenu`); a server error without a message reads `errors.generic`, not *Error*.

## The entity page's relationships (2026-10-21)

`/partners/[id]` composes three read models of other modules on top of the partner itself — the page does it, never the partners module (cycles): `linking.linksTouching(tx, "partner", [id])` → the documents linked to the partner (`documents.documentsByIds`) for the *Documents* tab; `journal.listJournalEntries` filtered on `partnerId` (newest 25, with the total) for the *Transactions* tab, which links to the journal filtered on the partner; the tabs carry the counts as badges (F71). The header's *Graph* button opens `/links/partner/<id>` (the linking graph). The strings are `partners.*` in the dictionary (en / fr / sv) since the same day.

## Contact persons (F08 — 2026-10-22, `specs/partners/spec.md`)

A partner has zero or more contact persons: **name** (required, ≤ 200), **role** (≤ 100), **e-mail** (a valid address, ≤ 254), **phone** (free text, ≤ 50). Trimmed; an empty string is stored as `null`. They live in `partner_contacts` (RLS, `partner_id → partners ON DELETE CASCADE` — intra-module, a contact never outlives its partner); not linkable, no history beyond the audit trail (`partner_contact`). The partner's own e-mail and phone stay the company's switchboard; nothing moves between them.

The entity page loads them in its tenant transaction (`listPartnerContacts`, sorted by name case-insensitively) and shows the **Contacts** tab with its count badge. Writes are `ownerAction`s (`create / update / delete PartnerContactAction`; a member is refused on all four, `contacts.test.ts`); the page itself is owner-only today (`requireCaller manage partner`), so a read-only role does not reach the tab. The client validates the name and the e-mail first (messages in the user's language); the service validates again and returns `details.field` so the client can translate a server refusal too.

Not built, by decision: a contact on the invoice (*Attn* / *Your reference*), a primary flag, notes, a cross-partner contacts page, contacts in search.

## The supplier match — `match.ts` (specs/documents US1, harvest R39 — 2026-10-21)

`matchPartners(tx, { name?, vatNumber?, address?, type? })` scores the active partners (`scorePartnerMatch`, pure): VAT exact (alnum, case-fold) 100 · name exact 80 | contains 60 | ≤ 3 edits 40 − 10·d · address 20 (`addressMatches`: one contains the other word by word, or the partner's street — the first part of the stored address, flattened street · postal code city · country by `flattenAddress` — appears in the OCR's address; T026) · the wanted type 10; `percent = min(100, round(score / 140 × 100))`; zeros dropped, best five (`rankPartnerMatches`). The dialog's card shows a best match from 60 %. `matchPartnersAction` (owner). Tested on the harvest's cases (`match.pure.test.ts`). The OCR side (T026, 2026-10-23): `components/ocr-address.ts` (pure, on the client surface) — `ocrAddressText` (the printed address, else its parts) is what the match scores, `partnerAddressFromOcr` (street, postal code, city, ISO-2 country within the schema's limits) what the supplier-invoice dialog's *New vendor* is created with; the card shows the address it will save.

## Tests that define the slice
- `queries.test.ts` — the contract: 5 partners + 1 in another tenant; paging/sorting; `in` on an array column and with blanks; text ops; boolean; search; date year/month/range; mapped-column sorting; distinct narrowed by other filters but not by its own; array unnest; boolean counts; date hierarchy.
- `kernel/list-query/*.pure.test.ts` — codec round trip (fast-check) and every filter → Prisma `where`.
- `kernel/ui/data-table/data-table.test.tsx` — rendering, sort cycling, chips, each popover applying its filter, pagination.

## Decisions carried
- Short code lives on the partner, not on a contract: one client, one series, whatever the contract.
- No "show inactive" checkbox: `Status` is a column with a boolean filter like any other.
- Distinct values are computed in JS over `select { column }` of the filtered set, capped at 20 000 rows — right for a one-person company; swap for `groupBy` when a table proves big.
