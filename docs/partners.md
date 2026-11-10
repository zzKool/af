# Partners — the reference slice

Phase-0 item 6 (2026-10-20). `src/modules/partners` is the module every other module copies: the layout of [[feature-folders]], the surfaces of 3b, the read API of D20, the pages of D19. The `module-slice` skill is distilled from it. Older pattern notes ([[partner-crud-pattern]], [[entity-view-pattern]]) describe v2's version of the same module and stay as history.

## What a partner is
A client, vendor, employee or — since F129 (D73) — authority (`types[]`, at least one; `authority` is a tax agency: Skatteverket, the Swiss FTA) with org/VAT numbers, defaults for invoicing (currency, language, BAS category), labelled external identifiers (supplier number, PO…), contact details, an address, and since 4.4 a **short code** (`LK`): the invoice series key is `{short_code}{yy}` → `LK26-INV-001` ([[numbering]]). Short codes are 2–6 upper-case letters/digits, unique per tenant, optional until the partner is invoiced. **One partner per name and per VAT number** (D70, 2026-10-29): `createPartner` and `updatePartner` refuse a name another partner of the tenant carries (case and runs of spaces ignored — `foldPartnerName`) or a VAT number another carries (spaces, dots, dashes ignored, upper case — `foldVatNumber`), deactivated partners included; the `DUPLICATE_ENTRY` names the existing one (`details.existingId` / `existingName` / `field`), so the match card picks it instead of failing. Deactivation is soft (`is_active`); a partner that is linked anywhere cannot be deleted ([[linking]]).

## The four system partners (F129, D73 — `specs/justify/rework.md` US4)

A *no proof needed* row names a partner too, and there is no proof to derive one from — so four partners exist **once per tenant**, ordinary and editable, found again by `partners.system_role` (`bank` · `tax_agency_se` · `tax_agency_ch` · `owner`; `VARCHAR(20)` + CHECK, the partial unique index `partners_tenant_system_role_key`; migration `20261104120000_justified_partner`): the bank (`vendor`, named after the `bank_name` of the format the tenant's statement accounts use — *Nordea*), *Skatteverket* (`authority`, SEK), *Swiss Federal Tax Administration (FTA)* (`authority`, CHF), the owner as employee (`employee`, the owner member's user name). The name, short code, types, address, identifiers and the active flag stay the owner's; **no form shows or writes the role** (`createPartnerSchema` / `updatePartnerSchema` do not know it; `PartnerDto.systemRole` is read-only; the partner page shows it as a grey tag beside the types — `PartnerTypeTags`). No second partner can take a held role (the index); reassigning is out of scope.

