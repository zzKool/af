"use client";

// *Confirm all exact* (F94 US3-8): one click for the periods whose only offer is one exact bank row — the rest stay
// for the owner, and the toast says how many.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import type { ConfirmAllReport } from "../confirm";
import { confirmAllExactAction } from "../subscriptions.actions";

export function ConfirmAllExactButton() {
  const t = useT();
  const router = useRouter();
  const { executeAsync, isPending } = useAction(confirmAllExactAction);
  return (
    <Button
      variant="outline"
      disabled={isPending}
      data-testid="confirm-all-exact"
      onClick={async () => {
        const r = await executeAsync({});
        const error = extractError(r);
        if (error) return void toast.error(error);
        const report = r?.data && "data" in r.data ? (r.data.data as ConfirmAllReport) : null;
        if (!report || report.confirmed.length === 0) {
          toast.info(t("subscriptions.allExact.none"));
          return;
        }
        toast.success(
          t("subscriptions.allExact.done", {
            confirmed: report.confirmed.length,
            skipped: report.skipped.length,
          }),
        );
        router.refresh();
      }}
    >
      {t("subscriptions.allExact.label")}
    </Button>
  );
}
