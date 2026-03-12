import { useEffect, useRef } from "react";
import { create, type StoreApi } from "zustand";
import { useTenantId } from "./use-tenant-id";

/**
 * Factory that creates a Zustand store scoped to the active tenant.
 * When the tenant changes, the store resets to its initial state.
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

  function useTenantAwareStore<U>(selector: (state: T) => U): U {
    const tenantId = useTenantId();
    const prevTenantIdRef = useRef<string | null>(null);

    useEffect(() => {
      if (prevTenantIdRef.current === null) {
        // First mount — just record the tenant, don't reset
        prevTenantIdRef.current = tenantId;
        return;
      }
      if (tenantId !== null && tenantId !== prevTenantIdRef.current) {
        store.setState({ ...initialState });
      }
      prevTenantIdRef.current = tenantId;
    }, [tenantId]);

    return store(selector);
  }

  // Expose the raw store for testing
  useTenantAwareStore.store = store as StoreApi<T>;

  return useTenantAwareStore;
}
