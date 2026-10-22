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
- [ ] T009 lint, typecheck, unit (partners), build, e2e (partners); PR; `scripts/merge-when-green.sh`; watch `main`'s build-and-e2e
