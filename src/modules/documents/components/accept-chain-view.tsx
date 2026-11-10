"use client";

// *When you accept* (F185, the board *Documents*; F186 the reading dialog): the two or three things one click does,
// one node each joined by a short line — **creates** the entity and its key, **links** the bank row with its score,
// **files** the category and the partner — and the one primary under them, worded by the number of steps (*Accept
// all three* · *Accept both* · *Accept*) with its key, Enter. A step that still lacks something says so in amber and
// opens what fills it on a click; the host decides what the click does. Presentational.
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import { cn } from "@/lib/utils";
import { BoardTag, type BoardTone } from "./board-tag";

export type ChainVerb = "creates" | "links" | "files";

export type ChainNode = {
  verb: ChainVerb;
  body: ReactNode;
  /** a figure on the right (the bank row's score) */
  aside?: ReactNode;
  /** the step lacks something: amber, and a click opens what fills it */
  lacking?: boolean;
  /** the step opens its own editor in place (F186: the partner, the group, the category) */
  onOpen?: () => void;
  /** what opens under the node */
  children?: ReactNode;
};

const VERB_TONE: Record<ChainVerb, BoardTone> = {
  creates: "progress",
  links: "done",
  files: "attention",
};

export function AcceptChainView({
  nodes,
  label,
  onAccept,
  disabled = false,
  hint,
  extra,
  testId = "accept-chain",
  buttonTestId = "chain-accept",
}: {
  nodes: ChainNode[];
  /** the primary's word; null = no primary (the accountant, or nothing to accept) */
  label: string | null;
  onAccept: () => void;
  disabled?: boolean;
  /** what the click still needs, said under the button */
  hint?: ReactNode;
  /** secondary actions under the primary */
  extra?: ReactNode;
  testId?: string;
  buttonTestId?: string;
}) {
  const t = useT();
  return (
    <section className="flex flex-col" data-testid={testId} aria-label={t("documents.chain.title")}>
      <h3 className="eyebrow mx-1 mt-2.5 mb-1">{t("documents.chain.title")}</h3>
      {nodes.map((n, i) => (
        <div key={n.verb} className="flex flex-col">
          {i > 0 && <div className="ml-[22px] h-3.5 w-0.5 rounded-full bg-read/50" aria-hidden />}
          <div
            className={cn(
              "flex flex-col rounded-xl border bg-surface-2",
              n.lacking ? "border-state-attention/40" : "border-subtle",
            )}
            data-testid={`chain-${n.verb}`}
            data-lacking={n.lacking ? "true" : undefined}
          >
            {n.onOpen ? (
              <button
                type="button"
                className="flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/40"
                onClick={n.onOpen}
              >
                <NodeLine node={n} />
              </button>
            ) : (
              <div className="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
                <NodeLine node={n} />
              </div>
            )}
            {n.children && <div className="border-t border-subtle px-3 py-2.5">{n.children}</div>}
          </div>
        </div>
      ))}
      {label !== null && (
        <Button
          className="mt-2.5 h-[42px] rounded-[10px] text-[13px]"
          onClick={onAccept}
          disabled={disabled}
          data-testid={buttonTestId}
        >
          {label}
          <kbd className="rounded-md border border-action-fg/20 bg-action-fg/10 px-[7px] py-px font-mono text-[11px] font-normal text-action-fg/70">
            Enter
          </kbd>
        </Button>
      )}
      {hint && (
        <p className="mx-1 mt-1.5 text-xs text-muted-foreground" data-testid="chain-hint">
          {hint}
        </p>
      )}
      {extra}
    </section>
  );
}

function NodeLine({ node: n }: { node: ChainNode }) {
  const t = useT();
  return (
    <>
      <BoardTag tone={n.lacking ? "attention" : VERB_TONE[n.verb]}>
        {t(`documents.chain.${n.verb}`)}
      </BoardTag>
      <span className={cn("line-clamp-2 min-w-0 flex-1", n.lacking && "text-state-attention")}>
        {n.body}
      </span>
      {n.aside && <span className="ml-auto shrink-0 font-mono text-[11px]">{n.aside}</span>}
    </>
  );
}
