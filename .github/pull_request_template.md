## What

<!-- one paragraph: module, behaviour added or changed, spec folder -->

Lane (D45): FULL / LIGHT / DIRECT · Spec: `specs/<module>/` · Decision log touched: no / D__

## Definition of done (constitution §4)

- [ ] Spec checklist in `specs/<module>/tasks.md` ticked
- [ ] `npm run lint && npm run typecheck && npm run test` green; architecture guard passes
- [ ] E2E happy path green; flaky tests quarantined with an issue, not retried into green
- [ ] Money / allocation logic has property tests; harvested v1 fixtures ported (if applicable)
- [ ] **Screenshots attached** of every new or changed page and every generated PDF — seed / invented data only, never the owner's real data (D51)
- [ ] `docs/<module>.md` updated and linked from `docs/index.md`
- [ ] No secrets, no SAS URLs, no `console.*` in server code; audit rows on financial mutations
- [ ] Shared files (`schema.prisma`, nav constants, i18n dictionaries) touched → no other open PR touches them

- [ ] **No real data** anywhere in the diff, the tests or this description (D51)

## Screenshots

<!-- drag images here -->
