import { describe, expect, it } from "vitest";
import { STATE_FAMILIES } from "@/kernel/ui/state-label";
import { pickRate, rateState } from "./contract-rates";
import {
  CONTRACT_STATE_FAMILY,
  contractState,
  contractStateFamily,
  RATE_STATE_FAMILY,
  rateStateFamily,
} from "./state-family";
import type { RateState } from "./types";

const RATE_STATES: RateState[] = ["current", "future", "expired"];

// F71: the partner page shows a rate's and a contract's derived state as a D40 family, through one map.
describe("contracts state → family", () => {
  it("maps every rate state, and only those, to a kit family", () => {
    expect(Object.keys(RATE_STATE_FAMILY).sort()).toEqual([...RATE_STATES].sort());
    for (const s of RATE_STATES) expect(isKnownFamily(rateStateFamily(s))).toBe(true);
  });

  it("the rate an invoice dated today takes is the one shown done, and the only one", () => {
    const history = [
      { id: "r24", validFrom: "2024-01-01", validTo: "2024-12-31", rate: "1000.00" },
      { id: "r25", validFrom: "2025-01-01", validTo: null, rate: "1100.00" },
    ];
    const today = "2025-06-15";
    const picked = pickRate(history, today);
    for (const r of history) {
      expect(rateStateFamily(rateState(r, today)) === "done", r.id).toBe(r.id === picked?.id);
    }
  });

  it("current is done, future under way, expired neutral", () => {
    expect(RATE_STATE_FAMILY).toEqual({ current: "done", future: "progress", expired: "neutral" });
  });

  it("a contract is active (done) or deactivated (neutral) — from its flag, never a typed status", () => {
    expect(contractState(true)).toBe("active");
    expect(contractState(false)).toBe("inactive");
    expect(CONTRACT_STATE_FAMILY).toEqual({ active: "done", inactive: "neutral" });
    expect(contractStateFamily(contractState(false))).toBe("neutral");
  });
});

function isKnownFamily(f: string): boolean {
  return (STATE_FAMILIES as readonly string[]).includes(f);
}
