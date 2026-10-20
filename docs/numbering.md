# Numbering — `number_series` and the fixed key functions

Decisions D5 and D6 (2026-10-20, phase-0 item 4.4): invoice numbers and business keys are **fixed functions**, counters are **one table**, and there is **no prefix or numbering settings page**. v2's `document_type_prefixes` engine and `document_key_counters` are gone from the code (the two tables are dropped by a separate, approved migration).

## Module `src/modules/numbering`

```
keys.ts              pure functions — the Excel conventions, verbatim (+ input validation, property tests)
number-series.ts     nextInSeries(tx, caller, series) — row-locked upsert; peekSeries(tx, series) — read-only
prisma/schema/numbering.prisma   number_series(tenant_id, series, next_value, updated_at), RLS
```

| What | Function | Example |
|---|---|---|
| invoice number | `invoiceNumber(shortCode, issueDate, seq)` — series `{short code}{yy}` | `VA26-001` |
| quote number | `quoteNumber(issueDate, seq)` — series `QUO{yy}` | `QUO26-007` |
| credit note | `creditNoteNumber(shortCode, issueDate, seq)` — series `CN-{short code}{yy}` | `CN-VA27-001` |
| invoice PDF document | `invoicePdfKey(number)` | `InvoiceAF_VA26-001.pdf` |
| expense ref | `expenseRef(groupNumber, basAlias, seq)` — series `exg-{group}` | `Ex213-Tr-01` |
| expense receipt key | `expenseDocumentKey(ref, documentDate)` | `Ex213-Tr-01_2026-03-11_` |
| raw upload (provisional) | `uploadDocumentKey(kind, date, seq)` — series `doc-{yyyy-mm}` | `exp_20261020_001` |

Series keys (`invoiceSeries`, `quoteSeries`, `creditNoteSeries`, `expenseGroupSeries`, `uploadSeries`) are what `number_series` is keyed by. Sequences are 3 digits (2 for expense refs) and simply grow past that.

## Taking a number

```ts
const seq = await nextInSeries(tx, caller, invoiceSeries(partner.shortCode, issueDate));
const number = formatSeriesNumber(invoiceSeries(partner.shortCode, issueDate), seq); // VA26-004
```

Rules (enforced by how the upsert works, tested in `number-series.test.ts`):
- **Same transaction as the thing being numbered.** The row stays locked until commit, so concurrent issuers queue and get consecutive numbers; a rollback hands the number back — no gaps, no duplicates.
- **After validation, before the insert.** Taking the number first and failing later is fine (rollback), but a number taken in a transaction that then commits without the entity is a gap for ever.
- **Never outside `withTenantTransaction`**: the table is RLS-scoped; each tenant has its own series.
- `peekSeries` is for previews ("this draft will be VA26-004") — it does not lock and the preview can be overtaken.

## Why no settings

The Excel the owner ran the company on used exactly these conventions by hand. v1 had a 260-line numbering engine and v2 a per-tenant prefix table — both mechanism for a single tenant that never changes its format. If a format must change, it changes here, in code, with its tests.

## Migration notes

`20261020150000_add_number_series` creates the table and **carries the monthly upload counters over** (`document_key_counters.next_val + 1 → number_series('doc-yyyy-mm')`) so no provisional key is reused. `document_type_prefixes` and `document_key_counters` are no longer read or written; their Prisma models stay (marked deprecated) until the drop migration lands.

Related: [[document-upload]] (provisional keys), the `invoice-pdf` skill (issue lifecycle), the `bas-accounting` skill (aliases), [[excel-to-v3-mapping]].
