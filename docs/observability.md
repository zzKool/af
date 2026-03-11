# Observability

DefterFab uses three distinct observability systems, each serving a different purpose with independent storage and retention.

## Three-System Design

| System | Purpose | Storage | Retention | When to Use |
|--------|---------|---------|-----------|-------------|
| [[audit-trail]] | Legal business record — who did what | PostgreSQL `audit_logs` (immutable) | Permanent | Every business mutation (via `audit.log()`) |
| **Application logging** | Operational telemetry — request flow, timing | Pino → stdout → Azure Log Analytics | 30-90 days | Every request, business events, warnings |
| **Error tracking** | Exceptions, stack traces, breadcrumbs | Sentry (deferred) | Per plan | Unexpected crashes only |

These systems are **architecturally independent** — never conflate them.

## Application Logging (Pino)

### Configuration

The logger singleton lives at `src/server/logger.ts`. It uses Pino 10 with structured JSON output.

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
  "action": "server_action",
  "service": "defterfab",
  "environment": "production"
}
```

Additional fields like `entityType` and `entityId` should be added by service code when logging entity-specific operations.

### Request-Scoped Logging

The logging middleware (`src/server/middleware/logging.ts`) runs in the Server Action chain after authentication:

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

- Never use `console.log/error/warn` in `src/server/` — always use Pino
- Never log sensitive data (passwords, tokens, PII)
- Never log `Prisma.Decimal` objects directly — convert to string first
- Never create per-request Pino instances — use `logger.child()`
- Never import Pino in `src/components/` — logging is server-side only
- Never log at `info` level in tight loops — use `debug`

## Azure Log Analytics

In Azure Container Apps, stdout is automatically collected by Azure Log Analytics. No sidecar or agent configuration is needed.

See [[deployment]] for Azure Container Apps setup.

## Error Tracking (Sentry) — Deferred

Sentry integration is deferred to a follow-up story. The `@sentry/nextjs` compatibility with Next.js 16.1/Turbopack needs confirmation first. When added:

- Only unexpected errors (non-`ActionError`) will be sent to Sentry
- Business errors (`ActionError`) are expected flow and must never reach Sentry
- See [[error-handling]] for the error classification boundary

## Related

- [[audit-trail]] — Immutable business audit log (PostgreSQL)
- [[server-actions]] — Middleware chain and error handling
- [[error-handling]] — Error taxonomy and ActionError pattern
- [[clock-and-rates]] — Clock abstraction and ECB rate storage
