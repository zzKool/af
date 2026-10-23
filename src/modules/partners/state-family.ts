// The one place partners maps its state → the D40 family (ui-conventions *States and tags*). Client-safe (no
// Prisma): the list's Status cell, the partner page's title row and its About section read it.
//
//   partner  active    done      invoices, supplier invoices and contracts can name it
//            inactive  neutral   deactivated by the owner, kept for what already names it
//
// A partner's types (client / vendor / employee) are metadata, not a state — grey <Tag>s, never coloured.
import type { StateFamily } from "@/kernel/ui/state-label";

export type PartnerState = "active" | "inactive";

export const PARTNER_STATE_FAMILY: Readonly<Record<PartnerState, StateFamily>> = {
  active: "done",
  inactive: "neutral",
};

/** Derived from the partner's flag — never a typed status. */
export function partnerState(isActive: boolean): PartnerState {
  return isActive ? "active" : "inactive";
}

export function partnerStateFamily(state: PartnerState): StateFamily {
  return PARTNER_STATE_FAMILY[state];
}
