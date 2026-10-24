import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => "/documents",
  useSearchParams: () => nav.params,
}));

import { useNewParam } from "./use-new-param";

describe("useNewParam — + New opens the page's dialog (F73)", () => {
  beforeEach(() => {
    nav.replace.mockReset();
    nav.params = new URLSearchParams();
  });
  afterEach(cleanup);

  it("opens when the URL carries ?new=1", () => {
    nav.params = new URLSearchParams("new=1");
    const { result } = renderHook(() => useNewParam());
    expect(result.current[0]).toBe(true);
  });

  it("stays closed without the param, and when the caller may not create", () => {
    expect(renderHook(() => useNewParam()).result.current[0]).toBe(false);
    nav.params = new URLSearchParams("new=1");
    expect(renderHook(() => useNewParam(false)).result.current[0]).toBe(false);
  });

  it("closing drops only the param, keeping the page's own query", () => {
    nav.params = new URLSearchParams("q=rent&new=1&page=2");
    const { result } = renderHook(() => useNewParam());
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(nav.replace).toHaveBeenCalledWith("/documents?q=rent&page=2", { scroll: false });
  });

  it("closing a dialog opened by its button leaves the URL alone", () => {
    const { result } = renderHook(() => useNewParam());
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("+ New on the same page (params change while mounted) opens it", () => {
    const { result, rerender } = renderHook(() => useNewParam());
    expect(result.current[0]).toBe(false);
    nav.params = new URLSearchParams("new=1");
    rerender();
    expect(result.current[0]).toBe(true);
  });
});
