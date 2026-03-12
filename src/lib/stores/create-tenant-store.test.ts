import { describe, expect, test } from "vitest";
import { createTenantStore, createTenantTracker } from "./create-tenant-store";

interface FilterState {
  search: string;
  sortBy: string;
}

const initialState: FilterState = { search: "", sortBy: "name" };

describe("createTenantTracker", () => {
  test("first call records tenant and returns false (no reset)", () => {
    const shouldReset = createTenantTracker();
    expect(shouldReset("tenant-1")).toBe(false);
  });

  test("same tenant returns false (no reset)", () => {
    const shouldReset = createTenantTracker();
    shouldReset("tenant-1");
    expect(shouldReset("tenant-1")).toBe(false);
  });

  test("different tenant returns true (reset)", () => {
    const shouldReset = createTenantTracker();
    shouldReset("tenant-1");
    expect(shouldReset("tenant-2")).toBe(true);
  });

  test("null tenant never triggers reset", () => {
    const shouldReset = createTenantTracker();
    shouldReset("tenant-1");
    expect(shouldReset(null)).toBe(false);
  });

  test("null initial tenant then real tenant triggers reset (safe: store at initial state)", () => {
    const shouldReset = createTenantTracker();
    expect(shouldReset(null)).toBe(false);
    // null was stored as prev, so "tenant-1" !== null triggers reset
    // This is safe because the store hasn't been modified yet on first load
    expect(shouldReset("tenant-1")).toBe(true);
  });

  test("tracks across multiple switches", () => {
    const shouldReset = createTenantTracker();
    shouldReset("tenant-1"); // init
    expect(shouldReset("tenant-2")).toBe(true);
    expect(shouldReset("tenant-2")).toBe(false);
    expect(shouldReset("tenant-3")).toBe(true);
    expect(shouldReset("tenant-1")).toBe(true); // back to first
  });
});

describe("createTenantStore", () => {
  test("factory returns a hook function with .store property", () => {
    const useStore = createTenantStore(initialState);
    expect(typeof useStore).toBe("function");
    expect(useStore.store).toBeDefined();
    expect(useStore.store.getState).toBeDefined();
    expect(useStore.store.setState).toBeDefined();
  });

  test("store initializes with provided initial state", () => {
    const useStore = createTenantStore(initialState);
    expect(useStore.store.getState()).toEqual({ search: "", sortBy: "name" });
  });

  test("store state can be modified via .store.setState", () => {
    const useStore = createTenantStore(initialState);
    useStore.store.setState({ search: "test query" });
    expect(useStore.store.getState().search).toBe("test query");
    expect(useStore.store.getState().sortBy).toBe("name");
  });

  test("store resets to initial state via setState", () => {
    const useStore = createTenantStore(initialState);

    useStore.store.setState({ search: "modified", sortBy: "date" });
    expect(useStore.store.getState()).toEqual({ search: "modified", sortBy: "date" });

    useStore.store.setState({ ...initialState });
    expect(useStore.store.getState()).toEqual({ search: "", sortBy: "name" });
  });

  test("multiple stores from separate createTenantStore calls are independent", () => {
    const storeA = createTenantStore({ count: 0 });
    const storeB = createTenantStore({ count: 0 });

    storeA.store.setState({ count: 42 });
    expect(storeA.store.getState().count).toBe(42);
    expect(storeB.store.getState().count).toBe(0);
  });

  test("subscribe notifies on state changes including reset", () => {
    const useStore = createTenantStore(initialState);
    const changes: FilterState[] = [];

    useStore.store.subscribe((state) => changes.push({ ...state }));

    useStore.store.setState({ search: "first" });
    useStore.store.setState({ ...initialState });

    expect(changes).toHaveLength(2);
    expect(changes[0].search).toBe("first");
    expect(changes[1]).toEqual(initialState);
  });
});
