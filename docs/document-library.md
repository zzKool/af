# Document Library

The library (`/documents`) is a list page on the kernel `DataTable` (D19, D20; the last page migrated off v2's legacy table — phase-0 item 8). Owners see every document and upload / delete; the accountant sees financial documents only, read-only.

The title row links the work page: *Inbox (n)* → `/documents/inbox` (a secondary button — the page's one primary is *Upload document* in the upload zone; `?new=1` — the sidebar's **+ New → Upload document**, F73 — opens the same zone in a dialog, `UploadDocumentDialog`, closing it drops the param), n = the documents that still need a decision (pending + ready, `inboxTotals`) — see [[document-inbox]].

**D40 kit (F71, 2026-10-23).** The row's state is the document's **derived state** — the inbox's word on the same facts (`documentState` in `state-family.ts`, the module's one state → family map), shown as `<DocumentStateLabel>` (icon + word): *Needs OCR*, *Processing* (◐), *Processing* stuck / *OCR failed* (!), *Ready* (◐ — facts there, decision not), *Archived* (–), *Filed* (✓ — it became something or was filed as is), *generated* (– — the app's own PDF). The key is a `<CodeChip>`, Kind and Type are `<Tag>`s, the amount goes through `formatMoney` (`342.50 SEK`), Open / Download / Delete sit in the row's ⋮ (`rowActions`), *Kind* and *Document date* are quick filters. No coloured pill is left.

## Architecture

```
src/app/(app)/documents/page.tsx     parseListQuery(searchParams) → listDocuments → <ListPage><DocumentsTable/></ListPage>
src/modules/documents/queries.ts     DOCUMENT_COLUMNS · listDocuments · distinctDocumentValues · documentDateHierarchy
src/modules/documents/documents.actions.ts   distinctDocumentValuesAction · documentDateHierarchyAction (the header filters)
src/modules/documents/components/documents-table.tsx   the table, the upload zone above it, Open / Download / Delete in the row's ⋮
src/modules/documents/components/upload-document-dialog.tsx   the zone in a dialog, opened by ?new=1 (kernel useNewParam)
src/modules/documents/state-family.ts   documentState (the inbox's rule + filed / generated) · the one state → D40 family map
```

The URL is the query (`?f.status=in:extracted&sort=createdAt:desc`): shareable, back-button safe. The server loads one page; the client table changes the URL; nothing is fetched client-side except the header filters' values. Column visibility is remembered per `tableKey` (`documents`).

## The read model — `listDocuments(tx, caller, q)`

Two steps like every derived list: Prisma filters the stored columns (business key, file name, kind, type, status, MIME, size, reviewed, uploaded), then the derived ones are joined over that set — the OCR facts **as corrected on review** (`vendor`, `amount`, `currency`, `documentDate` through `resolveDocumentData`) and `linked` (an expense or supplier invoice became from it, or a bank row justifies it — `unlinkedIds`, read through `linking.linksTouching`) — and the derived filters, the free-text search (key, file name, vendor), the sort and the page run in memory (cap 20 000). Then, for the **page rows only**, `became` (the `created_from` target with its key — the badge — and its full label — the tooltip) through `linking.createdFromTargets(…, { labels: true })` — one summary per row of the page, never per row of the set; the `linked` filter stays the boolean. The role rule is the read model's: a caller without `read relationship_document` gets the base `documentType = financial` on every query, including the header filters' distinct values.

`getDocuments` (v2's filter object) stays for the expense / supplier-invoice pickers (`candidateDocuments`); the library no longer uses it. Its `dateFrom` / `dateTo` (on the upload instant) are whole calendar days — `dateFrom` 00:00 UTC up to the day after `dateTo`, whatever the process's time zone (lessons audit 28); the action takes ISO dates only.

## Columns

Key (code chip, link to the review page) · File · Kind (tag: `expense`, `invoice`, `contract`, … the upload kind or the generating module; quick filter) · Type (tag, financial / relationship, hidden) · Status (the derived state, above — filled on the page rows from `archivedAt`, `updatedAt`, `reviewedAt` and the `created_from` read, which the read model keeps to itself; **the header filter stays on the stored OCR step** — *uploaded · processing · extracted · OCR failed · generated* — so *extracted* holds both *Ready* and *Filed* rows) · Vendor · Amount (`formatMoney` in the row's currency) · Document date (quick filter) · Linked (*Expense {key}* / *Supplier invoice {key}* linking to the entity when the document became one — FR-005; *Linked* when only a bank row justifies it; *Not linked*, muted) · MIME, Size, Reviewed (hidden) · Uploaded · ⋮ (Open; Download — a signed URL through `getDocumentDownloadUrlAction`; Delete — owner, confirmed, refused by the service when linked or in retention). No Σ: no column declares a sum (amounts are in several currencies).

The page's meta line carries the total and *OCR failed* from `getDocumentStats`, and *to review* from `inboxTotals` — the same number as the *Inbox (n)* link beside it ([[document-inbox]]; one count since F61).

## Role Access

| Role | Sees | Can |
|---|---|---|
| owner | every document | upload, review, download, delete |
| accountant | financial documents | download |
| editor | financial + relationship | upload, review, download |

## Tests

`queries.test.ts` — the ListQuery contract on the real DB: the role base, every filter kind (enum, text, money range, date hierarchy, boolean `linked`), *became* with the entity's key on a row (a justified-only document is linked, became nothing), search, distinct with Excel semantics. `e2e/document-library.spec.ts` — upload → the row, a header filter, download.

## Related

- [[ui-conventions]] — the DataTable and the ListQuery contract
- [[partners]] — the reference list page
- [[document-upload]], [[document-review]]
