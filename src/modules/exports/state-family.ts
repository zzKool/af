// The one place exports maps a quarter's declaration state → the D40 family (ui-conventions *States and tags*).
// Client-safe (no Prisma). The state is derived from the record's dates — never typed:
//   draft     neutral   no declaration date yet — the form is live, the figures still move
//   declared  progress  filed with the FTA, the VAT is owed (Mark paid next)
//   paid      done      the payment is recorded (typed date, or the vat_payment expense's date)
import type { StateFamily } from "@/kernel/ui/state-label";

export const DECLARATION_STATES = ["draft", "declared", "paid"] as const;
export type DeclarationState = (typeof DECLARATION_STATES)[number];

export const DECLARATION_STATE_FAMILY: Readonly<Record<DeclarationState, StateFamily>> = {
  draft: "neutral",
  declared: "progress",
  paid: "done",
};

export function declarationState(
  record: { declaredAt: string | null; paidAt: string | null } | null,
): DeclarationState {
  if (record?.paidAt) return "paid";
  if (record?.declaredAt) return "declared";
  return "draft";
}

export function declarationStateFamily(state: DeclarationState): StateFamily {
  return DECLARATION_STATE_FAMILY[state];
}
