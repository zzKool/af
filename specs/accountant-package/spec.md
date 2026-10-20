# Feature Specification: Accountant package — the month (or year) as one zip, generated from the links

**Feature Branch**: `feat/accountant-package`

**Created**: 2026-10-20

**Status**: Ready for implementation (harvest `specs/accountant-package/harvest.md` H12; decisions D13, D17, D19, D31; owner's answers D-b, D-i)

**Input**: "Once a month I send the accountant everything he needs to book the month: the bank lines of the two main accounts, every justification document, and the sheet that says which document explains which bank line. Today that sheet is my Excel. The app must generate the whole package from what is already linked, flag what is missing, and let me extract the whole year the same way."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build the month (Priority: P1)

The owner opens `/package`. One row per month that has bank rows (newest first; the current month always present), each with the live counts of the month — bank lines, client invoices, supplier invoices, expenses, documents — and the number of **flags** (what the accountant would ask about: unlinked bank lines, missing receipts, unpaid invoices, deltas beyond the tolerance). *Build* queues the job; the row shows *building…* then the version, the built-at time and *Download*. Rebuilding after changes makes `_v2`; the previous version stays downloadable. The zip (R2):

```
2026-06/
  bank-statements/   SEK.csv  CHF.csv            (savings.csv in the month its export was imported, D31)
  client-invoices/   InvoiceAF_VA26-INV-001.pdf
  supplier-invoices/ SI213-Acc-01_2026-06-24_Skattepunkten.pdf
  expenses/          Ex213-Tr-01_2026-06-11_.pdf  Reimb_ST26-001_2026-06-30.pdf
  documents/         <plain documents linked straight to a bank row>
  summary.xlsx       Bank statement · Income · Supplier invoices · Expenses · Links · Flags
  notes.md           the flags as prose, the transfer pairs, the open owner liability, the Swiss VAT totals
```

**Why this priority**: it replaces the Excel the owner maintains by hand (D13) — the reason the links exist.

**Independent Test**: a fixture month built from the modules' services (two accounts, a transfer pair, a bank fee, an invoice paid short, a private expense settled, an expense without its receipt) → the zip holds exactly the expected file names and `notes.md` exactly the expected flags.

**Acceptance Scenarios**:

1. **Given** June has 12 SEK rows and 3 CHF rows **When** built **Then** `bank-statements/SEK.csv` has 12 data rows and `CHF.csv` 3, booking date ascending then file order, the stored columns plus the provenance columns (account, source file, row), the account's delimiter and decimal separator, ISO dates.
2. **Given** an invoice issued in May and paid by a June row **Then** it is in June's Income sheet with reason *paid* and its PDF in `client-invoices/`; in May with reason *issued* (D31: both months).
3. **Given** an expense of June without a receipt **Then** the Expenses sheet says `MISSING` in *Document* and `notes.md` lists it under *Missing documents*; the build succeeds (R7).
4. **Given** a June row linked to nothing and not *no document needed* **Then** it is an *Unlinked bank line* flag; a transfer pair of June is listed under *Transfer pairs* with its implicit rate and is not a flag.
5. **Given** the same data **When** built twice **Then** the two zips have the same entries with the same bytes (fixed timestamps, deterministic order — R6).
6. **Given** a document the blob store cannot deliver **Then** the build fails with the reason, no package document exists, the previous version is untouched (R8).

---

### User Story 2 - The year (Priority: P2)

*Build 2026* on the year row runs the same generator over the twelve months: one zip with twelve monthly folders (each exactly as its monthly package), `bank-statements/savings.csv` at the root with the savings rows of the year, and a yearly `summary.xlsx` + `notes.md` over the whole year (D31). Stored as `Package_2026.zip`.

---

### User Story 3 - The accountant downloads (Priority: P2)

The accountant sees `/package` read-only: the months, the counts, the flags, the built versions with *Download* and the notes preview; no *Build*. An editor has no access (constitution §6 role table; `can(role, read, accountant_package)`).

## Requirements *(mandatory)*

- **FR-001** `package_builds` (period `YYYY-MM` or `YYYY`, version, status `queued → building → built | failed`, document id, counts, flags, notes, error) — one row per build; the version is `max + 1` per period; RLS like every tenant table.
- **FR-002** Period selection (harvest §4.1): main-account rows by booking date; savings rows by the month their import happened (year: by booking date); invoices issued in the period ∪ invoices justified by a period row; supplier invoices dated in the period ∪ justified by a period row; expenses dated in the period ∪ justified by a period row; settlements settled by a period row. Documents: the invoice PDFs, the `created_from` documents of expenses and supplier invoices, the reimbursement statements, the documents a period row justifies directly — each once, under its business key and original extension.
- **FR-003** `summary.xlsx` is built by pure functions over the collected data (`xlsx`, already a dependency): one sheet per Excel sheet of today with the accountant's columns, *Links* (every arrow: from, to, kind, allocation, created at), *Flags*. Money as decimal strings with two decimals, dates ISO, nothing typed by hand.
- **FR-004** `notes.md` sections: Missing documents · Unlinked bank lines · Transfer pairs · Open owner liability (per payment source, SEK, at build time) · Invoices issued but unpaid · Deltas beyond tolerance · Swiss VAT declaration periods. The same flags are counted on the page before any build — the month-end checklist.
- **FR-005** The job `package.build` (pg-boss, exclusive per build id): collects inside one tenant transaction, downloads the documents outside any transaction, zips (fflate, fixed mtime = period end), stores the zip through `documents.storeGeneratedDocument` (`Package_2026-06.zip`, `_v2`…, prefix `package`, financial), marks the build *built* with its counts and notes; any failure marks it *failed* with the message and stores nothing.
- **FR-006** `/package` (list archetype, D19): months newest first with counts, flags, builds; the year rows; *Build* (owner, `create accountant_package`); *Download* through the documents' signed URL (financial document read — owner and accountant); the notes of the selected build in a pane. The page refreshes itself while a build is queued or building.
- **FR-007** Nav item *Package* for owner and accountant; strings `package.*` en + fr.

## Success Criteria *(mandatory)*

- **SC-001** The fixture month's zip lists exactly the expected entries and `notes.md` exactly the expected flags (harvest §6 a).
- **SC-002** Two builds of the same month are byte-identical (§6 b).
- **SC-003** `can()`: owner builds and downloads, accountant downloads only, editor neither (§6 c); the savings CSV is in the import month's package and at the root of the year package (§6 d).
- **SC-004** The e2e builds a month from the seeded data on `/package`, sees the version and *Download*, opens the notes.

## Assumptions

- The summary is `.xlsx` only (D-i); no PDF print of it.
- The owner liability note is the open liability at build time (the ledger snapshot), not reconstructed at month end — the package is built right after the month closes.
- Documents are copied as stored; the package does not re-render anything (the reimbursement statement exists once its settlement is confirmed, the invoice PDF once issued). A document still being rendered is a flag (*document not ready*), not an error.
