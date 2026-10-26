// A period's derived state → its D40 family, in one place (af-design: the module maps status → family once).
import type { StateFamily } from "@/kernel/ui/state-label";
import type { PeriodState } from "./types";

const FAMILY: Record<PeriodState, StateFamily> = {
  due: "attention",
  charged: "progress",
  documented: "progress",
  done: "done",
  upcoming: "neutral",
  skipped: "neutral",
};

export const periodStateFamily = (s: PeriodState): StateFamily => FAMILY[s];
