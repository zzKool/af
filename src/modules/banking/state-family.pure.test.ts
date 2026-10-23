import { describe, expect, it } from "vitest";
import { STATE_FAMILIES } from "@/kernel/ui/state-label";
import { needsProof } from "./months";
import { TRANSACTION_STATE_FAMILY, transactionStateFamily } from "./state-family";
import { TRANSACTION_STATES } from "./types";

// The workbench shows a row's derived state as a D40 family; the label must say what the Months panel counts.
describe("banking state → family", () => {
  it("maps every derived state, and only those", () => {
    expect(Object.keys(TRANSACTION_STATE_FAMILY).sort()).toEqual([...TRANSACTION_STATES].sort());
    for (const s of TRANSACTION_STATES) expect(isKnownFamily(transactionStateFamily(s))).toBe(true);
  });

  it("the rows still needing proof are the attention / in-progress ones (the Months panel's 'to justify')", () => {
    for (const s of TRANSACTION_STATES) {
      const family = transactionStateFamily(s);
      expect(family === "attention" || family === "progress", s).toBe(needsProof(s));
    }
  });

  it("open asks for action, partial is under way, linked is done, no_document needs nothing", () => {
    expect(TRANSACTION_STATE_FAMILY).toEqual({
      open: "attention",
      partial: "progress",
      linked: "done",
      no_document: "neutral",
    });
  });
});

function isKnownFamily(f: string): boolean {
  return (STATE_FAMILIES as readonly string[]).includes(f);
}
