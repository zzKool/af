# Story 2.4: Observability & Error Tracking

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want structured logging and error tracking with request-scoped context,
so that I can diagnose issues quickly with full tenant and user context in every log entry.

## Acceptance Criteria

1. **Given** the Server Action pipeline and audit trail exist from previous stories
   **When** the application processes requests or encounters errors
   **Then** Pino 10 is configured for structured JSON logging with log levels: error, warn, info, debug

2. **And** request-scoped logging context is injected at middleware level: tenantId, userId, requestId on every log entry

3. **And** Sentry integration is DEFERRED to a follow-up story — the three observability systems are architecturally independent, and Pino logging delivers the core value. Sentry will be added once `@sentry/nextjs` compatibility with Next.js 16.1/Turbopack is confirmed.

4. **And** the observability systems are distinct by design:
   - **Audit trail:** PostgreSQL (permanent, immutable) — already exists from Story 2.1
   - **Application logging:** Pino → stdout → Azure Log Analytics (30-90 days retention) — THIS STORY
   - **Error tracking:** Sentry (deferred — follow-up story)

5. **And** log level conventions follow the architecture doc: error for unhandled exceptions, warn for recoverable issues, info for business events, debug for development detail

6. **And** structured fields `{ tenantId, userId, action, entityType, entityId }` are present on every business log entry

7. **And** `docs/` is updated with Obsidian-style `[[wiki-links]]` documenting any new concepts, patterns, or configurations introduced in this story

## Tasks / Subtasks

