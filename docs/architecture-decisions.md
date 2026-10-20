# Architecture Decisions

## AD: Post-Commit Side-Effect Pattern

**Status:** Adopted (Story 6.0)

### Problem

The tenant middleware (`src/kernel/actions/tenant.ts`) wraps the entire Server Action handler inside `withTenantTransaction`. This means external calls — HTTP requests, blob storage operations, event dispatching — execute **inside** the database transaction. This causes:

1. **Transaction timeout risk** — external HTTP calls can take seconds, holding the DB connection
2. **Connection pool starvation** — long-running transactions exhaust the pool
3. **Side effects before commit** — if the transaction rolls back, the side effect (e.g., Inngest event, blob deletion) has already fired

### Solution

Actions register side-effect callbacks via `ctx.onCommit()`. Callbacks execute sequentially **after** the DB transaction commits successfully.

```typescript
// In the action handler:
ctx.onCommit(async () => {
  await inngest.send({ name: "document/uploaded", data: { ... } });
});
```

### How It Works

- `onCommit` is a **non-optional** property in the middleware context type — always present, discoverable via autocomplete
- The `postCommitCallbacks` array is **per-request scoped** (created inside the middleware function, not at module level) — concurrent requests cannot leak callbacks
- Callbacks run **sequentially** after `withTenantTransaction` resolves
- If a callback **fails**, it is logged at `warn` level but does **not** throw — the DB state is already committed
- If the transaction **rolls back** (handler throws), callbacks are never executed

### Examples

**Story 5.1 retrofit — Inngest event dispatch (document upload):**
```typescript
ctx.onCommit(async () => {
  await inngest.send({
    id: `doc-uploaded-${documentId}`,
    name: "document/uploaded",
    data: { tenantId, userId, documentId },
  });
});
```

**Story 5.5 retrofit — Blob deletion (document delete):**
```typescript
ctx.onCommit(async () => {
  const blobPath = extractBlobPath(blobUrl);
  await getStorage().deleteBlob(blobPath);
});
```

### Rules

- **ALL external HTTP calls, blob operations, and event dispatches MUST use `onCommit`**, never inline in the action handler
- **When NOT to use:** pure DB operations within the same transaction (they belong inside the transaction)

### Constraints & Limitations

- `onCommit` is scoped to the **outermost** tenant transaction (the one in `tenantMiddleware`). No nested transaction support.
- If a future service opens its own transaction, callbacks still fire after the middleware-level transaction, not the inner one.
- Callbacks are fire-and-forget — orphaned side-effects (e.g., unsent Inngest event) must be recovered via admin tooling or retry mechanisms.
