# Plan: Contact persons on a partner (F08)

Spec: [spec.md](spec.md). Branch `feat/partners-contacts`, one PR. This round owns `prisma/schema` and the i18n dictionaries.

## Shape

```
prisma/schema/partners.prisma      + model PartnerContact  (partner_contacts)
prisma/migrations/2026102210…      CREATE TABLE + FK partner ON DELETE CASCADE + RLS + grant — additive only
src/modules/partners/
  contacts.ts                      service: Zod schemas, toPartnerContactDto, list / create / update / delete (audit)
  contacts.test.ts                 DB-backed (RLS on): validation, sort, scoping (other partner, other tenant), audit
  types.ts                         + PartnerContactDto
  partners.actions.ts              + list / create / update / delete ContactAction (ownerAction)
  components/partner-contacts.tsx  the tab body: inline add, row view (mailto / tel) ↔ row edit, delete with confirm
  components/partner-detail-tabs.tsx  + Contacts (n) tab, + count in the overview summary
  index.ts / ui.ts                 exports
src/app/(app)/partners/[id]/page.tsx  loads the contacts in the same tenant transaction
src/kernel/i18n/dictionaries/{en,fr,sv}.ts  partners.contacts.*
e2e/partners.spec.ts               + one journey: add → edit → delete on a partner it creates
docs/partners.md                   a Contacts section
```

## Decisions (the agent's, written down)

- **Own file `contacts.ts`** rather than growing `partners.ts` (504 lines) — the audit pass asks for smaller services.
- **Intra-module FK** `partner_id → partners(id) ON DELETE CASCADE`: same module, same tenant (the contract-rates precedent); cascade because a contact has no meaning without its partner and nothing references a contact.
- **Not linkable**: no `linkable.ts` entry, nothing in the link table.
- **No ListQuery / DataTable**: a partner has a handful of contacts; a plain table like the contract rates, sorted by `lower(name)` in the query.
- **Edit as a row toggle** (view ↔ inputs with Save / Cancel), not autosave-on-blur per cell: the view row carries the `mailto:` / `tel:` links the spec asks for, and a contact is changed as one thing.
- **Empty strings become `null`**; values are trimmed in the Zod schema, so a name of spaces is refused there.
- **Scoping**: `update` / `delete` find the row by id under RLS (another tenant → not found); the actions take the contact id only — the partner id of an existing contact cannot be changed.
- **Audit** entity type `partner_contact`, before/after via `toAuditData(dto)`.

## Tests

- `contacts.test.ts`: create (all fields, name only, trims, empty name refused, bad e-mail refused, unknown partner refused), list sorted case-insensitively and only the partner's own, update (role change audited, clear e-mail, bad e-mail refused, unknown id → NOT_FOUND), delete (gone, audited), tenant isolation (tenant B cannot list / update / delete tenant A's contact).
- e2e: create a partner, open it, Contacts tab, add / edit / delete, the tab count follows.

## Constitution check

Additive migration (no drop) · RLS + FORCE on the new table · DTO out of the module, never the Prisma row · writes through `ownerAction` → service → `tx` with audit · no status stored · strings in en / fr / sv · screenshot of the tab in `specs/partners/screenshots/`.
