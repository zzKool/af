# Numbering — `number_series` and the fixed key functions

Decisions D5, D6, D21 and D28 (2026-10-20, phase-0 item 4.4 + the owner's answers): invoice numbers and business keys are **fixed functions**, counters are **one table**, and there is **no prefix or numbering settings page**. v2's `document_type_prefixes` engine and `document_key_counters` are gone — code and tables (D30).

The owner's one rule for client documents: **client code and year first, then the type marker (`INV`, `QUO`, `CN`), then the number** — `VA26-INV-001`, `VA26-QUO-001`, `VA26-CN-001`. Files sort by client and year in any explorer, and each type has its own gap-free counter.

## Module `src/modules/numbering`

```
keys.ts              pure functions — the Excel conventions, verbatim (+ input validation, property tests)
number-series.ts     nextInSeries(tx, caller, series) — row-locked upsert; peekSeries(tx, series) — read-only
prisma/schema/numbering.prisma   number_series(tenant_id, series, next_value, updated_at), RLS
```

| What | Function | Example |
|---|---|---|
| invoice number | `invoiceNumber(shortCode, issueDate, seq)` — series `{short code}{yy}-INV` | `VA26-INV-001` |
| quote number | `quoteNumber(shortCode, issueDate, seq)` — series `{short code}{yy}-QUO` | `VA26-QUO-007` |
| credit note | `creditNoteNumber(shortCode, issueDate, seq)` — series `{short code}{yy}-CN` | `VA27-CN-001` |
| invoice / quote / credit-note PDF | `invoicePdfKey(number)` | `InvoiceAF_VA26-INV-001.pdf` |
| expense ref | `expenseRef(groupNumber, basAlias, seq)` — series `exg-{group}` | `Ex213-Tr-01` |
| expense receipt key | `expenseDocumentKey(ref, documentDate)` | `Ex213-Tr-01_2026-03-11_` |
| supplier invoice ref | `supplierInvoiceRef(groupNumber, basAlias, seq)` — series `exg-{group}` (shared with expenses) | `SI213-Acc-01` |
| supplier invoice document key | `supplierInvoiceDocumentKey(ref, documentDate, vendorName)` — vendor slug appended (`fileSlug`) | `SI213-Acc-01_2026-07-24_Skattepunkten_s_Office_Services_AB` |
| raw upload (provisional) | `uploadDocumentKey(kind, date, seq)` — series `doc-{yyyy-mm}` | `exp_20261020_001` |

Series keys (`invoiceSeries`, `quoteSeries`, `creditNoteSeries`, `expenseGroupSeries`, `uploadSeries`) are what `number_series` is keyed by. Sequences are 3 digits (2 for group refs) and simply grow past that. Year = the **issue date's** year, never the clock.

## Taking a number

```ts
const seq = await nextInSeries(tx, caller, invoiceSeries(partner.shortCode, issueDate));
const number = formatSeriesNumber(invoiceSeries(partner.shortCode, issueDate), seq); // VA26-INV-004
```

Rules (enforced by how the upsert works, tested in `number-series.test.ts`):
- **Same transaction as the thing being numbered.** The row stays locked until commit, so concurrent issuers queue and get consecutive numbers; a rollback hands the number back — no gaps, no duplicates.
- **After validation, before the insert.** Taking the number first and failing later is fine (rollback), but a number taken in a transaction that then commits without the entity is a gap for ever.
- **Never outside `withTenantTransaction`**: the table is RLS-scoped; each tenant has its own series.
- `peekSeries` is for previews ("this draft will be VA26-INV-004") — it does not lock and the preview can be overtaken.

## Why no settings

The Excel the owner ran the company on used exactly these conventions by hand. v1 had a 260-line numbering engine and v2 a per-tenant prefix table — both mechanism for a single tenant that never changes its format. If a format must change, it changes here, in code, with its tests.

## Migration notes

`20261020150000_add_number_series` creates the table and **carries the monthly upload counters over** (`document_key_counters.next_val + 1 → number_series('doc-yyyy-mm')`) so no provisional key is reused. `20261020200000_drop_v2_prefix_tables` then drops `document_type_prefixes` and `document_key_counters` (D30, owner's OK 2026-10-20).

Related: [[document-upload]] (provisional keys), the `invoice-pdf` skill (issue lifecycle), the `bas-accounting` skill (aliases), [[excel-to-v3-mapping]].
