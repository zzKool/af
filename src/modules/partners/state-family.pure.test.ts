import { describe, expect, it } from "vitest";
import { STATE_FAMILIES } from "@/kernel/ui/state-label";
import { PARTNER_STATE_FAMILY, partnerState, partnerStateFamily } from "./state-family";

// F71: the list, the partner page's title row and its About section show the partner's derived state as a D40
// family, through one map.
describe("partners state → family", () => {
  it("derives the state from the flag, never from a typed status", () => {
    expect(partnerState(true)).toBe("active");
    expect(partnerState(false)).toBe("inactive");
  });

  it("an active partner is done, a deactivated one neutral — and only those two states exist", () => {
    expect(PARTNER_STATE_FAMILY).toEqual({ active: "done", inactive: "neutral" });
    expect(partnerStateFamily(partnerState(true))).toBe("done");
    expect(partnerStateFamily(partnerState(false))).toBe("neutral");
  });

  it("maps to kit families only — no attention: nothing is waiting on a partner", () => {
    for (const f of Object.values(PARTNER_STATE_FAMILY)) {
      expect((STATE_FAMILIES as readonly string[]).includes(f)).toBe(true);
      expect(f).not.toBe("attention");
    }
  });
});
