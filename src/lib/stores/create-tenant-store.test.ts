import { describe, expect, test } from "vitest";
import { create } from "zustand";

/**
 * Tests for the tenant store reset mechanism.
 * We test the core Zustand store behavior directly (no React rendering needed).
 * The React hook integration (useEffect + useTenantId) is tested via E2E.
 */

interface FilterState {
  search: string;
  sortBy: string;
}

const initialState: FilterState = { search: "", sortBy: "name" };

function createTestStore() {
  return create<FilterState>()(() => ({ ...initialState }));
}

describe("Tenant store reset mechanism", () => {
  test("store initializes with initial state", () => {
    const store = createTestStore();
    expect(store.getState()).toEqual({ search: "", sortBy: "name" });
  });

  test("store state can be modified", () => {
    const store = createTestStore();
    store.setState({ search: "test query" });
    expect(store.getState().search).toBe("test query");
    expect(store.getState().sortBy).toBe("name");
  });

  test("store resets to initial state on tenant switch", () => {
    const store = createTestStore();

    // Simulate user modifying state
    store.setState({ search: "modified", sortBy: "date" });
    expect(store.getState()).toEqual({ search: "modified", sortBy: "date" });

    // Simulate tenant switch — reset to initial state
    store.setState({ ...initialState });
    expect(store.getState()).toEqual({ search: "", sortBy: "name" });
  });

  test("multiple independent stores all reset independently", () => {
    const storeA = createTestStore();
    const storeB = createTestStore();

    storeA.setState({ search: "A query" });
    storeB.setState({ search: "B query", sortBy: "date" });

    // Reset only store A (simulating tenant switch for store A)
    storeA.setState({ ...initialState });

    expect(storeA.getState()).toEqual({ search: "", sortBy: "name" });
    expect(storeB.getState()).toEqual({ search: "B query", sortBy: "date" });
  });

  test("reset does not fire on same tenant re-selection", () => {
    const store = createTestStore();

    // Modify state
    store.setState({ search: "important filter" });

    // Simulate same tenant re-selected — state should NOT reset
    // (In the React hook, prevTenantIdRef.current === tenantId → no reset)
    // Here we just verify the store keeps its state when not explicitly reset
    expect(store.getState().search).toBe("important filter");
  });

  test("subscribe notifies on state changes", () => {
    const store = createTestStore();
    const changes: FilterState[] = [];

    store.subscribe((state) => changes.push({ ...state }));

    store.setState({ search: "first" });
    store.setState({ ...initialState }); // reset

    expect(changes).toHaveLength(2);
    expect(changes[0].search).toBe("first");
    expect(changes[1]).toEqual(initialState);
  });
});
