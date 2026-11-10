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
  notes.md           the flags as prose, the FX differences to book (F114), the transfer pairs, the open owner liability, the Swiss VAT periods
```

The year package `Package_2026.zip` is the same generator over twelve months: `2026/2026-01/…` … `2026/2026-12/…`, the savings rows of the year as `2026/bank-statements/savings.csv`, a yearly `summary.xlsx` and `notes.md` at the root.

Stored as a generated document `Package_2026-06.zip` (`_v2`, `_v3` … on rebuild; the earlier versions stay), prefix `package`, financial — the accountant downloads it like any invoice PDF.

## Module — `src/modules/package/`

| file | what |
|---|---|
| `period.ts` | pure: `parsePeriod("2026-06" / "2026")`, bounds, `monthsOf`, `monthsBetween`, `periodLabel` |
| `collect.ts` | `collectPeriod(tx, period, today)` → `PeriodData`: everything of the period **through the owning modules' queries** (`banking.rawRowsForPeriod`, `journal.entriesForSources`, `linking.linksTouching`, `invoices.listInvoices` + `getInvoice`, `supplierInvoices.listSupplierInvoices`, `expenses.listExpenses` / `listSettlements` / `ledgerSnapshot`, `traktamente.perDiemDocumentsFor`, `documents.documentsByIds`). Derived statuses are the modules' (`banking.transactionStates` — a row's state with its allocation and transfer facts —, the invoice state, the expense status, the owners' `hasDocument`) — the package never recomputes a rule. Split for F83: `periodRows` (the period's rows, their links and states, what they justify / settle), `selectEntities` (pure: the selection and its R6 order), one flag builder per kind of row (`bankRowFacts`, `invoiceFlags`, `supplierInvoiceFlag`, `expenseFlag`, `settlementFlag`) — shared with `flags.ts`, so the two readers cannot drift. |
| `flags.ts` | `collectFlags(tx, period, today)` — the flags only (F83): `periodRows` + `selectEntities` + the flag builders of `collect.ts`, the invoice / supplier-invoice / expense lists read in a date window (the period ∪ the dates of what a period row justifies — each owner's linkable `facts`) instead of whole; no notes, sheets, key index or ledger. `dateWindow` |
| `csv.ts` | pure: one statement per account (by currency, `savings.csv`), the account's delimiter and decimal separator, ISO dates, provenance columns (account, source file, row), UTF-8 with BOM |
| `summary.ts` | pure: the seven sheets through `kernel/xlsx` (F111), money as numbers with a two-decimal format, the workbook dated at the period's end. F114 PR 2: *Paid SEK* (Σ the links' `allocated_base`) and *FX difference SEK* (signed, derived by the owning module) on **Income**, **Supplier invoices** and **Expenses**; *Base SEK* on **Links** |
| `notes.ts` | pure: `notes.md` |
| `zip.ts` | pure: `monthEntries`, `yearEntries`, `zipBytes` (fflate, sorted paths, one fixed mtime) |
| `package.ts` | the build rows: `requestBuild` (owner, version `max + 1`, refused while one runs), `markBuilding` / `markBuilt` / `markFailed`; `toBuildDto` (the status is the Postgres enum's, no cast) |
| `counts.ts` | pure: `EMPTY_COUNTS`, `parsePackageCounts` — the `counts` JSONB read back (a known key with a whole non-negative number, else 0) |
| `jobs/build-package.ts` | `package.build` (pg-boss, exclusive per build): collect in one transaction → `documents.documentReaders` → download outside any transaction → zip → `storeGeneratedDocument` + `markBuilt` in one short transaction; any error → `markFailed` with the message, nothing stored |
| `state-family.ts` | pure, client-safe: `periodState` — the checklist state derived from a period's counts, flags and builds (`building` · `failed` · `flagged` · `built` · `ready` · `empty`) — and the one map of those states and of the build statuses → the D40 families |
| `month-columns.ts` | the months table's columns (a leaf file: the actions read it at load) |
| `queries.ts` | `listBuilds`, `periodOverview` (the months from the first bank row — `banking.firstBookingDate` — to today, live counts and flags for the latest 12, the last build's for older ones; one row per year), `livePreview` (the notes and flags of a period as they would be built now), `periodFlags` (the same flags without the collection — the dashboard's item, F83), `builtPeriods(periods)` (which have a built package, any version — the banking *Months* banner, F69), `periodRow` / `listMonths` / `distinctMonthValues` / `monthDateHierarchy` (the months as a DataTable, in memory over the overview) |
| `package.actions.ts` | `buildPackageAction` (owner; enqueues on commit), `listPackageBuildsAction`, `getPackageBuildAction`, `packagePreviewAction`, `distinctPackageMonthsAction` / `packageMonthDatesAction` (the header filters) (owner + accountant) |
| `components/package-workbench.tsx` | the page: the months' DataTable, the years, the polling of the builds every 2 s while one runs |
| `components/package-panel.tsx` | the docked panel of a period: *Build* / *Rebuild* (the one primary) and *Download v{n}*, then Flags · Documents that go in · `notes.md` · Built versions |
| `components/flag-list.tsx` | the flags on screen, grouped like `notes.md` |

Table `package_builds` (`prisma/schema/package.prisma`): period, version, status `queued → building → built | failed`, document id, counts, flags, notes, error.

## Selection (FR-002)

- main-account rows by booking date; savings rows by the **import's** month for a month (the owner exports the savings account once a year, D-b), by booking date for the year;
- invoices issued in the period ∪ invoices justified by a period row (D-i: June and July both — the *In this package because* column says `issued`, `paid` or both); quotes and drafts never;
- supplier invoices dated in the period ∪ justified by a period row (cancelled ones never); expenses dated ∪ justified; settlements whose refund row is a period row (F114: a settlement is the statement over its row's `settles` links, so the row says which period);
- documents: the invoice PDFs, the `created_from` documents, the per-diem breakdowns, the reimbursement statements, the documents a row justifies directly — each once, named `<business key><original extension>`.

## Flags (R7, FR-004)

Building never blocks. `notes.md`, the *Flags* sheet, the page and the build row carry the same list:

| kind | when |
|---|---|
| `missing_document` | an expense or supplier invoice without its document — the owner's `hasDocument` (a `created_from` document; a per-diem breakdown is one), not a rule of the package's |
| `unlinked_row` | a main-account row in state `open` (not a transfer, not *no document needed*) |
| `no_partner` | a main-account row justified or flagged **without a partner** — `linked_no_partner` / `no_document_no_partner` (F129, D73: a justified row names a partner; the accountant would ask whom it concerns) |
| `delta` | a `partial` row whose open amount exceeds the D25 tolerance |
| `unpaid_invoice` | an invoice of the period not `paid` / `credited` |
| `document_not_ready` | an issued invoice whose PDF job has not run, a settlement without its statement yet |

Not flags, but in the notes: the transfer pairs with their implied rates, the open owner liability per private instrument (the ledger snapshot at build time — the owner's claim still open in base, derived from the `settles` links, F114), the Swiss VAT declaration periods the invoices fall under (totals per period and currency). The bank sheet's *BAS*, *BAS label* and *Partner* (after *BAS label*, F129) are the row's **effective** values — typed by hand, else the proof's, else a rule's (D82; T050: the sheet reads nothing else): the supplier invoice's account and supplier on the row that pays it, the owner as employee on a refund row (banking's `transactionStates`, D58 / D73 — derived on read, nothing written); a row with several proofs that disagree prints the larger allocation's values and `mixed` in its *Flags* cell (the *Links* sheet carries the split); its *Status* is one of banking's six states. The bank sheet's *Linked to* names what each row justifies or settles — a refund row reads `settles ST26-001` once, the settlement's number; the settlements sheet carries the derived FX difference and rounding (`differenceBase` / `rounding` of the settlement DTO, the one rule of `settlement-math.ts`). The three payment columns (F114 PR 2, FR-009): every sheet of a payable or receivable carries the base at the entity's date (*Total SEK* / *Amount SEK*, as before), **Paid SEK** = Σ what the bank rows gave for it and **FX difference SEK** = the signed difference the owning module derives (`invoices.getInvoice`'s `allocatedBase` / `fxDifference`, the supplier-invoice and expense list rows' — the package computes none of it); the *Links* sheet shows each link's *Base SEK*. `notes.md` opens an **FX differences** section after the flags: one line per entity of the period whose difference is not zero, with the sign rule the accountant books by — payables and reimbursements > 0 a loss (7960), < 0 a gain (3960); receivables the reverse. A settlement's rounding stays on its own sheet.

## On screen (D40, F71)

```
Accountant package                                       ┌ Before sending — October 2026 ──────┐
[Filter rows…] [Month ▾]                                 │ ! Flags to check                     │
Month          State             Lines … Flags Package ⋮ │ [Download v1] [Rebuild]              │
October 2026   ! Flags to check      5 …    3  Package_… │ ▾ Flags (3)   Plusgirokonto SEK …    │
December 2025  ◐ Ready to build      1 …    0  —         │ ▾ Documents that go in               │
Years: the same columns, ⋮ Build / Download              │ ▸ notes.md   ▾ Built versions        │
```

- **The months are a DataTable** (`tableKey` `package-months`): every column is computed, so the filters, the sort and the page run in memory over `periodOverview`'s months (`listMonths`) — the URL is the query (D20). *Month* is the period's first day, a date column with `quickFilter` (years → months). The years stay a kit `Table` under it with the same ⋮ (`RowActionsMenu`).
- **The state is derived** (`state-family.ts`, one map): the latest build running → *Building* (in progress), failed → *Build failed* (attention), any flag → *Flags to check* (attention), a built version → *Built* (done), anything in the period → *Ready to build* (in progress), else *Nothing to send* (neutral). The versions in the panel use the build status's family. Older months (past the 12 collected live) read their last build's flags, as before.
- **Row buttons → ⋮**: *Build* / *Rebuild* (owner, disabled while one runs) and *Download v{n}*. A row opens the docked panel (since F155 nothing opens on arrival — the Close cards come first). The panel's title row has the one primary (*Build* / *Rebuild*, owner) beside *Download v{n}*.
- **Flags on screen**: a business key as `<CodeChip>`, a bank line as its account and day, the figure through `formatMoney` (a bank line's signed amount, a delta's or an invoice's open amount — `package.flag.open`). The collector adds `amount`, `currency`, `account`, `date` to a flag for the screen only; `notes.md` and the *Flags* sheet print `key` + `detail` as before, and `generators.pure.test.ts` pins the bytes of the zip, `summary.xlsx`, `notes.md` and the year zip against a golden (`package-golden.json`, in UTC — fflate dates the entries in local time; taken before F71, re-captured for F111, for F114 PR 2 and for F129's *Partner* column — opened with openpyxl before the JSON was copied). To re-capture after a reviewed change of the sheets: `PACKAGE_GOLDEN_OUT=<dir> npx vitest run src/modules/package/generators.pure.test.ts` writes the four files and the new JSON there — open the workbook with a second reader before copying the JSON over.
- No Tailwind palette colour, no `formatCurrency`, no `toLocaleString` left in the module.

## The Close page (F155, the Pulse-Close board)

`/package` is titled **Close** and opens on two cards above the months:

```
Close
┌ Accountant package · October 2026  ‹Sep  Nov› ┐ ┌ Swiss VAT · Q4 2026      due 2027-03-01 ┐
│ not ready  2 of 5 checks open …               │ │ Collect ━━ Prepare ── Declared ── Paid │
│ ✓ Bank statements for October 2026            │ │ Taxable turnover          68 400 CHF   │
│ ! Every bank line justified    [Open Reconcile]│ │ VAT due · Input tax · To pay          │
│ ✓ Every document read and linked              │ │ Swedish moms: nothing to declare here │
│ ✓ Client invoices paid                        │ │        [See the n invoices] [Open the return] │
│ ! Exchange rates for every line   [Open rates]│ └────────────────────────────────────────┘
│ What goes in the zip: 2026-10/ bank-statements/ … │
│ Last package …     [Flags and notes] [Build anyway] │
└───────────────────────────────────────────────┘
Every month — the DataTable as before; Years under it
```

- **The month** is the one just ended (the month the accountant gets), `?close=2026-07` for another — ‹ › walk the months the table lists. Nothing opens the docked panel on arrival any more; *Flags and notes* (or a row) opens it.
- **Five checks, counted, never typed** (`close.ts`, pure, `close.pure.test.ts`) over the same collected period a build writes: *bank* (lines imported, accounts), *justified* (lines carrying a flag other than `mixed`), *documents* (`missing_document` + `document_not_ready`), *invoices* (`unpaid_invoice`), *rates* (every pair's newest ECB day reaches the month's last weekday, three days' tolerance for a TARGET closing day; while the month runs, two days back). An open check links to the page that closes it.
- **The zip tree** lists what `monthEntries` would write: one statement per account, the document folders with files, `summary.xlsx`, `notes.md`; the size is the stored documents' bytes.
- **Build is never blocked**: with an open check the button reads *Build anyway* (the open items are notes.md's flags); a built month offers *Download v{n}* and *Rebuild*. The card's builds are polled with the table's.
- **The VAT card** is the exports module's (`VatQuarterCard`, `vatQuarterCard` in `modules/exports/queries.ts`), composed by the page — see [[exports]].

## Determinism (R6)

Rows in booking order then file order; entities by key; documents by folder and file name; links by creation. The workbook's created / modified dates and every zip entry's mtime are the period's end; `collectedAt` (the notes' stamp) is the build's "today". The tests build the fixture month twice and compare the bytes.

## Roles

`can(role, "create", "accountant_package")` — the owner builds; `read` — owner and accountant see the page, the preview and download (the zip is a financial document). The editor has no access. Nav item *Package* for owner and accountant.

## Tests

- `generators.pure.test.ts` — periods, the CSVs (conventions, quoting, file names), the summary's sheets and rows, `notes.md`, the zip layout, the year layout, byte-identical builds.
- `package.test.ts` — the fixture month of the harvest (§6 a–d) on the real modules: the collected rows / entities / documents / flags, D31's double appearance, the job (stored zip, counts, notes), a second build (`_v2`, identical bytes), a failed download (nothing stored), the savings placement, the year, the roles, the overview and the preview; F83: `periodFlags` equal to the preview's flags on the fixture month and on a month whose rows pay entities dated in three earlier months (fails when the window is the bare period); F129 (one-table SC-004): the uncategorised row paid to the supplier invoice prints its account (653) and the supplier, the fee the bank, the refund row the owner and the expense's account.
- `state-family.pure.test.ts` — each state reached by its rule, one family each; `components/flag-list.test.tsx` — the screen's money, keys and order.
- `e2e/package.spec.ts` — two rows imported this month → `/package` shows *Flags to check* and the flags → the panel's *Build* → the version, *Download v1*, the key in the row; the accountant's read-only page. Screenshots in `specs/accountant-package/screenshots/` (`package-light.png` / `package-dark.png` from `e2e/screenshots.spec.ts`).

## Not built here

A PDF print of the summary (D-i: xlsx only), a yearly auto-build schedule, an e-mail to the accountant — the owner downloads and sends. The Swiss VAT return and the Swedish moms prep are the exports feature ([[feature-inventory]] §3.15), fed by the same read models.
