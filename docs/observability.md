# Observability

AF uses three distinct observability systems, each serving a different purpose with independent storage and retention.

## Three-System Design

| System | Purpose | Storage | Retention | When to Use |
|--------|---------|---------|-----------|-------------|
| [[audit-trail]] | Legal business record — who did what | PostgreSQL `audit_logs` (immutable) | Permanent | Every business mutation (via `audit.log()`) |
| **Application logging** | Operational telemetry — request flow, timing | Pino → stdout → Azure Log Analytics | 30-90 days | Every request, business events, warnings |
| **Error reporting** | Exceptions with a reference | pino (the app log) | 0 | Unexpected crashes only (F111) |

These systems are **architecturally independent** — never conflate them.

## Application Logging (Pino)

### Configuration

The logger singleton lives at `src/kernel/logging/logger.ts`. It uses Pino 10 with structured JSON output.

- **Production:** JSON to stdout, collected by Azure Log Analytics automatically in Container Apps
- **Development:** Pretty-printed via `pino-pretty`
- **Log level:** Controlled by `LOG_LEVEL` env var, defaults to `"info"` in production and `"debug"` in development

### Log Level Conventions

| Level | Pino Value | When to Use |
|-------|-----------|-------------|
| `error` | 50 | Unhandled exceptions, crashes caught by error boundaries |
| `warn` | 40 | Recoverable issues: unknown roles, stale cache, degraded services |
| `info` | 30 | Business events: action invoked, entity CRUD, login/logout |
| `debug` | 20 | Development detail: SQL queries, middleware chain, cache hits/misses |

### Structured Fields

Every business log entry from a Server Action includes:

```json
{
  "tenantId": "uuid",
  "userId": "uuid",
  "requestId": "uuid",
  "action": "createPartner",
  "service": "af",
  "environment": "production"
}
```

The `action` field contains the specific action name from `.metadata({ name })` defined on each Server Action (e.g., `"createPartner"`, `"updateSettings"`, `"getDashboardData"`). Falls back to `"unknown"` if metadata is missing.

Additional fields like `entityType` and `entityId` should be added by service code when logging entity-specific operations.

### Request-Scoped Logging

The logging middleware (`src/kernel/actions/logging.ts`) runs in the Server Action chain after authentication:

```
auth → rateLimit → logging → tenant → audit → handler
```

It creates a child Pino logger with `{ userId, tenantId, requestId }` bindings and injects it as `ctx.log`. All downstream middleware and handlers can use `ctx.log` for request-scoped logging.

### Usage

```typescript
// In a Server Action handler:
ctx.log.info({ entityType: "JournalEntry", entityId: id }, "Entry created");

// In a service (use base logger):
import { logger } from "@/server/logger";
logger.warn({ component: "ecb-rates" }, "Rate fetch degraded");
```

### Anti-Patterns

- Never use `console.log/error/warn` in `src/kernel/` or module services — always use Pino
- Never log sensitive data (passwords, tokens, PII)
- Never log `Prisma.Decimal` objects directly — convert to string first
- Never create per-request Pino instances — use `logger.child()`
- Never import Pino in `src/components/` — logging is server-side only
- Never log at `info` level in tight loops — use `debug`

## Azure Log Analytics

In Azure Container Apps, stdout is automatically collected by Azure Log Analytics. No sidecar or agent configuration is needed.

See [[deployment]] for Azure Container Apps setup.

## Error reporting — one log line with a reference (F111; Sentry removed 2026-10-27)

Sentry left with F111 (audit 2026-10-27 D13): it was off on the box by D51, yet 57 MB in the image and wrapping the build. Unexpected errors are now **one structured pino line** with a fresh 8-character **reference** — the "Reference: …" the user sees — found with `docker compose -f docker-compose.prod.yml logs app | grep <reference>`. Nothing leaves the box.

### What gets reported

- **Unexpected crashes in a Server Action** (non-`ActionError` exceptions) — with the reference returned to the user
- **Failed job attempts** (pg-boss) — every attempt that throws, before pg-boss retries it; the terminal failure also lands on the entity (F110, [[async-jobs]])
- **Render / route errors** — through `onRequestError` in `src/instrumentation.ts` (the route as the action, no user context there)

### Request context

Every report goes through one function, `reportError(error, context)` in `src/kernel/errors/report-error.ts`, which puts the context **on the line itself** — never on a shared scope, so two concurrent requests cannot lend each other their user or tenant.

```
Server Action                                   Job attempt (src/kernel/jobs/run-reported.ts)
auth ──► userId, tenantId ─┐                    pg-boss ──► job, jobId, attempt
logging ──► requestId, log ┤                    payload ──► tenantId (when it carries one)
throw ─► handleServerError(error, { ctx, metadata })      throw ─► reportError ─► rethrow (retry)
             └─► reportError: { err, reference, userId, tenantId, requestId, action }
                 ctx.log.error({ err, reference, action })  ← the same requestId in pino
```

What the chain had not reached is left out (a crash before auth has no user). The reference and the request's pino lines share the `requestId`, so a user's "Reference: …" leads to the log lines of that request.

### What Does NOT Get Reported

- **ActionErrors** (business errors) — `FORBIDDEN`, `VALIDATION_ERROR`, `UNAUTHORIZED`, etc.
- These are intentional flow control, not bugs

### User Support Integration

When an unexpected error occurs, the error response includes the reference:
`"An unexpected error occurred. Reference: 3f9a1c2e"`

The owner quotes it; `grep` on the app log finds the line, with the request id, the action, the user and the tenant beside the stack.

## Related

- [[audit-trail]] — Immutable business audit log (PostgreSQL)
- [[server-actions]] — Middleware chain and error handling
- [[error-handling]] — Error taxonomy and ActionError pattern
- [[clock-and-rates]] — Clock abstraction and ECB rate storage
