# Tasks: Contact persons on a partner (F08)

Plan: [plan.md](plan.md). State is left here so any session can continue: tick as you go.

- [x] T001 Model `PartnerContact` in `prisma/schema/partners.prisma` (+ `Partner.contacts`, `Tenant.partnerContacts`); migration `add_partner_contacts` with RLS, grant, index `(tenant_id, partner_id)`
- [x] T002 `PartnerContactDto` in `types.ts`; `contacts.ts` service (schemas, mapper, list / create / update / delete with audit)
- [x] T003 `contacts.test.ts` — the rules of the spec (US1, US2, tenant isolation, audit)
- [x] T004 Actions in `partners.actions.ts`; exports in `index.ts` / `ui.ts`; `cleanupTestData` lists the table
- [x] T005 `components/partner-contacts.tsx`; the tab + overview count in `partner-detail-tabs.tsx`; the page loads the contacts
- [x] T006 i18n `partners.contacts.*` + `partners.tab.contacts*` in en / fr / sv
- [x] T007 e2e journey in `e2e/partners.spec.ts`; the tab in `e2e/screenshots.spec.ts` if the partner page is there
- [x] T008 Screenshot under `specs/partners/screenshots/`; `docs/partners.md`; F08 row in `docs/features.md`; roadmap A4; feature-inventory §3.3 status
- [x] T009 lint, typecheck, unit (partners), build, e2e (partners); PR; `scripts/merge-when-green.sh`; watch `main`'s build-and-e2e

## F71 — partners adopts the D40 kit · branch `feat/partners-d40-kit`
- [x] T010 `state-family.ts` — the one map: `active → done`, `inactive → neutral` (from `isActive`, never typed); `PartnerStateLabel` / `PartnerTypeTags` (`components/partner-labels.tsx`). List: types as grey `<Tag>`s (no `TYPE_COLORS`), Status a `<StateLabel>`, Deactivate / Reactivate in the row's ⋮ (`rowActions`), a Types `quickFilter`, *Add partner* the title row's one primary opening a dialog (`new-partner-button.tsx`, same labels and ids as the old inline form). Partner page: `PageHeader` (no back link, the title once; state + type tags; ⋮ *More actions* with Deactivate / Reactivate; *Graph* secondary), underline tabs with `<CountBadge>`s (`partners.tab.contacts` without its count, `partners.tab.contractList` new, `transactionsCount` / `documentsCount` dropped — en / fr / sv), Overview = *About* (`details.about`) + the form's four groups as `DetailsSection`s (the form's dead header and its deactivate copy removed; `onSaved` keeps the title row's name and types current). Transactions: `formatMoney` + `data-amount`, base from `BASE_CURRENCY`, BAS label a `<Tag>`; Documents: key `<CodeChip>`, category `<Tag>`, the raw OCR step dropped. Contacts: Edit / Delete in a `RowActionsMenu`; `errors.generic` instead of *Error* (review V10, part). Review V4: `listPartnerContacts` re-exported from `queries.ts`; a member refused on the four contact actions (`contacts.test.ts`). Tests: `state-family.pure.test.ts`; `e2e/partners.spec.ts` (badges, the title row's ⋮ deactivate → reactivate, the contacts ⋮); `e2e/screenshots.spec.ts` shoots `partners-new-*`, `partner-contacts-*`; screenshots `specs/partners/screenshots/f71-*` light + dark
- [ ] T011 *(documents + partners)* the Documents tab shows the derived document state — needs `documentsByIds` to carry `documentState` and `DocumentStateLabel` on `documents/ui`; then one line here

## F66 — read through the owners (lessons audit 25) · lane 9, DIRECT · branch `feat/contracts-partners-read-through`
- [x] T012 `validateBasCategoryFK` asks `settings.getBasCategory` + `isBasActivated`; the type-removal guard asks `contracts.activeContractCount` (a lazy `import()` — contracts imports partners) — no `tx.contract` / `tx.basCategory` / `tx.tenantBasPreference` left in `modules/partners`
