---
name: test-conventions
description: What a test must cover in AF and how it is written (Vitest co-located, Playwright e2e, factories, property tests on money, tenant isolation, flaky quarantine). Use before writing or reviewing any test.
---

# Test conventions

Read first: `docs/conventions.md`, `docs/config-page-test-template.md`, `docs/test-performance-baseline.md`, `src/kernel/test-utils/`, `src/kernel/db/test-fixtures.ts`.

## Where
- `*.test.ts` next to the code (Vitest). Service tests run against the **test database** (`db-test`, port 5433) with RLS on — never mocked Prisma.
- `e2e/*.spec.ts` (Playwright) — one happy path per module, against the dev stack with Azurite.
- Architecture guard: `src/kernel/guards/architecture.guard.test.ts` — extend it when the constitution adds a rule.

## Every service test file covers
1. happy path
2. permission denied (`can()` false for the role)
3. validation error at the action boundary
4. **tenant isolation**: create as tenant A, read/update as tenant B → not found
5. audit row written for mutations

## Property tests (fast-check) are mandatory for
- money arithmetic (sums, VAT, rounding, currency conversion)
- link allocations (sum ≤ amount, partial settlements, cross-currency netting)
- numbering (consecutive, gap-free under concurrency)

## Fixtures
- Factories: `createTestTenant`, `createTestPartner`, `createTestContract`, … — add one per new entity in `test-fixtures.ts`.
- Harvested v1 behaviour (matcher, calculator, VAT mapping) ships as fixture tables under `specs/<module>/fixtures/` and is asserted, not re-derived.

## Flaky tests
A test that fails without a code change is quarantined: `test.skip` with a link to an issue, same PR. Never retried into green, never left red.

## E2E hygiene
- Wait for the success toast / the specific row, never for a row count.
- Seed through factories, not through the UI.
- Screenshots on failure are kept as artifacts; a screenshot of each new page goes in the PR.
