// The one place linking maps a suggestion's confidence → the D40 state family (ui-conventions *States*).
// Client-safe (no Prisma): the inbox list, the suggestions on every panel and the inbox detail read it.
// The family says how far the evidence goes — the row itself keeps its own state (banking's map: open = attention).
//   HIGH    done      reference or name + exact amount + date — `Enter` / *Apply HIGH* may link it
//   MEDIUM  progress  a lead worth a look
//   LOW     neutral   a guess; shown, never applied in bulk
import type { StateFamily } from "@/kernel/ui/state-label";
import type { Confidence } from "./types";

export const CONFIDENCE_FAMILY: Readonly<Record<Confidence, StateFamily>> = {
  HIGH: "done",
  MEDIUM: "progress",
  LOW: "neutral",
};

export function confidenceFamily(confidence: Confidence): StateFamily {
  return CONFIDENCE_FAMILY[confidence];
}
