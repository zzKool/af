# Story 5.0: Epic 5 Prep Sprint

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a development team,
I want to complete all prep sprint tasks identified in the Epic 4 retrospective,
so that Epic 5 stories (5.1–5.5) have Sentry error tracking, proven Azure Blob Storage infrastructure via Azurite, proven Inngest async job infrastructure with database access patterns, specific action names in application logs, an updated client-side checklist with auto-save pattern documentation, and a test performance baseline.

## Acceptance Criteria

1. **Given** Sentry integration has been deferred since Epic 2 (deferred item #4) and Epic 5 introduces real error surfaces (document upload, OCR, blob storage)
   **When** the prep sprint is complete
   **Then** `@sentry/nextjs` is installed and configured with source maps, the error handler in `action-client.ts` reports unhandled errors to Sentry with `tenant_id` + `user_id` + `sentryEventId` context, a test error endpoint verifies Sentry connectivity, and `docs/observability.md` is updated to reflect the active Sentry integration

2. **Given** Story 5.1 requires uploading files to Azure Blob Storage (Azurite locally) at path `/{tenant_id}/{uuid}.{ext}`
   **When** the prep sprint is complete
   **Then** a spike has verified: (a) Azurite service in docker-compose.yml starts correctly, (b) `@azure/storage-blob` SDK can upload blobs, download blobs, generate SAS URLs, and delete blobs against Azurite using a container-encapsulated service, (c) test patterns using Azurite are documented with a CI strategy, (d) findings are documented in `docs/blob-storage.md`

3. **Given** Story 5.2 requires dispatching `document/uploaded` Inngest events for async OCR processing with database access
   **When** the prep sprint is complete
   **Then** a spike has verified: (a) Inngest Dev Server runs locally and receives events from the Next.js app, (b) an Inngest function can be defined, triggered by a custom event, and access the database via `withTenantTransaction` with proper RLS context, (c) retry behavior works on transient failures (3 retries with backoff), (d) database transactions roll back on function failure (no partial writes), (e) a reusable `createSystemCaller` helper and `withInngestContext` wrapper are established, (f) test patterns for Inngest functions are documented, (g) findings are documented in `docs/async-jobs.md`

4. **Given** Pino application logs currently record `action: "server_action"` for all mutations in `logging.ts` (deferred item #6), making operational debugging harder as more actions are added
   **When** the prep sprint is complete
   **Then** a metadata schema is defined on the `next-safe-action` base client, every Server Action definition includes `.metadata({ name: "actionName" })`, and the logging middleware uses `metadata.name` instead of the generic `"server_action"` string, with `logging.test.ts` updated to verify metadata propagation

5. **Given** Epic 4 retro identified three new client-side edge cases: (a) empty-value clearing on blur, (b) missing None option for optional selects, (c) header-sync for extracted persistent headers
   **When** the prep sprint is complete
   **Then** the story creation checklist (`docs/story-creation-checklist.md`) includes 3 new mandatory items covering these patterns with code examples, plus a "Code Duplication Threshold" section, and `docs/auto-save-pattern.md` consolidates all 8 known auto-save edge cases into a single pattern reference

6. **Given** the test suite grew 23% in Epic 4 (321 to 394 tests) and will continue growing with document and journal entry test suites
   **When** the prep sprint is complete
   **Then** the CI test duration baseline is measured (before any code changes), documented, and a monitoring threshold is established in `docs/test-performance-baseline.md`

## Tasks / Subtasks

- [x] Task 0: Retro Gate Check (AC: all)
  - [x] 0.1 Open `_bmad-output/implementation-artifacts/deferred-items.md` and check for items with deadlines at or before Epic 5
  - [x] 0.2 Verify item #4 (Sentry integration) is addressed by Task 2 — deadline was "Before Epic 5"
  - [x] 0.3 Verify item #6 (generic action labels in Pino logs) is addressed by Task 5 — deadline was "Before Epic 5"
  - [x] 0.4 Verify no other items have passed their deferral deadline
  - [x] 0.5 Document check result in Dev Agent Record

- [x] Task 1: Test performance baseline (AC: #6) — **MUST run before any code changes to capture clean baseline**
  - [x] 1.1 Run `npm run test` and capture total execution time. Record: number of tests, number of test files, total duration, slowest test suites.
  - [x] 1.2 Run `npm run e2e` and capture total execution time. Record: number of tests, total duration, slowest specs.
  - [x] 1.3 If CI pipeline exists, check recent CI run durations for test and E2E steps via `gh run list` and `gh run view`.
  - [x] 1.4 Document in `docs/test-performance-baseline.md`:
    - Current baseline numbers (date, test count, duration)
    - Expected growth trajectory (Epic 5 adds ~30 tests per story based on Epic 4 average)
    - Warning threshold: flag if CI test step exceeds 2x current baseline
    - Optimization strategies if threshold is hit (parallel test execution, test database pooling, fixture caching)

- [ ] Task 2: Azurite + Azure Blob Storage spike (AC: #2) — **PATTERN-SETTER: first blob storage interaction. De-risk this blocker before Sentry.**
  - [ ] 2.1 Verify Azurite service in `docker-compose.yml` starts correctly: `docker compose up azurite -d` — confirm ports 10000 (blob), 10001 (queue), 10002 (table) are accessible.
  - [ ] 2.2 Install `@azure/storage-blob`: `npm install @azure/storage-blob`
  - [ ] 2.3 Create `src/server/services/storage.ts` — a thin abstraction over `@azure/storage-blob`. The container name is **hardcoded internally** from `AZURE_STORAGE_CONTAINER` env var (architecture mandates a single container named `documents`). Interface:
    ```typescript
    export interface StorageService {
      ensureContainer(): Promise<void>;
      uploadBlob(blobPath: string, data: Buffer, mimeType: string): Promise<string>;
      downloadBlob(blobPath: string): Promise<Buffer>;
      deleteBlob(blobPath: string): Promise<void>;
      generateSasUrl(blobPath: string, expiresInMinutes: number): Promise<string>;
    }
    ```
    Implementation uses `BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING)`. Service MUST NOT import from `next/*` (hexagonal boundary). Callers pass `blobPath` as `{tenantId}/{uuid}.{ext}` — the service does not know about tenants.
  - [ ] 2.4 Create `src/server/services/storage.test.ts` — integration tests against Azurite. Guard with `describe.skipIf(!process.env.AZURE_STORAGE_CONNECTION_STRING)` so CI doesn't break (CI has no Azurite service). Tests:
    - Ensure container → success (idempotent)
    - Upload blob (small PDF fixture) → success, returns URL
    - Download blob → content matches uploaded data
    - Generate SAS URL → URL is valid and accessible
    - Delete blob → success, subsequent download throws/returns 404
    - Upload with tenant-prefixed path `/{tenantId}/{uuid}.pdf` → verifies path structure works
  - [ ] 2.5 Verify `.env.example` already has `AZURE_STORAGE_CONNECTION_STRING` and `AZURE_STORAGE_CONTAINER` (confirmed — already present with Azurite defaults).
  - [ ] 2.6 Document findings in `docs/blob-storage.md` (NOT `blob-storage-spike.md` — this evolves into the pattern doc for Story 5.1): Azurite setup, SDK usage, connection string format, test patterns, CI strategy (`describe.skipIf`), known limitations (SAS URL hostname differences between Azurite and production Azure).

- [ ] Task 3: Inngest spike (AC: #3) — **PATTERN-SETTER: first async job infrastructure. De-risk this blocker before Sentry.**
  - [ ] 3.1 Verify existing Inngest setup: `src/server/inngest/client.ts` (Inngest client with id "defterfab") and `src/app/api/inngest/route.ts` (serve handler) already exist. Confirm they work with Inngest Dev Server.
  - [ ] 3.2 Add `"inngest:dev": "npx inngest-cli@latest dev"` script to `package.json`. Do NOT install `inngest-cli` as a devDependency — use `npx`.
  - [ ] 3.3 Create `src/server/inngest/context.ts` — a reusable helper for Inngest functions that need database access:
    ```typescript
    import { prisma } from "@/server/db/client";
    import { withTenantTransaction } from "@/server/db/tenant-client";
    import { createAuditEntry } from "@/server/services/audit";
    import type { CallerIdentity } from "@/types/caller-identity";
    import type { AuditLogger } from "@/types/audit";
    import type { TransactionClient } from "@/server/db/tenant-client";

    /** Build a CallerIdentity for system-initiated async jobs.
     *  userId should be the ORIGINAL user who triggered the action
     *  (e.g., the user who uploaded the document), passed via event data. */
    export function createSystemCaller(tenantId: string, userId: string): CallerIdentity {
      return { userId, tenantId, role: "owner", source: "system" };
    }

    /** Execute a callback within full Inngest context: RLS transaction + audit logger. */
    export async function withInngestContext<T>(
      tenantId: string,
      userId: string,
      callback: (tx: TransactionClient, caller: CallerIdentity, audit: AuditLogger) => Promise<T>,
    ): Promise<T> {
      const caller = createSystemCaller(tenantId, userId);
      return withTenantTransaction(prisma, tenantId, async (tx) => {
        const audit: AuditLogger = {
          log: async (params) => createAuditEntry(tx, caller, params),
        };
        return callback(tx, caller, audit);
      });
    }
    ```
  - [ ] 3.4 Create `src/server/inngest/functions/process-document.ts` — a **real skeleton** for the OCR function (NOT a throwaway test-echo). This code STAYS and Story 5.2 fills in the blanks:
    ```typescript
    import { inngest } from "../client";
    import { withInngestContext } from "../context";

    export const processDocument = inngest.createFunction(
      { id: "process-document", retries: 3 },
      { event: "document/uploaded" },
      async ({ event, step }) => {
        const { tenantId, userId } = event.data;
        // Spike: prove DB access works using an existing table (e.g., partners)
        // Story 5.2 replaces this with actual document processing
        const result = await step.run("verify-db-access", async () => {
          return withInngestContext(tenantId, userId, async (tx, caller, audit) => {
            // Read: proves RLS-scoped query works inside Inngest
            const count = await tx.partner.count();
            // Write: proves audit logging works inside Inngest
            // (skip actual audit write in spike — just prove the context is available)
            return { tenantId, partnerCount: count, callerSource: caller.source };
          });
        });
        return result;
      }
    );
    ```
  - [ ] 3.5 Register the function in the serve handler: update `src/app/api/inngest/route.ts` to include `processDocument` in the functions array.
  - [ ] 3.6 Test event dispatch: start Inngest Dev Server (`npm run inngest:dev`), send a test event via the Dev Server UI or via `inngest.send({ name: "document/uploaded", data: { tenantId: "...", userId: "..." } })` from a test endpoint. Verify the function executes and returns DB access results.
  - [ ] 3.7 Test failure modes — these are the spike EXIT CRITERIA:
    - Function retries on transient failure (throw on first attempt, succeed on retry)
    - Function reaches dead letter after 3 max retries
    - Database transaction rolls back on function failure (no partial writes)
    - Concurrent events for different tenants don't interfere (send 2 events with different tenantIds)
    - Event payload with `tenantId` + `userId` is reliably received
  - [ ] 3.8 Document security note: the Inngest serve route (`/api/inngest`) currently has NO signing verification. For the spike this is acceptable. Production code in Story 5.1+ MUST configure `INNGEST_SIGNING_KEY` to verify that event callbacks originate from Inngest, not arbitrary HTTP requests. Add this to deferred items if not resolved in this story.
  - [ ] 3.9 Document findings in `docs/async-jobs.md` (NOT `inngest-spike.md` — this evolves into the pattern doc for Story 5.2): how to create Inngest functions, `withInngestContext` usage, test patterns (unit: call handler directly with mocked step/event; integration: Inngest Dev Server), retry configuration, step functions, signing key requirement.

- [ ] Task 4: Sentry integration (AC: #1) — **PATTERN-SETTER: first external error tracking service**
  - [ ] 4.1 Install `@sentry/nextjs`: `npx @sentry/wizard@latest -i nextjs` — this scaffolds `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, and updates `next.config.ts` with `withSentryConfig()`. If wizard fails or generates outdated config for Next.js 16.1, fall back to manual installation: `npm install @sentry/nextjs` and create config files per latest Sentry docs. **Note:** No `instrumentation.ts` currently exists in the project — if the wizard generates one, verify it's compatible with Next.js 16's instrumentation hook. If creating manually, you may need `src/instrumentation.ts` with `Sentry.init()`.
  - [ ] 4.2 Configure Sentry DSN via environment variable `SENTRY_DSN` in `.env.example` and `.env.local`. Use empty string as default (Sentry disabled when DSN is empty — graceful degradation for local dev). Note: `SENTRY_DSN` is NOT sensitive (it's public in browser requests). `SENTRY_AUTH_TOKEN` (for source map uploads) IS sensitive — CI only, never in `.env.local`.
  - [ ] 4.3 Configure source maps upload: set `SENTRY_AUTH_TOKEN` env var in `.env.example` (CI only). Disable source map upload in development (`NODE_ENV !== 'production'`).
  - [ ] 4.4 Update the error handler in `src/server/middleware/action-client.ts`: in the `handleServerError` callback, call `Sentry.captureException(error)` for non-ActionError exceptions (unexpected crashes) and capture the returned `sentryEventId`. Return it in the error response so users can report it: `message: "An unexpected error occurred. Reference: ${eventId}"`. ActionErrors are business errors — do NOT report to Sentry. Verify that Sentry's `isolationScope` properly isolates between concurrent requests in standalone mode (shared process).
  - [ ] 4.5 Add `Sentry.setUser({ id: userId })` and `Sentry.setContext('tenant', { tenantId })` in `src/server/middleware/auth.ts` for request-scoped Sentry context.
  - [ ] 4.6 Update `src/server/middleware/logging.ts`: add `Sentry.setTag('requestId', requestId)` so Sentry events correlate with Pino log entries.
  - [ ] 4.7 Create `src/app/api/sentry-test/route.ts` (development only): a GET endpoint that throws a test error, verifying Sentry receives it. Guard with `NODE_ENV === 'development'`. This is a manual verification step — visually confirm the error appears in Sentry dashboard.
  - [ ] 4.8 Update `docs/observability.md`: change Sentry status from "Deferred" to "Active", document DSN configuration, what gets reported (unexpected crashes only with sentryEventId returned to user), and what doesn't (ActionErrors, business validation).
  - [ ] 4.9 Add `SENTRY_DSN` to CI env vars in GitHub Actions workflow (`.github/workflows/ci.yml`) — use empty string for CI runs.
  - [ ] 4.10 Verify: `npm run build` succeeds with Sentry integration (check `withSentryConfig()` composes with existing conditional `output: "standalone"`), `npm run dev` works with empty DSN (graceful no-op).

- [ ] Task 5: Action name specificity in application logs (AC: #4) — resolves deferred item #6
  - [ ] 5.1 **Understand the actual problem:** The generic `"server_action"` string is in `src/server/middleware/logging.ts` (Pino application logs), NOT in the audit trail. The audit system already uses type-safe action names (`"create" | "update" | "delete" | "deactivate" | "reactivate"` + `entityType`) via the `AuditLogger` union type. Do NOT modify the audit system — it's correct.
  - [ ] 5.2 Define a metadata schema on the `next-safe-action` base client in `src/server/middleware/action-client.ts`:
    ```typescript
    const baseClient = createSafeActionClient({
      defineMetadataSchema: () => z.object({ name: z.string() }),
      handleServerError: (error) => { ... },
    });
    ```
  - [ ] 5.3 Update every Server Action definition across **all 9 action files** to include `.metadata({ name: "..." })`. The name should match the export variable name without the `Action` suffix (e.g., `createPartnerAction` → `metadata({ name: "createPartner" })`). Files to update:
    - `src/server/actions/partners.ts` — getPartners, getPartner, createPartner, updatePartner, deactivatePartner, reactivatePartner
    - `src/server/actions/contracts.ts` — getContracts, createContract, updateContract, deactivateContract, reactivateContract
    - `src/server/actions/settings.ts` — getSettings, updateSettings
    - `src/server/actions/bank-accounts.ts` — all CRUD actions
    - `src/server/actions/vat-registrations.ts` — all CRUD actions
    - `src/server/actions/bas-preferences.ts` — all CRUD actions
    - `src/server/actions/document-type-prefixes.ts` — all CRUD actions
    - `src/server/actions/user-preferences.ts` — get, upsert
    - `src/server/actions/dashboard.ts` — getDashboard
  - [ ] 5.4 Update `src/server/middleware/logging.ts` to use the metadata name:
    ```typescript
    // Before:
    log.info({ action: "server_action" }, "Action invoked");
    // After (metadata is available in middleware params):
    export const loggingMiddleware = createMiddleware<{
      serverError: AppError;
      ctx: { userId: string; tenantId: string | null };
    }>().define(async ({ ctx, metadata, next }) => {
      const actionName = metadata?.name ?? "unknown";
      // ...
      log.info({ action: actionName }, "Action invoked");
      // ... in finally block:
      log.info({ action: actionName, durationMs }, "Action completed");
    });
    ```
  - [ ] 5.5 Update `src/server/middleware/logging.test.ts` to pass metadata in test invocations and assert specific action names in log output.
  - [ ] 5.6 Verify all tests pass: `npm run test -- --reporter verbose`

- [ ] Task 6: Client-side checklist + auto-save pattern doc (AC: #5)
  - [ ] 6.1 Add 3 new mandatory items to `docs/story-creation-checklist.md` under "Client-Side UI Checklist > Mandatory Items". Include a 2-line code example for each:
    - **Empty-value clearing on blur** — Auto-save onBlur handlers must treat empty string as a valid value, not as "no change". When a user clears a text field, the empty value must be committed to the server.
      ```tsx
      // WRONG: if (value === field.current) return;  // "" === "" skips save
      // RIGHT: if (value === field.current && value !== "") return;
      ```
      - *Rationale: Story 4.1 — clearing a text field back to empty was ignored by onBlur, which treated "" as unchanged.*
    - **None option for optional selects** — Optional select dropdowns (currency, language, BAS category, etc.) must include a "None" or "—" option so users can un-select a previously chosen value. The None option should send `null` to the server.
      ```tsx
      <option value="">— None —</option>  // Always include for optional selects
      // onChange handler: send null when value === ""
      ```
      - *Rationale: Story 4.1 — once a user selected a currency or language, there was no way to un-select it.*
    - **Header-sync for persistent headers** — When a form field (e.g., partner name) is displayed in both a persistent header and a form body, auto-save updates must propagate to the header. Use a callback (e.g., `onNameSaved`) that triggers `router.refresh()` or direct state update.
      ```tsx
      // In form: onSave={() => onNameSaved?.(newName)}
      // In parent: const onNameSaved = () => router.refresh();
      ```
      - *Rationale: Story 4.3 — partner name in the persistent header became stale after auto-save updated the name in the form body.*
  - [ ] 6.2 Add a "Code Duplication Threshold" section after the Client-Side UI Checklist:
    - Flag second copy as tech debt in the deferred items register
    - Extract to shared utility on third copy
    - *Rationale: Epic 4 retro — `extractError` was duplicated in Stories 4.1 and 4.2, only extracted to shared utility in Story 4.3. Second copy should have been flagged immediately.*
  - [ ] 6.3 Create `docs/auto-save-pattern.md` — consolidate ALL 8 known auto-save edge cases into a single pattern reference document. This is the holistic "how to build auto-save forms" guide that Story 5.3 (document review with OCR correction) will need. Include:
    - Auto-save lifecycle: onBlur for text fields, onChange for selects
    - Edge case 1: Error handling — surface failures via toast, never swallow silently
    - Edge case 2: Stale closures — use refs or functional updates
    - Edge case 3: Optimistic rollback — revert state on server failure
    - Edge case 4: Empty-value clearing — treat "" as valid
    - Edge case 5: None option for optional selects — include "—" with null value
    - Edge case 6: Header sync — propagate changes to persistent headers
    - Edge case 7: React key stability — use entity IDs, never array indices
    - Edge case 8: Confirm dialog for destructive saves — use ConfirmDialog
    - Reference implementations: `PartnerForm` (onBlur text), settings tabs (onChange select)

- [ ] Task 7: Update deferred items register (AC: all)
  - [ ] 7.1 Update `_bmad-output/implementation-artifacts/deferred-items.md`:
    - Move item #4 (Sentry integration) to Resolved section: "Story 5.0 Task 4 — @sentry/nextjs configured"
    - Move item #6 (generic action labels in Pino logs) to Resolved section: "Story 5.0 Task 5 — .metadata() on all actions, logging middleware uses action name"
  - [ ] 7.2 Review all remaining active items: verify deadlines are still appropriate
  - [ ] 7.3 Update "Last updated" date
  - [ ] 7.4 Update `docs/index.md` with links to new docs: `blob-storage.md`, `async-jobs.md`, `test-performance-baseline.md`, `auto-save-pattern.md`

- [ ] Task 8: Verify everything (AC: all)
  - [ ] 8.1 Run full test suite: `npm run test` — all existing 394+ tests + new tests pass
  - [ ] 8.2 Run `npx biome check --write` then `npm run lint` — clean
  - [ ] 8.3 Run `npm run build` — succeeds with Sentry integration
  - [ ] 8.4 Run `npm run e2e` — no regressions
  - [ ] 8.5 Verify `docker compose up -d` starts all services (db-dev, db-test, azurite)
  - [ ] 8.6 Verify `npm run dev` starts without errors
  - [ ] 8.7 Verify Inngest Dev Server connects to the app and discovers `processDocument` function

## Dev Notes

### Architecture Patterns & Constraints

- **This is a housekeeping/infrastructure story** — similar to Stories 3.0 and 4.0. Mix of external service integration (Sentry), infrastructure spikes (Azurite, Inngest), codebase-wide refactor (action metadata), documentation, and process updates.
- **Three PATTERN-SETTER tasks** — Sentry, Azurite, and Inngest establish the first usage of these technologies. Follow prep sprint pattern: spike, document, keep production code minimal.
- **Hexagonal boundary applies** — `src/server/services/storage.ts` and `src/server/inngest/context.ts` MUST NOT import from `next/*`. Sentry integration touches middleware (server-side, acceptable) and Next.js config (framework boundary, acceptable).
- **Inngest functions run OUTSIDE the middleware chain.** The action pipeline (auth → rateLimit → logging → tenant → audit) does NOT exist in Inngest function handlers. The `withInngestContext` wrapper provides an equivalent: RLS transaction + CallerIdentity + AuditLogger. This is a **parallel execution path** that must be documented and tested.
- **No new domain models, no new pages.** The storage service is infrastructure. The Inngest function skeleton uses existing tables (partners) as a proxy until the documents table exists in Story 5.1.

### Recommended Execution Order

1. **Task 0** (gate check) → 2. **Task 1** (test baseline — BEFORE code changes) → 3. **Task 2** (Azurite spike — blocker for 5.1) → 4. **Task 3** (Inngest spike — blocker for 5.2) → 5. **Task 4** (Sentry — important but not a blocker) → 6. **Task 5** (action log names — code refactor) → 7. **Task 6** (checklist + auto-save docs) → 8. **Task 7** (deferred register) → 9. **Task 8** (verification)

**Rationale:** Test baseline must be measured before any code changes. Azurite and Inngest are actual blockers for Epic 5 feature stories — de-risk them before spending time on Sentry (important but not blocking). Task 5 is a codebase-wide refactor (9 files, ~30 actions) — do it after spikes when the codebase is stable.

### Sentry Integration — Design Decisions

- **Sentry wizard vs manual**: Try `npx @sentry/wizard@latest -i nextjs` first. If it generates incompatible config for Next.js 16.1, fall back to manual installation per latest Sentry docs. The wizard may generate `instrumentation.ts` with `Sentry.init()` — the project currently has NO `instrumentation.ts` file, so this would be new. Verify it's compatible with Next.js 16's instrumentation hook.
- **What gets reported**: Only unexpected crashes (non-ActionError exceptions). ActionErrors are intentional business errors (FORBIDDEN, VALIDATION_ERROR, etc.) — NOT sent to Sentry.
- **sentryEventId in error response**: When `Sentry.captureException()` is called, it returns an `eventId`. Include this in the error message returned to the user: `"An unexpected error occurred. Reference: ABC123"`. This transforms Sentry from a dev-only tool to a user-support tool — users can quote the reference when reporting issues.
- **Graceful degradation**: When `SENTRY_DSN` is empty, Sentry SDK should no-op silently. Verify local dev works without a DSN.
- **Next.js 16.1 compatibility**: `withSentryConfig()` must wrap the OUTER config export: `export default withSentryConfig(nextConfig, sentryOptions)`. It composes with the existing `next.config.ts` that conditionally sets `output: "standalone"` and uses `serverExternalPackages: ["pino", "pino-http", "pino-pretty"]`. Sentry config must compose with the existing config, not replace it.
- **Source maps**: Only upload in CI/production builds. Set `SENTRY_AUTH_TOKEN` as a GitHub Actions secret, not in `.env.local`.
- **Scope isolation**: Verify that `Sentry.setUser()` and `Sentry.setContext()` in auth middleware use Sentry's `isolationScope` correctly for concurrent requests in standalone mode (shared Node.js process, not serverless).

### Azurite Spike — Context

- **Azurite already in docker-compose.yml** — the service is defined with blob (10000), queue (10001), and table (10002) ports. Volume `azurite-data` persists data.
- **Connection string** already in `.env.example` and `.env.local` with Azurite default credentials.
- **Architecture mandates**: path structure `/{tenant_id}/{uuid}.{ext}`, single container named `documents`, signed URLs with 5-minute TTL.
- **Container name hardcoded in service** — the architecture mandates a SINGLE container. Do NOT pass `containerName` as a parameter on every method. Read `AZURE_STORAGE_CONTAINER` env var once in the service constructor/factory. Callers only provide `blobPath`.
- **Known Azurite limitation**: SAS URLs generated against Azurite use `127.0.0.1:10000` as hostname. In production, they use the Azure Blob endpoint. The storage service should NOT hardcode hostnames — use the SDK's built-in URL generation.
- **CI strategy**: CI does NOT run Azurite. Use `describe.skipIf(!process.env.AZURE_STORAGE_CONNECTION_STRING)` to skip storage tests in CI. Locally, `docker compose up azurite -d` must be running. Document this clearly.
- **Test pattern**: Use a **unique container name per test run** (e.g., `test-${Date.now()}`) with cleanup in `afterAll` (delete the test container). This ensures test isolation without polluting the `documents` container used by development. Do NOT use blob-level cleanup in `afterEach` — container-level isolation is simpler and more reliable.
- **Doc naming**: `docs/blob-storage.md` — NOT `blob-storage-spike.md`. This doc starts as spike findings and evolves into the pattern doc that Story 5.1 updates with production usage patterns. Avoids doc proliferation (spike doc + pattern doc).

### Inngest Spike — Context

- **Inngest client and route already exist**: `src/server/inngest/client.ts` creates an Inngest client with id `"defterfab"`. `src/app/api/inngest/route.ts` serves the handler with an empty functions array. The package `inngest@^3.52.6` is already installed.
- **Inngest Dev Server**: Run `npx inngest-cli@latest dev` — this starts a local dashboard at `http://localhost:8288` and discovers functions via the Next.js serve endpoint.
- **Architecture mandates**: Inngest HTTP callbacks run within the same Next.js process (no separate worker). Events dispatched via `inngest.send()`. Retry: 3x with exponential backoff.
- **Functions run OUTSIDE the middleware chain**: No auth, no rateLimit, no tenant middleware. The function handler is a raw async function that must manually set up its own context. The `withInngestContext` wrapper solves this by providing: (1) `withTenantTransaction` for RLS-scoped DB access, (2) `CallerIdentity` with `source: "system"`, (3) `AuditLogger` for recording mutations. **Mirror the proven `auditMiddleware` pattern in `src/server/middleware/action-client.ts:70-82`** — it already demonstrates exactly how to create an `AuditLogger` wrapper around `createAuditEntry(tx, caller, params)`.
- **CallerIdentity.userId**: Pass the ORIGINAL user who triggered the action (e.g., the user who uploaded the document). Include `userId` in the event payload alongside `tenantId`. Do NOT use a made-up `"system"` UUID — the audit trail needs the real actor for compliance ("who caused this action?").
- **Build skeleton, don't throwaway**: Instead of creating and deleting `test-echo.ts`, build the actual `process-document.ts` skeleton. Use existing tables (partners) as a proxy to prove DB access works. Story 5.2 fills in the OCR logic — the infrastructure stays.
- **Spike EXIT CRITERIA**: The spike is not "prove happy path works." It must test failure modes: retry on transient error, rollback on crash, concurrent tenant isolation, dead letter after max retries. Without these, the spike gives false confidence.
- **Signing key security**: The Inngest serve route currently has NO signing verification (`INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` are empty in `.env.local`). For the spike this is acceptable. Production code in Story 5.1+ MUST configure signing keys to prevent arbitrary HTTP callers from triggering functions.
- **Doc naming**: `docs/async-jobs.md` — NOT `inngest-spike.md`. Same rationale as blob-storage.

### Action Log Specificity — Context (CORRECTED)

- **The problem is in Pino logs, NOT the audit trail.** The `src/server/middleware/logging.ts` middleware logs `{ action: "server_action" }` for every Server Action invocation. This generic string makes operational debugging difficult — all actions look the same in log output.
- **The audit system is CORRECT.** `AuditLogger` uses a TypeScript union type (`"create" | "update" | "delete" | "deactivate" | "reactivate"`) with `entityType` strings. All 26 `audit.log()` calls across 8 services already pass specific, type-safe values. Do NOT modify the audit system.
- **The fix uses `next-safe-action` metadata.** Version 8.1.8 supports `.metadata()` on actions and passes it through the middleware chain. Currently, no action uses `.metadata()` — the logging middleware receives `metadata: undefined`.
- **Scope of change**: Define `defineMetadataSchema` on the base client, add `.metadata({ name: "..." })` to every action definition (~30 actions across 9 files), update the logging middleware to use `metadata.name`. This is a codebase-wide refactor, not a small fix.
- **Naming convention**: Match the export name without `Action` suffix. `createPartnerAction` → `{ name: "createPartner" }`.

### Previous Story Intelligence (Story 4.3 & Story 4.0)

- **394 tests passing** — must not regress
- **Pre-commit hook active** — husky + lint-staged runs `biome check --write` on staged files
- **Story 4.0 established the prep sprint pattern** — follow the same structure: infrastructure tasks, spikes, documentation, test utilities, verification
- **Conventional commits**: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`
- **Run `npx biome check --write` before committing** to avoid CI lint failures

### Git Intelligence

Recent commits (Story 4.3):
- `61c4cd6` fix: code review fixes for story 4.3
- `7a7b1b3` docs: add entity-view-pattern documentation
- `722fef5` feat: add partner and contract counts to dashboard
- `0a52be8` feat: add partner entity view with tabbed layout

Pattern: feature commits first, then docs, then code review fixes.

### What NOT to Build

- No domain models, migrations, pages, routes (except Sentry test endpoint), sidebar/dashboard changes — that's Stories 5.1–5.5
- Do NOT modify the audit system (`audit.ts`, `AuditLogger` type, or any `audit.log()` calls) — it's already correct with type-safe action names
- Do NOT install `inngest-cli` as a devDependency — use `npx` to keep it out of the dependency tree
- Do NOT split `process-document.ts` into actual OCR implementation — just prove infrastructure works using existing tables as a proxy

### Existing Code to Reuse (DO NOT Reinvent)

Key reuse targets not already detailed in task descriptions:
- `src/server/db/client.ts` → PrismaClient singleton — import in `withInngestContext`
- `src/server/db/tenant-client.ts` → `withTenantTransaction` + `TransactionClient` type export
- `src/server/services/audit.ts` → `createAuditEntry(tx, caller, params)` — reuse in Inngest audit logger
- `src/server/middleware/action-client.ts:70-82` → `auditMiddleware` pattern for AuditLogger creation
- `src/types/caller-identity.ts` → `CallerIdentity` type with `source: "system"` already defined
- `src/types/audit.ts` → `AuditLogger` type — reuse in `withInngestContext`

### Project Structure Notes

New files:
- `sentry.client.config.ts` (project root — Sentry convention)
- `sentry.server.config.ts` (project root — Sentry convention)
- `sentry.edge.config.ts` (project root — Sentry convention, may not be needed)
- `src/instrumentation.ts` (may be generated by Sentry wizard — verify Next.js 16 compatibility)
- `src/server/services/storage.ts`
- `src/server/services/storage.test.ts`
- `src/server/inngest/context.ts` (createSystemCaller + withInngestContext)
- `src/server/inngest/functions/process-document.ts` (skeleton — stays for Story 5.2)
- `src/app/api/sentry-test/route.ts` (dev-only test endpoint)
- `docs/blob-storage.md`
- `docs/async-jobs.md`
- `docs/test-performance-baseline.md`
- `docs/auto-save-pattern.md`

Modified files:
- `next.config.ts` (Sentry withSentryConfig wrapper — must compose with existing config)
- `package.json` (@sentry/nextjs, @azure/storage-blob deps + inngest:dev script + metadata schema import)
- `package-lock.json`
- `src/server/middleware/action-client.ts` (Sentry.captureException in error handler + defineMetadataSchema on baseClient)
- `src/server/middleware/logging.ts` (metadata.name for action identity + Sentry.setTag for requestId)
- `src/server/middleware/logging.test.ts` (pass metadata in test invocations)
- `src/server/middleware/auth.ts` (Sentry.setUser + setContext for tenant)
- `src/app/api/inngest/route.ts` (register processDocument function)
- `src/server/actions/partners.ts` (add .metadata() to all actions)
- `src/server/actions/contracts.ts` (add .metadata() to all actions)
- `src/server/actions/settings.ts` (add .metadata() to all actions)
- `src/server/actions/bank-accounts.ts` (add .metadata() to all actions)
- `src/server/actions/vat-registrations.ts` (add .metadata() to all actions)
- `src/server/actions/bas-preferences.ts` (add .metadata() to all actions)
- `src/server/actions/document-type-prefixes.ts` (add .metadata() to all actions)
- `src/server/actions/user-preferences.ts` (add .metadata() to all actions)
- `src/server/actions/dashboard.ts` (add .metadata() to all actions)
- `docs/observability.md` (Sentry active)
- `docs/story-creation-checklist.md` (3 new UI items with code examples + code duplication threshold)
- `docs/index.md` (add new doc links)
- `_bmad-output/implementation-artifacts/deferred-items.md` (resolve #4, #6)
- `.env.example` (add SENTRY_DSN, SENTRY_AUTH_TOKEN)
- `.github/workflows/ci.yml` (SENTRY_DSN env var)

### References

- [Source: _bmad-output/implementation-artifacts/epic-4-retro-2026-03-14.md — Prep Sprint section (7 tasks), process improvements #1-#3, tech debt items #4, #6]
- [Source: _bmad-output/implementation-artifacts/deferred-items.md — Items #4 (Sentry, deadline Before Epic 5), #6 (action labels, deadline Before Epic 5)]
- [Source: _bmad-output/implementation-artifacts/4-0-epic-4-prep-sprint.md — Previous prep sprint pattern and structure]
- [Source: _bmad-output/implementation-artifacts/4-3-partner-entity-view.md — Latest story learnings, code review fixes]
- [Source: _bmad-output/planning-artifacts/architecture.md — Blob storage path structure, Inngest topology, Sentry observability, environment configuration]
- [Source: _bmad-output/planning-artifacts/epics.md — Epic 5 stories 5.1-5.5 for dependency context]
- [Source: _bmad-output/planning-artifacts/prd.md — FR1, FR2, FR7, NFR17, NFR20 for document management requirements]
- [Source: docs/story-creation-checklist.md — Existing checklist to extend with new items]
- [Source: docs/observability.md — Current Sentry status (deferred)]
- [Source: src/server/middleware/action-client.ts — Error handler + base client to update]
- [Source: src/server/middleware/logging.ts — Contains generic "server_action" string to fix]
- [Source: src/server/middleware/logging.test.ts — Shows metadata: undefined in current tests]
- [Source: src/types/audit.ts — AuditLogger union type, already correct]
- [Source: src/types/caller-identity.ts — CallerIdentity type with source: "system"]
- [Source: src/server/inngest/client.ts — Existing Inngest client]
- [Source: src/app/api/inngest/route.ts — Existing Inngest serve handler]
- [Source: src/server/db/client.ts — PrismaClient singleton for Inngest function DB access]
- [Source: src/server/db/tenant-client.ts — withTenantTransaction for RLS context]
- [Source: docker-compose.yml — Azurite service already configured]
- [Source: .env.example — Azure and Inngest env vars already present]
- [Source: node_modules/next-safe-action/dist/index.types — .metadata() method and MiddlewareFn type showing metadata parameter]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

### Completion Notes List

- ✅ Task 0: Retro gate check passed. Item #4 (Sentry) addressed by Task 4, item #6 (action labels) addressed by Task 5. No items past deferral deadline.
- ✅ Task 1: Test baseline captured. 394 tests/31 files/115.90s local, 4 E2E/11.7s, CI pipeline ~6m04s. Warning threshold: 2x current baseline. Documented in docs/test-performance-baseline.md.

### File List

- `docs/test-performance-baseline.md` (new)
