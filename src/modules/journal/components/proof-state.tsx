"use client";

// The derived Proof state (T004) as a <StateLabel> — the ledger cell and the panel title read the same map
// (`state-family.ts`), so the word and the colour never differ between the two.
import { useT } from "@/kernel/i18n/use-t";
import { StateLabel } from "@/kernel/ui/state-label";
import { LINKS_STATE_FAMILY } from "@/modules/journal/state-family";
import type { LinksState } from "@/modules/journal/types";

export function JournalProofLabel({ state, testId }: { state: LinksState; testId?: string }) {
  const t = useT();
  return (
    <span data-testid={testId} data-state={state} className="inline-flex">
      <StateLabel family={LINKS_STATE_FAMILY[state]} state={t(`journal.linksState.${state}`)} />
    </span>
  );
}