- [x] Task 1: Create Pino logger singleton and configuration (AC: #1, #5)
  - [x] 1.1 Install `pino-pretty` as a devDependency (`npm install -D pino-pretty`) — NOT installed yet
  - [x] 1.2 Create `src/server/logger.ts` — Pino 10 singleton with structured JSON output, log levels (error, warn, info, debug), and `LOG_LEVEL` env var defaulting to `"info"` in production and `"debug"` in development
  - [x] 1.3 Configure Pino transport: JSON to stdout (no pretty-print in production). Use `pino-pretty` only in development via conditional transport config
  - [x] 1.4 Add base context fields: `{ service: "defterfab", version: process.env.npm_package_version || "unknown", environment: process.env.NODE_ENV }`
  - [x] 1.5 Export `logger` instance directly — callers use `logger.child({ ... })` for request-scoped loggers. Do NOT create a `createChildLogger` wrapper — it's abstraction over a one-liner
  - [x] 1.6 Verify `pino` and `pino-http` are already in `serverExternalPackages` in `next.config.ts` (they are — no change needed)

- [x] Task 2: Create request-scoped logging context middleware (AC: #2, #6)
  - [x] 2.1 Create `src/server/middleware/logging.ts` — a `next-safe-action` middleware that creates a child logger with `{ tenantId, userId, requestId }` bindings
  - [x] 2.2 Generate `requestId` using `crypto.randomUUID()` — one per Server Action invocation
  - [x] 2.3 Inject `log` (child Pino logger) into middleware context so all downstream middleware and handlers have access
  - [x] 2.4 Add `loggingMiddleware` to the action chain in `action-client.ts` — insert AFTER `authMiddleware` (needs userId) but BEFORE `tenantMiddleware`. For tenantId, use the raw `ctx.tenantId` from auth context (available before tenant validation)
  - [x] 2.5 Log at info level on every action entry: `log.info({ action: "server_action" }, "Action invoked")`
  - [x] 2.6 Update `tenantMiddleware` type signature to include `log: pino.Logger` as a required field (not optional — middleware chain is deterministic, logging always runs before tenant)

- [x] Task 3: Replace console statements with Pino (AC: #1, #5)
  - [x] 3.1 In `action-client.ts` `handleServerError`: replace `console.error("Server Action error:", error)` with `logger.error({ err: error }, "Unhandled Server Action error")` — use the base logger here since request context isn't available in the error handler
  - [x] 3.2 In `tenant.ts`: replace `console.warn(...)` for unknown roles with `ctx.log.warn({ role: member.role, userId }, "Unknown Better Auth role")` — use the request-scoped logger from context
  - [x] 3.3 Verify no other `console.*` statements exist in `src/server/` (excluding test files). Confirmed: only the two above exist
  - [x] 3.4 Consider adding a Biome lint rule (`noConsole` or restricted globals) for `src/server/` to structurally prevent future `console.*` regressions — if available in Biome 2, add it; if not, add a comment in `biome.json` as a TODO

- [x] Task 4: Write unit tests for logger and middleware (AC: #1, #2, #5, #6)
  - [x] 4.1 Create `src/server/logger.test.ts` — test that logger produces structured JSON with expected fields (`level`, `time`, `msg`, `service`, `environment`), test child logger inherits base bindings, test log level filtering
  - [x] 4.2 Create `src/server/middleware/logging.test.ts` — test that logging middleware injects `log` into context with `tenantId`, `userId`, `requestId` bindings, test requestId is a valid UUID
  - [x] 4.3 Update `action-client.test.ts` — add logging middleware to the chain setup so existing tests pass with new middleware order
  - [x] 4.4 Update `tenant.test.ts` — provide a Pino logger (real or child of test logger) in the mock context, since `tenantMiddleware` now requires `log: pino.Logger` in its input type. This file has 8 integration tests that will break without this update
  - [x] 4.5 Test error handler logging: verify `logger.error()` is called for non-ActionError exceptions, verify it is NOT called for ActionError (business errors are returned directly, not logged at error level)

- [x] Task 5: Build verification checkpoint
  - [x] 5.1 `npm run build` — verify build succeeds with Pino logger (no runtime errors, no import issues)
  - [x] 5.2 `npm run test` — all tests pass
  - [x] 5.3 `npx biome check --write` — lint clean

- [x] Task 6: Update documentation (AC: #7)
  - [x] 6.1 Create `docs/observability.md` with wiki-links — document the observability systems (logging now, Sentry deferred), log level conventions, structured field requirements. Reference [[audit-trail]], [[clock-and-rates]]
  - [x] 6.2 Update `docs/index.md` with link to new doc

- [x] Task 7: Final validation
  - [x] 7.1 `npm run test` — all tests pass (including new logger and middleware tests)
  - [x] 7.2 `npx biome check --write` — lint clean
  - [x] 7.3 `npm run build` — clean build

## Dev Notes

### Observability Architecture — Three Distinct Systems

**CRITICAL DESIGN DECISION:** The three observability systems are separate and serve different purposes. Never conflate them:

| System | Purpose | Storage | Retention | When to Use |
|--------|---------|---------|-----------|-------------|
| **Audit trail** | Legal business record — who did what | PostgreSQL `audit_logs` (immutable) | Permanent | Every business mutation (via `audit.log()`) |
| **Application logging** | Operational telemetry — request flow, timing | Pino → stdout → Azure Log Analytics | 30-90 days | Every request, business events, warnings |
| **Error tracking** | Exceptions, stack traces, breadcrumbs | Sentry (DEFERRED) | Per plan | Unexpected crashes only — follow-up story |

### Pino Logger Configuration

**File:** `src/server/logger.ts`

Pino 10 is already installed (`^10.3.1`) and listed in `serverExternalPackages` in `next.config.ts`. `pino-http` (`^11.0.0`) is also installed but this story uses Pino directly (not HTTP middleware) since logging happens inside Server Actions, not at the HTTP layer. Keep `pino-http` in deps — useful later for webhooks/Inngest handlers outside the Server Action pattern.

**Azure note:** stdout → Azure Log Analytics automatically in Container Apps. No sidecar needed. Document details in `docs/observability.md`.

```typescript
// Target API shape
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  base: { service: "defterfab", version: process.env.npm_package_version || "unknown" },
  // JSON output in production, pretty in dev
  ...(process.env.NODE_ENV !== "production" && {
    transport: { target: "pino-pretty" },
  }),
});

export { logger };
// Usage: logger.child({ tenantId, userId, requestId }) for request-scoped logging
```

**Log level conventions (from architecture doc):**
- `error` — Unhandled exceptions, crashes caught by error boundaries. Will also go to Sentry once integrated (follow-up story).
- `warn` — Recoverable issues: unknown roles, stale cache, degraded external services
- `info` — Business events: action invoked, entity created/updated/deleted, login/logout
- `debug` — Development detail: SQL queries, middleware chain progression, cache hits/misses

**Structured fields on every business log entry:**
```json
{ "tenantId": "uuid", "userId": "uuid", "requestId": "uuid", "action": "createJournalEntry", "entityType": "JournalEntry", "entityId": "uuid" }
```

### Request-Scoped Logging Middleware

**File:** `src/server/middleware/logging.ts`

Insert into the action chain AFTER `authMiddleware` (needs `userId` and `tenantId` from session) but BEFORE `tenantMiddleware` (so tenant validation failures are also logged with context).

**Updated middleware chain order:**
```
auth → rateLimit → logging → tenant → audit → handler
```

The logging middleware:
1. Generates a `requestId` via `crypto.randomUUID()`
2. Creates a child Pino logger with `{ userId, tenantId, requestId }` bindings
3. Injects `log` into context
4. Logs action entry at info level

**IMPORTANT:** The `tenantId` at this point is from the session (not yet validated). That's fine — it's for log correlation, not authorization. Tenant validation happens in `tenantMiddleware`.

### Sentry — OUT OF SCOPE

Deferred to follow-up story. No Sentry code, no `@sentry/nextjs`, no `withSentryConfig()` in this story.

### Action Chain Modification

**File:** `src/server/middleware/action-client.ts`

Current chain: `auth → rateLimit → tenant → audit`
New chain: `auth → rateLimit → logging → tenant → audit`

The `loggingMiddleware` needs `userId` and `tenantId` from `authMiddleware` context. It produces a `log` child logger in context. Downstream middleware (`tenantMiddleware`, `auditMiddleware`) and action handlers can use `ctx.log` for request-scoped logging.

**Type impact:** The `authedAction` context type gains a `log` field (Pino `Logger` instance). This is additive — no breaking changes to existing action handlers. Handlers CAN use `ctx.log` but are not required to.

**Downstream middleware type update:** `tenantMiddleware` must update its input type to include `log: pino.Logger` as a **required** field (not optional). The middleware chain is deterministic — `loggingMiddleware` always runs before `tenantMiddleware`. Making it optional would create a dead code path. Update tests to include logging middleware in the chain setup.

### Testing Approach

**Logger tests** (`src/server/logger.test.ts`):
- Unit tests only — no database needed
- Test in "server" Vitest project
- Use Pino's `{ write(msg: string) }` destination to capture JSON output — parse it, assert on fields (`level`, `time`, `msg`, `service`, `version`, `environment`)
- Verify child logger inherits base bindings and adds request bindings
- Verify log level filtering (debug suppressed when level is info)

**Logging middleware tests** (`src/server/middleware/logging.test.ts`):
- Unit tests — mock the next-safe-action middleware context
- Verify `requestId` is generated as valid UUID v4
- Verify child logger bindings include `userId`, `tenantId`, `requestId`

**Error handler logging test** (in `action-client.test.ts`):
- Verify `logger.error()` is called for non-ActionError exceptions (unexpected crashes)
- Verify `logger.error()` is NOT called for ActionError (business errors returned directly)
- This is the most important test — validates the error classification boundary

**Tenant middleware tests** (`src/server/middleware/tenant.test.ts`):
- 8 existing integration tests that mock the middleware context with `{ userId, tenantId }`
- ALL will break when `log: pino.Logger` becomes a required field in the input type
- Fix: create a test helper Pino logger (e.g., `pino({ level: "silent" })`) and include in mock context
- Verify CallerIdentity immutability, transaction client injection, and role matching still pass

**Existing test impact:**
- `action-client.test.ts` (145 lines) — must account for logging middleware in the chain
- `tenant.test.ts` (225 lines, 8 tests) — must provide `log` in mock context
- `auth.test.ts` — unaffected (logging middleware comes after auth, auth tests are isolated)
- Integration tests — logging middleware is transparent (just adds `log` to context)

### Dependencies from Previous Stories

- `ActionError` class from `src/server/middleware/errors.ts` (Story 1.4) — used to distinguish business vs unexpected errors
- `CallerIdentity` from `src/types/caller-identity.ts` (Story 1.4) — source field for log context
- `authMiddleware` provides `userId` and `tenantId` in context (Story 1.3)
- Audit trail (`src/server/services/audit.ts`) from Story 2.1 — separate system, not replaced by logging

### Anti-Patterns to Avoid

1. **Never use `console.log/error/warn`** in production server code — always use Pino logger
2. **Never send business errors (ActionError) to Sentry** — these are expected flow, not bugs
3. **Never log sensitive data** — no passwords, tokens, full request bodies with PII
4. **Never create per-request Pino instances** — use `logger.child()` for request-scoped bindings
5. **Never import Pino in `src/components/`** — logging is server-side only. Client errors go through error boundaries. Note: `error.tsx` (Story 2.5) is a Client Component and cannot use Pino directly — it will need a Server Action or API route to report errors server-side
6. **Never block the request on logging** — Pino is async by default, keep it that way
7. **Never mix audit trail and application logging** — audit is permanent legal record, logging is operational telemetry
8. **Never install `winston` or `bunyan`** — Pino is the project standard (architecture doc)
9. **Never log at `info` level in tight loops** — use `debug` for high-frequency events
10. **Never skip request context** — every log entry from a Server Action MUST have userId and tenantId for triage
11. **Never log `Prisma.Decimal` objects directly** — Pino serializes them as `{}`. Convert to string first: `amount.toString()`. This will bite you in future stories when logging currency operations

### Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `LOG_LEVEL` | No | `"info"` (prod) / `"debug"` (dev) | Pino log level threshold |

### Project Structure Notes

- Logger singleton: `src/server/logger.ts` (new)
- Logger tests: `src/server/logger.test.ts` (new)
- Logging middleware: `src/server/middleware/logging.ts` (new)
- Logging middleware tests: `src/server/middleware/logging.test.ts` (new)
- Action client: `src/server/middleware/action-client.ts` (modified — add logging middleware, replace console.error)
- Tenant middleware: `src/server/middleware/tenant.ts` (modified — update type signature, replace console.warn with ctx.log)
- Env example: `.env.example` (modified — add LOG_LEVEL)
- Documentation: `docs/observability.md` (new)
- Docs index: `docs/index.md` (modified)
- No changes to `next.config.ts` (Sentry deferred — no withSentryConfig wrapper)
- No changes to `src/components/` (no UI in this story)
- No changes to Prisma schema (no new tables)
- No changes to `src/lib/` (logging is server-side)

### Git Intelligence (from story 2.3)

**Commit pattern:** Small, focused commits per task with conventional prefix
- `feat:` for new files (logger, middleware)
- `fix:` for replacing console statements
- `test:` for test additions
- `docs:` for documentation
- `chore:` for config/status updates
- Always run `npx biome check --write` before committing

**Files from story 2.3 to be aware of:**
- `vitest.config.ts` — has "lib", "server", "client" test projects. Logger tests go in "server"
- `next.config.ts` — already has `serverExternalPackages: ["pino", "pino-http"]`
- `src/server/middleware/action-client.ts` — the main file being modified

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4] — AC and user story
- [Source: _bmad-output/planning-artifacts/architecture.md#Observability Architecture] — three-system design
- [Source: _bmad-output/planning-artifacts/architecture.md#Error Taxonomy] — error classification and handling
- [Source: _bmad-output/planning-artifacts/architecture.md#D4 Error Response Shape] — AppError type and error codes
- [Source: _bmad-output/planning-artifacts/architecture.md#Mandatory Server Action Pipeline] — middleware chain order
- [Source: _bmad-output/planning-artifacts/architecture.md#Testing Standards] — Vitest workspace config
- [Source: _bmad-output/implementation-artifacts/2-3-clock-abstraction-exchange-rate-storage.md] — commit patterns, testing approach
- [Source: src/server/middleware/action-client.ts] — current middleware chain and error handler
- [Source: src/server/middleware/tenant.ts] — console.warn to replace

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- vi.mock hoisting issue: Variables declared outside `vi.mock()` factory are not accessible due to hoisting. Fixed by using `vi.hoisted()` to declare mock variables.

### Completion Notes List

- Created Pino 10 logger singleton with structured JSON output, log levels, environment-aware transport (pino-pretty in dev, JSON in prod)
- Created request-scoped logging middleware injecting `{ userId, tenantId, requestId }` bindings via `logger.child()`
- Updated middleware chain: auth → rateLimit → logging → tenant → audit
- Replaced `console.error` in error handler with `logger.error` (base logger, no request context in error handler)
- Replaced `console.warn` in tenant middleware with `ctx.log.warn` (request-scoped logger)
- Updated `tenantMiddleware` type signature to require `log: pino.Logger`
- Biome `noConsole` lint rule not available for per-directory overrides in Biome 2 — convention documented in observability.md instead
- 135 tests pass across 14 test files, 0 regressions
- New tests: 4 logger tests, 3 logging middleware tests, 2 error handler logging tests

### Change Log

- 2026-03-11: Implemented story 2.4 — Pino structured logging with request-scoped context

### File List

- `src/server/logger.ts` (new) — Pino logger singleton
- `src/server/logger.test.ts` (new) — Logger unit tests (4 tests)
- `src/server/middleware/logging.ts` (new) — Request-scoped logging middleware
- `src/server/middleware/logging.test.ts` (new) — Logging middleware tests (3 tests)
- `src/server/middleware/action-client.ts` (modified) — Added loggingMiddleware to chain, replaced console.error with logger.error
- `src/server/middleware/action-client.test.ts` (modified) — Added logger mock and error handler logging tests (2 new tests)
- `src/server/middleware/tenant.ts` (modified) — Added `log: pino.Logger` to type, replaced console.warn with ctx.log.warn
- `src/server/middleware/tenant.test.ts` (modified) — Added silent Pino logger to mock context
- `.env.example` (modified) — Added LOG_LEVEL
- `docs/observability.md` (new) — Observability documentation with wiki-links
- `docs/index.md` (modified) — Added observability link
- `package.json` (modified) — Added pino-pretty devDependency
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified) — Story status updated
