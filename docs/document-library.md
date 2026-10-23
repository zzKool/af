# Document Library

The library (`/documents`) is a list page on the kernel `DataTable` (D19, D20; the last page migrated off v2's legacy table — phase-0 item 8). Owners see every document and upload / delete; the accountant sees financial documents only, read-only.

The header links the work page: *Inbox (n)* → `/documents/inbox`, n = the documents that still need a decision (pending + ready, `inboxTotals`) — see [[document-inbox]].

## Architecture

```
src/app/(app)/documents/page.tsx     parseListQuery(searchParams) → listDocuments → <ListPage><DocumentsTable/></ListPage>
src/modules/documents/queries.ts     DOCUMENT_COLUMNS · listDocuments · distinctDocumentValues · documentDateHierarchy
src/modules/documents/documents.actions.ts   distinctDocumentValuesAction · documentDateHierarchyAction (the header filters)
src/modules/documents/components/documents-table.tsx   the table, the upload zone in the toolbar, Download / Delete per row
```

The URL is the query (`?f.status=in:extracted&sort=createdAt:desc`): shareable, back-button safe. The server loads one page; the client table changes the URL; nothing is fetched client-side except the header filters' values. Column visibility is remembered per `tableKey` (`documents`).

## The read model — `listDocuments(tx, caller, q)`

Two steps like every derived list: Prisma filters the stored columns (business key, file name, kind, type, status, MIME, size, reviewed, uploaded), then the derived ones are joined over that set — the OCR facts **as corrected on review** (`vendor`, `amount`, `currency`, `documentDate` through `resolveDocumentData`) and `linked` (an expense or supplier invoice became from it, or a bank row justifies it — `unlinkedIds`, read through `linking.linksTouching`) — and the derived filters, the free-text search (key, file name, vendor), the sort and the page run in memory (cap 20 000). Then, for the **page rows only**, `became` (the `created_from` target with its key) through `linking.createdFromTargets(…, { labels: true })` — one summary per row of the page, never per row of the set; the `linked` filter stays the boolean. The role rule is the read model's: a caller without `read relationship_document` gets the base `documentType = financial` on every query, including the header filters' distinct values.

`getDocuments` (v2's filter object) stays for the expense / supplier-invoice pickers (`candidateDocuments`); the library no longer uses it.

## Columns

Key (link to the review page) · File · Kind (`expense`, `invoice`, `contract`, … the upload kind or the generating module) · Type (financial / relationship, hidden) · Status (`uploaded`, `processing`, `extracted` + *needs review* until reviewed, `ocr_failed`, `generated`) · Vendor · Amount (+ currency) · Document date · Linked (*Expense {key}* / *Supplier invoice {key}* linking to the entity when the document became one — FR-005; *Linked* when only a bank row justifies it; *Not linked*) · MIME, Size, Reviewed (hidden) · Uploaded · actions (Download — a signed URL through `getDocumentDownloadUrlAction`; Delete — owner, confirmed, refused by the service when linked or in retention).

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
