// The one place the journal maps its derived links state → the D40 state family (ui-conventions *States*).
// Client-safe (no Prisma). The same families as a bank row's state: a bank entry's state is its row's.
//   none         attention    nothing proves the entry yet
//   partly       progress     some proof, not the whole amount
//   justified    done         Σ allocations covers the amount
//   no_document  neutral      the flag, or a transfer leg (the other statement row is the proof)
import type { StateFamily } from "@/kernel/ui/state-label";
import type { LinksState } from "./types";

export const LINKS_STATE_FAMILY: Readonly<Record<LinksState, StateFamily>> = {
  none: "attention",
  partly: "progress",
  justified: "done",
  no_document: "neutral",
};
