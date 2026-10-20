# Tasks — 4.1
- [x] T1 Migration `add_pgboss` (generated construction plans, app-role ownership) — applied locally and in CI
- [x] T2 `kernel/jobs/{types,queue,context}.ts` + `queue.test.ts` on real pg-boss (retry → dead letter, exclusive keys, version check)
- [x] T3 `documents.process-document` as a resumable JobDefinition; `enqueue` from the upload action; tests ported
- [x] T4 `rates.ecb-sync` schedule with gap-sized catch-up (`observationsToFetch` pure test)
- [x] T5 `src/instrumentation.ts` composition root; `pg-boss` in `serverExternalPackages`; guard rule for vendor SDK locality
- [x] T6 Remove Inngest (route, dep, script, env); docs (async-jobs rewrite, ocr-processing, document-upload, ecb-rates, local-environment-setup, index, feature-folders, phase-0)
