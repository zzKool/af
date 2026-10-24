import { describe, expect, it } from "vitest";
import { mapInOrder } from "@/kernel/db/tenant-client";

// F53: on one transaction client the queries go one after the other — mapInOrder is the list form.
describe("mapInOrder", () => {
  it("starts an item only once the previous one is done, and keeps the order", async () => {
    let running = 0;
    let maxRunning = 0;
    const started: number[] = [];
    const out = await mapInOrder([30, 10, 20], async (ms, i) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      started.push(i);
      await new Promise((ok) => setTimeout(ok, ms));
      running--;
      return ms * 2;
    });
    expect(maxRunning).toBe(1);
    expect(started).toEqual([0, 1, 2]);
    expect(out).toEqual([60, 20, 40]);
  });

  it("stops at the first rejection, like the awaits it replaces", async () => {
    const seen: number[] = [];
    await expect(
      mapInOrder([1, 2, 3], async (n) => {
        seen.push(n);
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
    expect(seen).toEqual([1, 2]);
  });

  it("returns [] for no items", async () => {
    expect(await mapInOrder([], async () => 1)).toEqual([]);
  });
});
