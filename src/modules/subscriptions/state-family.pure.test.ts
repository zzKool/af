import { describe, expect, it } from "vitest";
import { STATE_FAMILIES } from "@/kernel/ui/state-label";
import { periodStateFamily } from "./state-family";
import { PERIOD_STATES } from "./types";

describe("periodStateFamily", () => {
  it("maps every state to a D40 family; only due asks for attention; only done is done", () => {
    for (const s of PERIOD_STATES) expect(STATE_FAMILIES).toContain(periodStateFamily(s));
    expect(PERIOD_STATES.filter((s) => periodStateFamily(s) === "attention")).toEqual(["due"]);
    expect(PERIOD_STATES.filter((s) => periodStateFamily(s) === "done")).toEqual(["done"]);
  });
});
