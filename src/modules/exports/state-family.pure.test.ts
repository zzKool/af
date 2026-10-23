import { describe, expect, it } from "vitest";
import { STATE_FAMILIES } from "@/kernel/ui/state-label";
import {
  DECLARATION_STATE_FAMILY,
  DECLARATION_STATES,
  declarationState,
  declarationStateFamily,
} from "./state-family";

// F71: the VAT return shows the quarter's declaration state as a D40 family, through one map.
describe("exports state → family", () => {
  it("maps every declaration state, and only those, to a kit family", () => {
    expect(Object.keys(DECLARATION_STATE_FAMILY).sort()).toEqual([...DECLARATION_STATES].sort());
    for (const s of DECLARATION_STATES) {
      expect((STATE_FAMILIES as readonly string[]).includes(declarationStateFamily(s))).toBe(true);
    }
  });

  it("the state is derived from the record's dates — no record or no date is a draft", () => {
    expect(declarationState(null)).toBe("draft");
    expect(declarationState({ declaredAt: null, paidAt: null })).toBe("draft");
    expect(declarationState({ declaredAt: "2026-07-20", paidAt: null })).toBe("declared");
    expect(declarationState({ declaredAt: "2026-07-20", paidAt: "2026-08-31" })).toBe("paid");
  });

  it("a draft is neutral, a declared quarter is under way (VAT owed), a paid one is done", () => {
    expect(DECLARATION_STATE_FAMILY).toEqual({
      draft: "neutral",
      declared: "progress",
      paid: "done",
    });
  });
});
