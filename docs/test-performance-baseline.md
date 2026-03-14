# Test Performance Baseline

Baseline measured on 2026-03-14, before Story 5.0 code changes.

## Current Baseline

### Unit/Integration Tests (Vitest)

| Metric | Value |
|--------|-------|
| Test files | 31 |
| Total tests | 394 |
| Total duration | 115.90s |
| Test execution time | 102.84s |
| Transform time | 1.10s |
| Setup time | 1.89s |
| Import time | 7.82s |

**Slowest test suites** (>2s):
- `tenant-client.test.ts` — 2741ms (DB integration)
- `audit.test.ts` — 2103ms (DB integration)
- `cross-table-rls-spike.test.ts` — 1957ms (DB integration)
- `dashboard.test.ts` — 1717ms (DB integration)
- `ecb-rates.test.ts` — 1714ms (DB integration)
- `rate-limit.test.ts` — 1701ms (DB integration)

**Pattern:** DB integration tests dominate execution time. Pure unit tests (lib/, components/) complete in <600ms.

### E2E Tests (Playwright)

| Metric | Value |
|--------|-------|
| Total tests | 4 |
| Workers | 2 |
| Total duration | 11.7s |

### CI Pipeline (GitHub Actions)

| Job | Duration |
|-----|----------|
| lint | 33s |
| typecheck | 49s |
| unit-test | 195s (3m15s) |
| build-and-e2e | 161s (2m41s) |
| **Total pipeline** | **~6m04s** |

Source: Run `23077586785` (develop merge of Story 4.3 PR, 2026-03-14)

## Growth Trajectory

- Epic 4 grew test count by 23% (321 → 394 tests, +73 tests across 3 feature stories)
- Average ~24 tests per feature story
- Epic 5 has 5 feature stories (5.1–5.5) — expected ~120 new tests
- Projected post-Epic 5: ~514 tests

## Warning Thresholds

| Metric | Current | Warning Threshold (2x) |
|--------|---------|----------------------|
| Local test duration | 116s | 232s |
| CI unit-test job | 195s | 390s |
| CI total pipeline | 364s | 728s |

**Action required** if CI test step exceeds 390s (6m30s).

## Optimization Strategies (if threshold is hit)

1. **Parallel test execution** — Vitest already uses workers; increase `maxWorkers` or use `--pool=forks` for DB tests
2. **Test database pooling** — Reuse DB connections across test files instead of per-test setup
3. **Fixture caching** — Cache seed data across test suites that share the same fixtures
4. **Test sharding** — Split CI test job into parallel matrix runs (fast unit tests vs slow DB tests)
5. **Selective test runs** — Run only affected tests on PRs using Vitest's `--changed` flag
