# Linking — the single link table

Module `src/modules/linking` · schema `prisma/schema/linking.prisma` · migrations `20261020060000_add_links`, `20261020190000_add_created_from_link_kind` · phase-0 item 3c · decisions D18, D27.

> Linking is the product (constitution §1.2). The `links` table is the one source of truth for relationships between documents, bank transactions, journal entries, invoices, supplier invoices, expenses, settlements, partners and contracts. Everything above it — suggestions, the graph, the accountant package — is a read model.

## Model

```
links (tenant_id, from_type, from_id, to_type, to_id, kind, allocated_amount, currency, note, created_at, created_by, source)
  kind ∈ justifies | transfer | settles | belongs_to | created_from   (CHECK constraint)
  unique (tenant, from, to, kind) · RLS tenant_isolation · immutable rows (change = remove + create, both audited)
```

Endpoints are polymorphic (`type` + `id`) — no cross-table foreign keys (RLS blocks them). Existence is checked through the owning module's registered `Linkable`.

| kind | from → to | allocation |
|---|---|---|
| `justifies` | bank_transaction / journal_entry → document / invoice / supplier_invoice / expense | yes — against the target's amount |
| `transfer` | bank_transaction → bank_transaction (`CHANGE CHFSEK` pairs, debit → credit; [[banking]] `acceptTransfer`) | no |
| `settles` | bank_transaction → settlement (owner reimbursement) | yes |
| `belongs_to` | document / invoice / supplier_invoice / expense → partner / contract | no |
| `created_from` | expense / supplier_invoice → document ("what this document became", D27) | no — and exclusive: one origin per document, one document per entity |

The matrix lives in `kinds.ts`; a new linkable type is one line there plus a `Linkable` in its module.

**Why "what a document became" is a link and not a column (D27).** A `became_type/became_id` pair on `documents` plus a `document_id` on every entity would be the same fact stored twice, with its own delete guard, its own audit and its own "show me everything connected to this" query. As a `created_from` link it gets all three from the one table, the document review screen reads *became expense Ex213-Tr-01* from `getLinksFor`, and the graph / package read models see it like any other edge. The exclusivity (a document becomes one thing) is a partial unique index, so it holds even for a direct SQL insert.

## Invariants — where each one lives

| Invariant | Service (`linking.ts`) | Database |
|---|---|---|
| only `modules/linking` writes `links` | guard test `linking owns the link table` | grants: app role has SELECT/INSERT/DELETE, no UPDATE |
| both endpoints exist in the caller's tenant | `Linkable.exists` / `summary` through the registry | RLS on every table |
| kind accepts the pair | `isKindAllowed` | `links_kind_check` |
| allocation > 0, currency matches the target, Σ allocations ≤ target amount | `canAllocate` (property-tested in `allocation.pure.test.ts`) | `links_allocation_positive_check`, `links_allocation_currency_check` |
| Σ allocations **from** one source ≤ its amount, same currency (a bank transaction, a manual journal entry) | `createLink` checks the source's summary too (R19) | service-level — polymorphic sources have no single table to read in a trigger; the target side stays DB-checked |
| no self-link, no duplicate | explicit check / `DUPLICATE_ENTRY` | `links_not_self_check`, unique index |
| `created_from` is exclusive on both ends | `EXCLUSIVE_KINDS` pre-check (`already became …` / `already created from …`) | partial unique indexes `links_created_from_origin_key`, `links_created_from_entity_key` |
| a linked document is never hard-deleted | `deleteDocument` translates the trigger into `BUSINESS_RULE_VIOLATION` | trigger `documents_block_delete_when_linked` (`block_delete_when_linked('document')`) — reuse it for every linkable table |
| every link / unlink is audited | `audit.log` create/delete with the endpoints | — |

## Making a module linkable

```ts
// src/modules/<m>/linkable.ts
import type { Linkable } from "@/modules/linking";
export const invoiceLinkable: Linkable = {
  type: "invoice",
  exists: (tx, id) => tx.invoice.count({ where: { id } }).then((n) => n > 0),
  summary: async (tx, id) => { const i = await tx.invoice.findUnique({ where: { id } }); return i && { type: "invoice", id, label: i.number, amount: i.total.toString(), currency: i.currency }; },
};
```
Export it from the module's `index.ts`, add one line in `src/modules/linking/linkables.ts`, add the type to `LinkableType` and to the matrix in `kinds.ts`, and add the delete trigger to the table's migration. `amount`/`currency` non-null → the entity can receive allocations. Registration is **lazy** (`provideLinkables` with namespace imports, resolved on the first `getLinkable`): every module imports linking, so the import graph is cyclic and a direct read of `module.xLinkable` at import time could see `undefined` depending on which file a test loaded first.

## Surface

- `index.ts`: `getLinksFor`, `isLinked`, `getAllocationStatus`, `createLink`, `removeLink`, types, `registerLinkable` / `provideLinkables`, `isKindAllowed`, allocation math.
- `ui.ts`: actions `createLinkAction`, `removeLinkAction`, `getLinksForAction`, `getAllocationStatusAction` + types. No components yet — the workbench, suggestions (H3) and graph (H13-adjacent) are phase-1 read models.

## Tests

`allocation.pure.test.ts` (fast-check, no DB) · `linking.test.ts` (DB, RLS on): link + audit, rejections, `created_from` exclusivity (service and index), allocations and remaining, remove, delete trigger, cross-tenant isolation (fake linkables) · the source-side invariant and the real `bank_transaction` / `journal_entry` linkables in `modules/banking/import.test.ts` and `modules/journal/journal.test.ts`; `expense` / `settlement` in `modules/expenses/*.test.ts`.
