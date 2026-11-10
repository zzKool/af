// The board *Documents*' small round tag (F185, D77 — the board wins over D40's grey tags here): a document's kind
// or a chain step's verb on a faint tint of its tone — *Supplier invoice* blue, *Receipt* amber, *Duplicate?* red,
// *links* green. Never the only signal: the word says it. Tokens only.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BoardTone = "progress" | "attention" | "danger" | "done" | "neutral";

const TONE: Record<BoardTone, string> = {
  progress: "bg-state-progress/14 text-primary",
  attention: "bg-state-attention/14 text-state-attention",
  danger: "bg-destructive/12 text-destructive",
  done: "bg-state-done/14 text-state-done",
  neutral: "bg-tag text-muted-foreground",
};

export function BoardTag({
  tone = "neutral",
  children,
  className,
  testId,
}: {
  tone?: BoardTone;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-[7px] text-[11px] font-medium whitespace-nowrap",
        TONE[tone],
        className,
      )}
      data-testid={testId}
    >
      {children}
    </span>
  );
}

/** A document's kind → its tag tone: a supplier invoice blue, an expense / receipt amber, the rest grey. */
export function kindTone(prefixType: string): BoardTone {
  if (prefixType === "invoice" || prefixType === "supplier_invoice") return "progress";
  if (prefixType === "expense") return "attention";
  return "neutral";
}
