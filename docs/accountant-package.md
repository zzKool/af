# Accountant package

The month (or the year) as one zip, generated from the links — what the owner sends the accountant instead of the Excel (D13, D17, D31; `specs/accountant-package/`). The app proves, the accountant books ([[constitution]] §1.1).

## What a package is

```
2026-06/
  bank-statements/   SEK.csv  CHF.csv            (savings.csv in the month its export was imported, D31)
  client-invoices/   InvoiceAF_VA26-INV-001.pdf
  supplier-invoices/ SI214-Acc-01_2026-06-01_Skattepunkten_Office_Services_AB.pdf
  expenses/          Ex213-Rep-01_2026-06-04_.pdf  Reimb_ST26-001_2026-06-28.pdf  (per-diem breakdowns too)
  documents/         <plain documents linked straight to a bank row>
  summary.xlsx       Bank statement · Income · Supplier invoices · Expenses · Settlements · Links · Flags
  notes.md           the flags as prose, the transfer pairs, the open owner liability, the Swiss VAT periods
```

The year package `Package_2026.zip` is the same generator over twelve months: `2026/2026-01/…` … `2026/2026-12/…`, the savings rows of the year as `2026/bank-statements/savings.csv`, a yearly `summary.xlsx` and `notes.md` at the root.

Stored as a generated document `Package_2026-06.zip` (`_v2`, `_v3` … on rebuild; the earlier versions stay), prefix `package`, financial — the accountant downloads it like any invoice PDF.

## Module — `src/modules/package/`

| file | what |
|---|---|
| `period.ts` | pure: `parsePeriod("2026-06" / "2026")`, bounds, `monthsOf`, `monthsBetween`, `periodLabel` |
| `collect.ts` | `collectPeriod(tx, period, today)` → `PeriodData`: everything of the period **through the owning modules' queries** (`banking.rawRowsForPeriod`, `journal.entriesForSources`, `linking.linksTouching`, `invoices.listInvoices` + `getInvoice`, `supplierInvoices.listSupplierInvoices`, `expenses.listExpenses` / `listSettlements` / `ledgerSnapshot`, `traktamente.perDiemDocumentsFor`, `documents.documentsByIds`). Derived statuses are the modules' (`banking.deriveTransactionState`, the invoice state, the expense status) — the package never recomputes a rule. |
| `csv.ts` | pure: one statement per account (by currency, `savings.csv`), the account's delimiter and decimal separator, ISO dates, provenance columns (account, source file, row), UTF-8 with BOM |
| `summary.ts` | pure: the seven sheets with SheetJS (`xlsx`), money as numbers with a two-decimal format, the workbook dated at the period's end |
| `notes.ts` | pure: `notes.md` |
| `zip.ts` | pure: `monthEntries`, `yearEntries`, `zipBytes` (fflate, sorted paths, one fixed mtime) |
| `package.ts` | the build rows: `requestBuild` (owner, version `max + 1`, refused while one runs), `markBuilding` / `markBuilt` / `markFailed` |
| `jobs/build-package.ts` | `package.build` (pg-boss, exclusive per build): collect in one transaction → `documents.documentReaders` → download outside any transaction → zip → `storeGeneratedDocument` + `markBuilt` in one short transaction; any error → `markFailed` with the message, nothing stored |
| `queries.ts` | `listBuilds`, `periodOverview` (the months from the first bank row to today, live counts and flags for the latest 12, the last build's for older ones; one row per year), `livePreview` (the notes and flags of a period as they would be built now) |
| `package.actions.ts` | `buildPackageAction` (owner; enqueues on commit), `listPackageBuildsAction`, `getPackageBuildAction`, `packagePreviewAction` (owner + accountant) |
| `components/package-workbench.tsx` | the page: months and years with counts / flags / builds, *Build*, *Download*, the preview pane (flags, documents, `notes.md`, versions); polls the builds every 2 s while one runs |

Table `package_builds` (`prisma/schema/package.prisma`): period, version, status `queued → building → built | failed`, document id, counts, flags, notes, error.

## Selection (FR-002)

- main-account rows by booking date; savings rows by the **import's** month for a month (the owner exports the savings account once a year, D-b), by booking date for the year;
- invoices issued in the period ∪ invoices justified by a period row (D-i: June and July both — the *In this package because* column says `issued`, `paid` or both); quotes and drafts never;
- supplier invoices dated in the period ∪ justified by a period row (cancelled ones never); expenses dated ∪ justified; settlements settled by a period row;
- documents: the invoice PDFs, the `created_from` documents, the per-diem breakdowns, the reimbursement statements, the documents a row justifies directly — each once, named `<business key><original extension>`.

## Flags (R7, FR-004)

Building never blocks. `notes.md`, the *Flags* sheet, the page and the build row carry the same list:

| kind | when |
|---|---|
| `missing_document` | an expense or supplier invoice without its document |
| `unlinked_row` | a main-account row in state `open` (not a transfer, not *no document needed*) |
| `delta` | a `partial` row whose open amount exceeds the D25 tolerance |
| `unpaid_invoice` | an invoice of the period not `paid` / `credited` |
| `document_not_ready` | an issued invoice whose PDF job has not run, a settlement without its statement yet |

Not flags, but in the notes: the transfer pairs with their implied rates, the open owner liability per payment source (the ledger snapshot at build time), the Swiss VAT declaration periods the invoices fall under (totals per period and currency).

## Determinism (R6)

Rows in booking order then file order; entities by key; documents by folder and file name; links by creation. The workbook's created / modified dates and every zip entry's mtime are the period's end; `collectedAt` (the notes' stamp) is the build's "today". The tests build the fixture month twice and compare the bytes.

## Roles

`can(role, "create", "accountant_package")` — the owner builds; `read` — owner and accountant see the page, the preview and download (the zip is a financial document). The editor has no access. Nav item *Package* for owner and accountant.

## Tests

- `generators.pure.test.ts` — periods, the CSVs (conventions, quoting, file names), the summary's sheets and rows, `notes.md`, the zip layout, the year layout, byte-identical builds.
- `package.test.ts` — the fixture month of the harvest (§6 a–d) on the real modules: the collected rows / entities / documents / flags, D31's double appearance, the job (stored zip, counts, notes), a second build (`_v2`, identical bytes), a failed download (nothing stored), the savings placement, the year, the roles, the overview and the preview.
- `e2e/package.spec.ts` — two rows imported this month → `/package` shows the flags → *Build* → the version and *Download*; the accountant's read-only page. Screenshots in `specs/accountant-package/screenshots/`.

## Not built here

A PDF print of the summary (D-i: xlsx only), a yearly auto-build schedule, an e-mail to the accountant — the owner downloads and sends. The Swiss VAT return and the Swedish moms prep are the exports feature ([[feature-inventory]] §3.15), fed by the same read models.
