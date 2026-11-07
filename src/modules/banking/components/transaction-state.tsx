"use client";

// A bank row's derived state, the D40 way: <StateLabel> in the family `state-family.ts` maps it to.
import { useT } from "@/kernel/i18n/use-t";
import { StateLabel } from "@/kernel/ui/state-label";
import { transactionStateFamily } from "@/modules/banking/state-family";
import type { TransactionState } from "@/modules/banking/types";

export function TransactionStateLabel({
  state,
  testId,
  variant,
}: {
  state: TransactionState;
  testId?: string;
  variant?: "label" | "chip";
}) {
  const t = useT();
  return (
    <span data-testid={testId} className="inline-flex">
      <StateLabel
        family={transactionStateFamily(state)}
        state={t(`banking.state.${state}`)}
        variant={variant}
      />
    </span>
  );
}
