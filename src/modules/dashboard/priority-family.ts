// The one place an item's derived priority meets the D40 state families: the icon in front of each to-do line.
// The priority is computed by the overview (never typed); the icon's shape and the list's order carry it, not
// colour alone.
import type { StateFamily } from "@/kernel/ui/state-label";
import type { ActionPriority } from "./types";

export const PRIORITY_FAMILY: Record<ActionPriority, StateFamily> = {
  high: "attention",
  medium: "progress",
  low: "neutral",
};
