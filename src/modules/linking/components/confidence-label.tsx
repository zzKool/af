"use client";

// A suggestion's confidence, the D40 way: <StateLabel> in the family `confidence-family.ts` maps it to.
import { useT } from "@/kernel/i18n/use-t";
import { StateLabel } from "@/kernel/ui/state-label";
import { confidenceFamily } from "../confidence-family";
import type { Confidence } from "../types";

export function ConfidenceLabel({
  confidence,
  testId,
}: {
  confidence: Confidence;
  testId?: string;
}) {
  const t = useT();
  return (
    <span data-testid={testId} className="inline-flex shrink-0">
      <StateLabel
        family={confidenceFamily(confidence)}
        state={t(`linking.confidence.${confidence}`)}
      />
    </span>
  );
}
