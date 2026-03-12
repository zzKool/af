# Zustand Store Pattern

## Overview

Client-side state management uses [Zustand](https://zustand.docs.pmnd.rs/) v5.
Stores are **session-only** (lost on page refresh) and hold UI-layer state such as filter values, sort order, sidebar collapse state, and selected items.

## Tenant-Scoped Stores

All stores in DefterFab must reset when the user switches tenants to prevent cross-tenant state leakage. Use the `createTenantStore` factory for this.

### How It Works

1. `useTenantId()` hook exposes the current `activeOrganizationId` from Better Auth's session
2. `createTenantStore(initialState)` creates a Zustand store that auto-resets when the tenant changes
3. Each store is independent — no central registry, no coupling between stores

### Creating a Store

```typescript
// src/lib/stores/category-filter-store.ts
import { createTenantStore } from "./create-tenant-store";

export const useCategoryFilter = createTenantStore({
  search: "",
  sortBy: "name" as "name" | "code",
  showArchived: false,
});
```

### Using a Store in Components

```tsx
import { useCategoryFilter } from "@/lib/stores/category-filter-store";

function CategoryList() {
  const search = useCategoryFilter((s) => s.search);
  const sortBy = useCategoryFilter((s) => s.sortBy);

  return (
    <div>
      <input
        value={search}
        onChange={(e) =>
          useCategoryFilter.store.setState({ search: e.target.value })
        }
      />
      {/* ... */}
    </div>
  );
}
```

### Updating State

Use `store.setState()` for updates:

```typescript
// Partial update (merges with current state)
useCategoryFilter.store.setState({ search: "new query" });

// Replace entire state
useCategoryFilter.store.setState({ search: "", sortBy: "name", showArchived: false });
```

## What NOT to Store in Zustand

- Server data (use React Query / server actions instead)
- Authentication state (managed by Better Auth)
- Data that must survive page refresh (use localStorage or server-side)

## Testing

The raw Zustand store is accessible via `.store` for testing:

```typescript
const store = useCategoryFilter.store;
store.setState({ search: "test" });
expect(store.getState().search).toBe("test");
```

See `src/lib/stores/create-tenant-store.test.ts` for test examples.
