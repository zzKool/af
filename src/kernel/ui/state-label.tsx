// A derived state (constitution: never typed) shown the D40 way: a 15 px circle icon in its family's colour
// and the word — no pill, no background. Colour is never the only signal: the icon's shape and the word
// carry it too. A module maps its derived status → family **in one place** and renders <StateLabel>.
//
//   attention    !  circle   Open, Overdue, Due, Awaiting link, OCR failed
//   in progress  ◐  circle   Match found, Issued, Sent, Partially paid, OCR pending, Ready
//   done         ✓  circle   Linked, Paid, Reviewed / Filed, Settled, Credited
//   neutral      –  circle   Draft, Transfer, No document needed, Cancelled, Archived
import { CircleAlert, CircleCheck, CircleMinus } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const STATE_FAMILIES = ["attention", "progress", "done", "neutral"] as const;
export type StateFamily = (typeof STATE_FAMILIES)[number];

const COLOUR: Record<StateFamily, string> = {
  attention: "text-state-attention",
  progress: "text-state-progress",
  done: "text-state-done",
  neutral: "text-state-neutral",
};

/** The half-filled circle of "in progress" (lucide has none). */
function CircleHalf({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M12 2a10 10 0 0 0 0 20Z" fill="currentColor" />
    </svg>
  );
}

export function StateIcon({ family, className }: { family: StateFamily; className?: string }) {
  const cls = cn("size-[15px] shrink-0", COLOUR[family], className);
  switch (family) {
    case "attention":
      return <CircleAlert className={cls} aria-hidden />;
    case "progress":
      return <CircleHalf className={cls} />;
    case "done":
      return <CircleCheck className={cls} aria-hidden />;
    case "neutral":
      return <CircleMinus className={cls} aria-hidden />;
  }
}

export function StateLabel({
  family,
  state,
  className,
}: {
  family: StateFamily;
  /** the word, already translated */
  state: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-state-family={family}
      className={cn(
        "inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap",
        family === "neutral" ? "text-muted-foreground" : "text-foreground",
        className,
      )}
    >
      <StateIcon family={family} />
      {state}
    </span>
  );
}
