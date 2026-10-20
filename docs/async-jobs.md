# Async Jobs (Inngest)

Inngest provides async job infrastructure for background processing (OCR, notifications, etc.).

## Architecture

- **Inngest HTTP callbacks** run within the same Next.js process (no separate worker)
- **Events dispatched** via `inngest.send({ name: "...", data: { ... } })`
- **Functions run OUTSIDE the middleware chain** — no auth, rateLimit, tenant middleware
- **`withInngestContext`** provides the equivalent: RLS transaction + CallerIdentity + AuditLogger
- **Retry:** 3x with exponential backoff (configurable per function)

## Existing Setup

- `src/kernel/jobs/client.ts` — Inngest client with id `"defterfab"`
- `src/app/api/inngest/route.ts` — serve handler, registers all functions
- Package: `inngest@^3.52.6` (already installed)

## Creating Inngest Functions

```typescript
// src/kernel/jobs/functions/my-function.ts
import { inngest } from "../client";
import { withInngestContext } from "../context";

export const myFunction = inngest.createFunction(
  { id: "my-function", retries: 3 },
  { event: "my-domain/event-name" },
  async ({ event, step }) => {
    const { tenantId, userId } = event.data;

    const result = await step.run("step-name", async () => {
      return withInngestContext(tenantId, userId, async (tx, caller, audit) => {
        // tx: RLS-scoped Prisma transaction client
        // caller: CallerIdentity with source: "system"
        // audit: AuditLogger for recording mutations
        const data = await tx.someModel.findMany();
        await audit.log({
          action: "update",
          entityType: "SomeModel",
          entityId: "...",
          oldData: null,
          newData: { ... },
        });
        return data;
      });
    });

    return result;
  },
);
```

Then register in `src/app/api/inngest/route.ts`:

```typescript
import { myFunction } from "@/server/inngest/functions/my-function";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processDocument, myFunction],
});
```

## `withInngestContext` Usage

The context helper mirrors the `auditMiddleware` pattern from `action-client.ts`:

```typescript
import { withInngestContext } from "@/server/inngest/context";

await withInngestContext(tenantId, userId, async (tx, caller, audit) => {
  // tx: Prisma TransactionClient with RLS (SET LOCAL app.tenant_id)
  // caller: { userId, tenantId, role: "owner", source: "system" }
  // audit: { log: (params) => createAuditEntry(tx, caller, params) }
});
```

**Key difference from Server Actions:** `caller.source` is always `"system"` for Inngest functions. The `userId` is the original user who triggered the action (passed via event data), NOT a system account.

## `createSystemCaller` Usage

For cases where you need a CallerIdentity without the full context wrapper:

```typescript
import { createSystemCaller } from "@/server/inngest/context";

const caller = createSystemCaller(tenantId, userId);
// { userId, tenantId, role: "owner", source: "system" }
```

## Dispatching Events

```typescript
import { inngest } from "@/server/inngest/client";

await inngest.send({
  name: "document/uploaded",
  data: {
    tenantId: caller.tenantId,
    userId: caller.userId,
    documentId: "...",
  },
});
```

**Always include `tenantId` and `userId`** in event data — Inngest functions need these to set up RLS context and CallerIdentity.

## Running Locally

```bash
# Start Inngest Dev Server (dashboard at http://localhost:8288)
npm run inngest:dev

# Start Next.js dev server (Inngest discovers functions via /api/inngest)
npm run dev
```

The Inngest Dev Server automatically discovers registered functions via the Next.js serve endpoint.

## Retry Configuration

```typescript
inngest.createFunction(
  { id: "my-function", retries: 3 }, // 3 retries with exponential backoff
  { event: "..." },
  async ({ event, step }) => { ... },
);
```

- Transient failures (thrown errors) trigger retries
- Database transactions roll back on function failure (no partial writes)
- After max retries, the event goes to dead letter

## Test Patterns

**Unit tests:** Call the function handler directly with mocked `step` and `event`:

```typescript
// Mock step.run to just execute the callback
const mockStep = { run: async (name, fn) => fn() };
const mockEvent = { data: { tenantId: "...", userId: "..." } };
await processDocument.handler({ event: mockEvent, step: mockStep });
```

**Integration tests:** Use Inngest Dev Server — send events via the dashboard UI and verify function execution.

## Security: Signing Key

**Current state (spike):** The Inngest serve route (`/api/inngest`) has NO signing verification. `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` are empty.

**Production requirement (Story 5.1+):** Configure `INNGEST_SIGNING_KEY` to verify that event callbacks originate from Inngest, not arbitrary HTTP requests. Without signing, any HTTP client can trigger function execution by POSTing to `/api/inngest`.

See deferred items register for tracking.
