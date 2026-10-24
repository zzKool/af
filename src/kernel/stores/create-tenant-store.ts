import { useEffect } from "react";
import { create, type StoreApi } from "zustand";
import { useTenantId } from "@/kernel/stores/use-tenant-id";

/**
 * Creates a tenant-change tracker. Returns a function that determines whether
 * the store should reset based on the current tenant ID.
 *
 * Pure logic — no React dependency. Independently testable.
 */
export function createTenantTracker() {
  let prevTenantId: string | null = null;
  let initialized = false;

  return function shouldReset(tenantId: string | null): boolean {
    if (!initialized) {
      prevTenantId = tenantId;
      initialized = true;
      return false;
    }
    if (tenantId !== null && tenantId !== prevTenantId) {
      prevTenantId = tenantId;
      return true;
    }
    return false;
  };
}

/**
 * Factory that creates a Zustand store scoped to the active tenant.
 * When the tenant changes, the store resets to its initial state.
 *
 * The reset is tracked per-store (not per-component), so multiple components
 * sharing the same store only trigger one reset on tenant switch.
 *
 * Usage:
 * ```ts
 * const useCategoryFilter = createTenantStore({ search: "", sortBy: "name" });
 *
 * function Component() {
 *   const { search, setSearch } = useCategoryFilter((s) => s);
 * }
 * ```
 */
export function createTenantStore<T extends Record<string, unknown>>(initialState: T) {
  const store = create<T>()(() => ({ ...initialState }));
  const shouldReset = createTenantTracker();

  // biome-ignore lint/correctness/noComponentHookFactories: a store factory, called once at module scope like zustand's create — the hook's identity is stable
  function useTenantAwareStore<U>(selector: (state: T) => U): U {
    const tenantId = useTenantId();

    useEffect(() => {
      if (shouldReset(tenantId)) {
        store.setState({ ...initialState });
      }
    }, [tenantId]);

    return store(selector);
  }

  // Expose the raw store for testing
  useTenantAwareStore.store = store as StoreApi<T>;

  return useTenantAwareStore;
}
