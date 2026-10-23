"use client";

// A document's derived state on screen (D40): icon + word through the module's one family map.
import { useT } from "@/kernel/i18n/use-t";
import { StateLabel } from "@/kernel/ui/state-label";
import { invoiceStateFamily } from "../state-family";
import type { InvoiceState } from "../types";

export function InvoiceStateLabel({
  state,
  testId,
  className,
}: {
  state: InvoiceState;
  testId?: string;
  className?: string;
}) {
  const t = useT();
  return (
    <span data-testid={testId} className="inline-flex">
      <StateLabel
        family={invoiceStateFamily(state)}
        state={t(`invoices.state.${state}`)}
        className={className}
      />
    </span>
  );
}
