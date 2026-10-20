---
name: invoice-pdf
description: Rules for documents AF renders to PDF (client invoices, quotes, credit notes, reimbursement statements, package summary) — one component with edit and print modes, Chromium rendering, numbering, VAT, languages. Use when touching anything printed.
---

# Invoice and PDF rules

Decisions: D5, D7, D12 in `docs/feature-inventory.md`. Business fields: `docs/excel-to-v3-mapping.md` sheet 2. v1 behaviour to harvest: `af_core/lib/pdf/invoice-template.ts`, `quote-template.ts`, `invoice-translations-v2.ts` (read for layout and strings, do not copy code).

## One component, two modes
- `<InvoiceSheet mode="edit" | "print" />` renders the **same layout**. Edit mode places inputs inline where the values sit (invoice-generator.com style); print mode renders values only.
- The PDF is Chromium printing the print mode at `/print/invoice/[id]` (server-rendered, no client JS needed). `kernel/pdf` owns the browser; modules only provide a route: the page calls `requirePrintCaller(searchParams, "/print/invoice/" + id)` (kernel/auth) and the issuing service calls `renderPathToPdf("/print/invoice/" + id, caller)` from a job or `onCommit`. Print CSS (`@page { size: A4 }`, page breaks) lives with the component. See `docs/pdf.md`.
- What you see in edit mode is what the PDF shows. No second template. Ever.

## Lifecycle
`draft` → **issue** (number assigned, PDF generated once, stored as a document with business key `InvoiceAF_{number}.pdf`, locked) → `sent` (set by hand) → `paid` (derived from bank links) · `credited` (credit note referencing the original).
Drafts have no number. Issued invoices are immutable; corrections are credit notes.

## Numbering
`number_series(tenant_id, series, next_value)` row-locked in the issue transaction. Series key `{partner.short_code}{yy}` → `VA26-001`. Quotes `QUO-`, credit notes `CN-`. Gap-free per series, no reset UI, no settings.

## Content checklist
- tenant: name, org number, address, logo, VAT numbers of the registration used, bank details (IBAN/BIC per currency)
- partner: name, address, labelled identifiers (supplier number …); contract: labelled reference (PO)
- invoice: number, dates, period label, currency, lines (description, quantity, unit, rate, amount), discount, subtotal, VAT per rate, total, payment terms, due date
- VAT: the registration decides — CH 8.1 % on Swiss invoices (declaration period on the invoice), SE moms, or reverse charge text for EU B2B
- language: strings from `kernel/i18n` dictionaries (`en`, `fr`; `sv` later). No hardcoded text in the component.
- Money: Decimal until the formatter; currency-aware rounding; formatted with the partner's locale.

## Tests
- snapshot of print-mode HTML for a fixture invoice per language
- numbering: concurrent issue → consecutive numbers, no gaps, no duplicates
- totals: property test lines → subtotal/VAT/total consistency
- PR: screenshot of the generated PDF attached
