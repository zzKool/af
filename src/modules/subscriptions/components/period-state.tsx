"use client";

// A period's derived state on screen (D40): icon + word through the module's one family map, its to-do marks after.
import { useT } from "@/kernel/i18n/use-t";
import { StateLabel } from "@/kernel/ui/state-label";
import { periodStateFamily } from "../state-family";
import type { PeriodMark, PeriodState } from "../types";

export function PeriodStateLabel({
  state,
  marks = [],
  testId,
}: {
  state: PeriodState;
  marks?: readonly PeriodMark[];
  testId?: string;
}) {
  const t = useT();
  const words = marks.map((m) => t(`subscriptions.mark.${m}`));
  return (
    <span data-testid={testId} data-state={state} className="inline-flex">
      <StateLabel
        family={periodStateFamily(state)}
        state={[t(`subscriptions.state.${state}`), ...words].join(" · ")}
      />
    </span>
  );
}
