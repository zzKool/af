# Spec — 4.1 Background jobs: Inngest → pg-boss (D17)

**Problem.** v2 ran OCR through Inngest: an external service, a signing key, a dev server to start by hand, HTTP callbacks — and nothing on the homelab or a scaled-to-zero container. The constitution (§1.9) wants jobs queued in Postgres, resumable, with scheduled work catching up on start.

**Decision.** pg-boss in the same process, behind a kernel contract so modules never see the library.

**Requirements**
- R1 `kernel/jobs` exposes `JobDefinition` (name, retry options, queue policy, `handler`, optional `onDeadLetter`), `ScheduleDefinition` (cron, tz, `missed`), `enqueue()`, `startJobs()`, `stopJobs()`, `withJobContext()`. pg-boss is imported there only (guard).
- R2 A job carries ids; every attempt re-reads the entity's status and does what is left. Throw = retry; retries exhausted or attempt expired = dead-letter queue `<name>.dead` → `onDeadLetter`.
- R3 The `pgboss` schema is installed by a reviewed migration, owned by the app role; pg-boss runs with `migrate: false`. A test fails when the package's schema version and the stored one diverge.
- R4 The worker starts in-process from `src/instrumentation.ts` (composition root), never at build time, and never crashes the app when the queue is unavailable. `JOBS_DISABLED=1` skips it.
- R5 Document OCR ported as `documents.process-document` (exclusive per documentId, OCR_MAX_RETRIES, dead letter marks `ocr_failed`); upload enqueues from `onCommit`.
- R6 ECB sync scheduled (`rates.ecb-sync`, weekdays 16:30 Stockholm, `missed: "once"`); the run sizes its request from the gap since the last stored rate so one catch-up run refills weeks.
- R7 Inngest removed: route, dependency, script, env keys, docs.

**Out of scope.** PDF and package-build jobs (they arrive with their modules); a jobs admin page (SQL on `pgboss.job` is enough for one user).
