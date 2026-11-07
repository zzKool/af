"use client";

// A row's three things — proof · partner · category — as three dots (D76): filled green done, a blue ring
// proposed, half blue partly there, grey missing, a thin ring not needed. The shapes differ, not only the
// colours; the label (tooltip and screen readers) says each in words.
import { useT } from "@/kernel/i18n/use-t";
import { cn } from "@/lib/utils";
import { type RowSteps, STEP_KEYS, type StepStatus } from "@/modules/banking/steps";

const DOT: Record<StepStatus, string> = {
  done: "bg-state-done",
  proposed: "ring-[1.5px] ring-state-progress ring-inset",
  partial:
    "bg-[linear-gradient(90deg,var(--state-progress)_50%,transparent_50%)] ring-1 ring-state-progress ring-inset",
  missing: "bg-muted-foreground/40",
  none: "ring-1 ring-muted-foreground/60 ring-inset",
};

export function stepsLabel(steps: RowSteps, t: ReturnType<typeof useT>): string {
  return STEP_KEYS.map(
    (k) => `${t(`banking.step.${k}`)}: ${t(`banking.stepStatus.${steps[k]}`)}`,
  ).join(" · ");
}

export function StepDots({ steps, className }: { steps: RowSteps; className?: string }) {
  const t = useT();
  const label = stepsLabel(steps, t);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-flex shrink-0 items-center gap-1", className)}
      data-steps={STEP_KEYS.map((k) => steps[k]).join(",")}
    >
      {STEP_KEYS.map((k) => (
        <span key={k} className={cn("inline-block size-[7px] rounded-full", DOT[steps[k]])} />
      ))}
    </span>
  );
}

/** the legend under the list's segments: what the three dots mean */
export function StepDotsLegend() {
  const t = useT();
  const items: [StepStatus, string][] = [
    ["done", t("banking.stepStatus.done")],
    ["proposed", t("banking.stepStatus.proposed")],
    ["missing", t("banking.stepStatus.missing")],
    ["none", t("banking.stepStatus.none")],
  ];
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>{t("banking.steps.legend")}</span>
      {items.map(([s, word]) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={cn("inline-block size-[7px] rounded-full", DOT[s])} aria-hidden />
          {word}
        </span>
      ))}
    </span>
  );
}
