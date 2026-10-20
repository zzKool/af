# Implementation Plan: Supplier invoices

**Branch**: `feat/supplier-invoices` (one PR: model, services, status, payments, VAT read model, linkable, queries, actions, pages, e2e, screenshots, docs) | **Date**: 2026-10-20 | **Spec**: `specs/supplier-invoices/spec.md`

## Summary

One module `supplier-invoices`, shaped like `expenses` (same keys in the same groups, same ECB / bank bases, same side panel) with what a payable adds: the supplier, its number, a due date, VAT with a registration, optional VAT-split lines, payments as `justifies` links (instalments in the invoice currency; cross-currency by attaching the row like D26), `cancelled` as the only typed state. Depends on expenses (`index.ts`: groups, `expenseSeries` through numbering), partners (`getPartner`, `partnerNames`, + `paymentTermsDays`), rates, documents (`assignBusinessKey`, `storeGeneratedDocument` not needed), linking, banking (`getBankTransaction`), journal (`entriesForSources`), settings (BAS alias, VAT registrations).

## Technical Context

Prisma 7 / Zod 4 / next-safe-action; no new packages. Tables `supplier_invoices`, `supplier_invoice_lines`; `partners.payment_terms_days`; triggers `supplier_invoices_lock_key`, `block_delete_when_linked('supplier_invoice')`. Tests: `status.pure.test.ts`, `supplier-invoices.test.ts` (DB, on the expenses harness), `e2e/supplier-invoices.spec.ts`.

## Constitution Check

- §1 derived never typed: status from links + dates (`cancelled` is a flag with a reason, D28 cancel-not-delete). ✔
- §1 immutable money: amounts / base locked by the service once linked; the key by trigger. ✔
- §1 linking is the product: payments are `justifies` links; `created_from` to the document. ✔
- §2 boundaries: `supplier_invoices.partner_id`, `vat_registration_id` validated UUIDs; `group_id` FK to `expense_groups` (the key carries the group number — same ownership as expenses: the group module is expenses' and the FK is the one cross-module FK, declared on purpose: a group with supplier invoices cannot be deleted either; `expenses.deleteGroup` counts them through `expenses.index`?). → to keep expenses ignorant of this module, `deleteGroup` stays as is and the FK RESTRICT refuses the delete (the service turns the P2003 into a message). ✔
- §2 no setting: terms default 30 is a constant; tolerance from the kernel. ✔

## Data model

```
partners.payment_terms_days   int? (null = 30)

supplier_invoices   group_id (FK RESTRICT) · key · seq · alias · partner_id uuid · invoice_number varchar(100) · invoice_date · due_date · due_date_defaulted
                    currency · amount_net · vat_amount · amount_total · amount_base · rate · rate_source · rate_date? · paid_amount? · paid_currency?
                    bas_code · vat_registration_id? · document_missing · note? · cancelled · cancelled_reason? · cancelled_at?
                    UNIQUE (tenant, key) · UNIQUE (group, alias, seq) · UNIQUE (tenant, partner_id, lower(invoice_number)) (expression index, declared for drift as @@unique([tenantId, partnerId, invoiceNumber]))
supplier_invoice_lines   invoice_id (FK CASCADE) · line_no · description · amount_net · vat_rate · vat_amount · bas_code · UNIQUE (invoice, line_no)
```

## Services / files

`types.ts`, `status.ts` (pure), `supplier-invoices.ts` (create / update / delete / cancel / uncancel / copyLastPrefill), `payments.ts` (recordPayment / removePayment / attachPayment / detachPayment), `queries.ts` (columns, list, detail, kpis, payableTransactions, inputVatForPeriod, listForGroup), `linkable.ts`, `supplier-invoices.actions.ts`, `components/` (table, panel, new dialog), `index.ts`, `ui.ts`; pages `/supplier-invoices`; partner form field; nav; dictionaries; docs `docs/supplier-invoices.md`.
