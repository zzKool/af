// The inbox's undo stack (FR-020): the last in comes out first, at most INBOX_UNDO_MAX are kept — the oldest go.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { INBOX_UNDO_MAX, useInboxUndo } from "./use-inbox-undo";

describe("useInboxUndo", () => {
  it("pops the last entry first, then nothing", () => {
    const { result } = renderHook(() => useInboxUndo());
    expect(result.current.last).toBeUndefined();
    act(() => result.current.push({ kind: "archive", ids: ["a"] }));
    act(() => result.current.push({ kind: "restore", ids: ["b", "c"] }));
    expect(result.current.last).toEqual({ kind: "restore", ids: ["b", "c"] });
    let popped: ReturnType<typeof result.current.pop>;
    act(() => {
      popped = result.current.pop();
    });
    expect(popped).toEqual({ kind: "restore", ids: ["b", "c"] });
    act(() => {
      popped = result.current.pop();
    });
    expect(popped).toEqual({ kind: "archive", ids: ["a"] });
    act(() => {
      popped = result.current.pop();
    });
    expect(popped).toBeUndefined();
  });

  it(`keeps the newest ${INBOX_UNDO_MAX}: the oldest falls off`, () => {
    const { result } = renderHook(() => useInboxUndo());
    for (let i = 0; i <= INBOX_UNDO_MAX; i++)
      act(() => result.current.push({ kind: "archive", ids: [`d${i}`] }));
    const out: string[] = [];
    for (let i = 0; i <= INBOX_UNDO_MAX; i++)
      act(() => {
        const e = result.current.pop();
        if (e) out.push(e.ids[0] as string);
      });
    expect(out).toHaveLength(INBOX_UNDO_MAX);
    expect(out[0]).toBe(`d${INBOX_UNDO_MAX}`);
    expect(out.at(-1)).toBe("d1"); // d0 was the 21st back
  });
});
