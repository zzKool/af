// The one place contracts maps its states → the D40 family (ui-conventions *States and tags*). Client-safe (no
// Prisma): the contract rows and the Rates section on the partner page both read it.
//
//   rate      current   done      the rate an invoice dated today would take
//             future    progress  recorded, not yet in force (next year's rate)
//             expired   neutral   history — closed, nothing to do
//   contract  active    done      invoices can be drafted on it
//             inactive  neutral   deactivated by the owner, kept for the invoices that used it
import type { StateFamily } from "@/kernel/ui/state-label";
import type { RateState } from "./types";

export type ContractState = "active" | "inactive";

export const RATE_STATE_FAMILY: Readonly<Record<RateState, StateFamily>> = {
  current: "done",
  future: "progress",
  expired: "neutral",
};

export const CONTRACT_STATE_FAMILY: Readonly<Record<ContractState, StateFamily>> = {
  active: "done",
  inactive: "neutral",
};

export function rateStateFamily(state: RateState): StateFamily {
  return RATE_STATE_FAMILY[state];
}

export function contractState(isActive: boolean): ContractState {
  return isActive ? "active" : "inactive";
}

export function contractStateFamily(state: ContractState): StateFamily {
  return CONTRACT_STATE_FAMILY[state];
}