- `ensureSystemPartners(tx, caller, audit, { bankName }) → { created, attached }`: idempotent — a role held is left alone; a hand-made partner whose folded name says it is the one (*skatteverket*, the bank's name, the FTA's names, the owner's name — `foldPartnerName`) **takes the role** instead of a twin (D70 would refuse the twin anyway), audited `update`; the rest are created, audited `create`. Called by `banking.importCsv` before the default rules (which name the bank) and by `prisma/seed.ts` — never by the tenant hook (`kernel/auth` imports no module; a tenant without a bank row needs none of the four). The migration did the same for the tenants that existed and backfilled the no-proof rows (see [[deployment]]).
- `systemPartner(tx, role, tenantId?)` — the **active** holder or null (the reasons' proposal; a deactivated holder reads as none; `tenantId` names the tenant like `systemPartners` does — `ensureDefaultRules`, the import preview and `rowFacts` pass it, T026); `systemPartners(tx, tenantId?)` — every role's holder, active or not (the reasons say *inactive* rather than nothing; `tenantId` for a caller outside RLS such as the seed). The roles are compared through `SYSTEM_ROLES` / `isSystemRole`, never `role ===` (the guard).
- `partnerTypeSchema` (the four types) is shared with the actions' `matchPartners` (`type: "authority"` accepted); `PARTNER_TYPES` / `SYSTEM_ROLES` on `index.ts` and, through `partner-labels.tsx`, on `ui.ts`. i18n `partners.type.authority`, `partners.role.*`.
- Tests: `partners.test.ts` — *authority* accepted and an unknown type refused; the four seeded once with their names, types and currencies, audited, found by role, a second run idle; the hand-made *skatteverket* attached (any case), the role not writable through `updatePartner`, a deactivated holder (*none* vs *inactive*), the index refusing a second holder; RLS: each tenant its own four.

## The module, file by file
```
prisma/schema/partners.prisma      models Partner + PartnerContact; partial unique indexes (org number, short code)
src/modules/partners/
  types.ts            PartnerDto, PartnerSummaryDto, PartnerType (+ PARTNER_TYPES), SystemRole (+ SYSTEM_ROLES, isSystemRole — F129), ExternalIdentifier, PartnerAddress
  state-family.ts     the one state → D40 family map: active → done, inactive → neutral (from is_active, never typed)
  partners.ts         service: Zod schemas, toPartnerDto, create/update/deactivate/reactivate, getPartner(s), searchPartners,
                      systemPartner / systemPartners / ensureSystemPartners (F129: the four system partners by their role)
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

`/partners/[id]` composes three read models of other modules on top of the partner itself — the page does it, never the partners module (cycles): `linking.linksTouching(tx, "partner", [id])` → the documents linked to the partner (`documents.documentsByIds`) for the *Documents* tab; `journal.listJournalEntries` filtered on `partnerId` (newest 25, with the total) for the *Transactions* tab, which links to the journal filtered on the partner; the tabs carry the counts as badges (F71). **Expenses** (F87, 2026-10-24): `expenses.expensesForPartner` — *Expenses: n · total Σ base* (`*` when a base in it is still a provisional estimate), the newest 25 (key, date, description, category, amount, base, state) and *Open in Expenses* → `/expenses?f.partnerId=in:<id>`; spend = expenses only (D50 Q3 — supplier invoices stay on their list). `components/partner-expenses.tsx` takes plain rows (the state with its family from expenses); partners' UI only type-imports `ExpenseStatus` — `expenses/ui` imports `partners/ui` (the match card), never the reverse at runtime. The base currency is read once in `partner-detail-tabs.tsx` and passed down (F85). The header's *Graph* button opens `/links/partner/<id>` (the linking graph). The strings are `partners.*` in the dictionary (en / fr / sv) since the same day.

## The overview (F144 — Pulse phase 7b, the board *Partner*)

The Overview tab is cards on the ground. On top four figures from the invoices module (`partnerInsight`, derived on request): **Invoiced {year}** in the client's currency (credit notes take back) with ▲ / ▼ % against January to the same day last year · **Not invoiced yet** (the drafts; issued not sent; unpaid) · **Pays after** (the average days from the issue to the paying bank row, never / N times late this year) · **Days billed {year}** (the `day` lines of issued invoices, per month and the contract's rate). Below, **Invoiced and paid, by month** (twelve bars, open months amber, a dot with the days it took) and **What happened** (the last 8 drafts, issues, sends and payments, each linking to its invoice); *Details* (read only since F151). Beside them the active **contract** (rate, period, references, terms) and **Linked** counts. *New invoice* in the title row opens the form on this client (`/invoices/new?partner=`). The page composes the invoices module's pieces — partners does not import invoices (the dependency runs the other way).

## The page as the board draws it (F151 — the owner's gap review, 2026-11-09)

- **Header**: the initial in a 64 px tile (`EntityTile`), the name 30 / 600, under it round chips — the kinds (`client`, blue), *inactive* when it is, *city · CH*, *invoices in CHF · FR* (clients), *contract active to …* (green, from the active contract) — then ⋮ · Graph · **Edit details** · **New invoice**. `PageHeader`'s `leading` and `figures` slots.
- **The four figures above the tabs** (they speak for the whole partner, not for Overview).
- **Overview**: left the months and *What happened* (a sentence when the partner is not invoiced); right the **Contract** card (clients), **Details** read only — state, the address on its lines with the **country by name** (`countryName`, the UI language), VAT and org numbers, the short code and what it makes (`LK` → *invoices LK26-INV-…*), the first contact person (else the e-mail · phone), the terms, the invoice language by name — and **Linked** as chips.
- **Edit details** (the header, or *Edit* on the card) opens a dialog (`PartnerForm`, 4xl): Identity · Address · Contact · Invoicing defaults · External identifiers, two columns on a wide screen, each field saved when left (the address as a whole; the country on pick). Closing refreshes the page.
- **The country is picked by name** (`kernel/ui/country-picker.tsx`: search by name or code, the ISO list in `kernel/i18n/display-names.ts`) and stored as the two-letter code (the schema already upper-cases it); the printed sheet writes it out (`sheetCountry` → `countryName`, any case).
- The address, numbers and contact are `data-sensitive`: the top bar's eye (F150) blurs them too.

## Contact persons (F08 — 2026-10-22, `specs/partners/spec.md`)

A partner has zero or more contact persons: **name** (required, ≤ 200), **role** (≤ 100), **e-mail** (a valid address, ≤ 254), **phone** (free text, ≤ 50). Trimmed; an empty string is stored as `null`. They live in `partner_contacts` (RLS, `partner_id → partners ON DELETE CASCADE` — intra-module, a contact never outlives its partner); not linkable, no history beyond the audit trail (`partner_contact`). The partner's own e-mail and phone stay the company's switchboard; nothing moves between them.

The entity page loads them in its tenant transaction (`listPartnerContacts`, sorted by name case-insensitively) and shows the **Contacts** tab with its count badge. Writes are `ownerAction`s (`create / update / delete PartnerContactAction`; a member is refused on all four, `contacts.test.ts`); the page itself is owner-only today (`requireCaller manage partner`), so a read-only role does not reach the tab. The client validates the name and the e-mail first (messages in the user's language); the service validates again and returns `details.field` so the client can translate a server refusal too.

Not built, by decision: a contact on the invoice (*Attn* / *Your reference*), a primary flag, notes, a cross-partner contacts page, contacts in search.

## The supplier match — `match.ts` (specs/documents US1, harvest R39 — 2026-10-21)

`matchPartners(tx, { name?, vatNumber?, address?, type? })` scores the active partners (`scorePartnerMatch`, pure): VAT exact (alnum, case-fold) 100 · name exact 80 | contains 60 | ≤ 3 edits 40 − 10·d · address 20 (`addressMatches`: one contains the other word by word, or the partner's street — the first part of the stored address, flattened street · postal code city · country by `flattenAddress` — appears in the OCR's address; T026) · the wanted type 10; `percent = min(100, round(score / 140 × 100))`; zeros dropped, best five (`rankPartnerMatches`). The card, `components/partner-match-card.tsx` (`PartnerMatchCard`, on `partners/ui` — moved from supplier invoices by F87, unchanged; test ids `partner-match*`), shows a best match from 60 % — used by the supplier-invoice dialog and, from a document, the expense dialog (F87). `matchPartnersAction` (owner). Tested on the harvest's cases (`match.pure.test.ts`). The OCR side (T026, 2026-10-23): `components/ocr-address.ts` (pure, on the client surface) — `ocrAddressText` (the printed address, else its parts) is what the match scores, `partnerAddressFromOcr` (street, postal code, city, ISO-2 country within the schema's limits) what the supplier-invoice dialog's *New supplier* is created with; the card shows the address it will save. A refused create (D70: the name or the VAT number is on file already) makes the card use the existing partner — *{name} is on file already — using it* (F124 (4)).

## Tests that define the slice
- `queries.test.ts` — the contract: 5 partners + 1 in another tenant; paging/sorting; `in` on an array column and with blanks; text ops; boolean; search; date year/month/range; mapped-column sorting; distinct narrowed by other filters but not by its own; array unnest; boolean counts; date hierarchy.
- `kernel/list-query/*.pure.test.ts` — codec round trip (fast-check) and every filter → Prisma `where`.
- `kernel/ui/data-table/data-table.test.tsx` — rendering, sort cycling, chips, each popover applying its filter, pagination.

## Decisions carried
- Short code lives on the partner, not on a contract: one client, one series, whatever the contract.
- No "show inactive" checkbox: `Status` is a column with a boolean filter like any other.
- Distinct values are computed in JS over `select { column }` of the filtered set, capped at 20 000 rows — right for a one-person company; swap for `groupBy` when a table proves big.
