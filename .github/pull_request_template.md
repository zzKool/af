## What

<!-- one paragraph: module, behaviour added or changed, spec folder -->

Spec: `specs/<module>/` · Decision log touched: no / D__

## Definition of done (constitution §4)

- [ ] Spec checklist in `specs/<module>/tasks.md` ticked
- [ ] `npm run lint && npm run typecheck && npm run test` green; architecture guard passes
- [ ] E2E happy path green; flaky tests quarantined with an issue, not retried into green
- [ ] Money / allocation logic has property tests; harvested v1 fixtures ported (if applicable)
- [ ] **Screenshots attached** of every new or changed page and every generated PDF
- [ ] `docs/<module>.md` updated and linked from `docs/index.md`
- [ ] No secrets, no SAS URLs, no `console.*` in server code; audit rows on financial mutations
- [ ] Shared files (`schema.prisma`, nav constants, i18n dictionaries) touched → no other open PR touches them

## Screenshots

<!-- drag images here -->
