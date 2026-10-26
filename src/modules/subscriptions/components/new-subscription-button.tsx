"use client";

// The page's one primary (D40 title row): *New subscription* and the form it opens; the sidebar's **+ New** lands
// here with `?new=1` (F73's `useNewParam`). Rendered only for a caller who may create.
import { Button } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import { useNewParam } from "@/kernel/ui/shell/use-new-param";
import type { SubscriptionPageOptions } from "../page-data";
import { SubscriptionFormDialog, type SubscriptionFormInitial } from "./subscription-form-dialog";

export function NewSubscriptionButton({
  options,
  initial,
}: {
  options: SubscriptionPageOptions;
  /** *Make it recurring* (`?new=1&from=…`): the form pre-filled from the entity */
  initial?: SubscriptionFormInitial | null;
}) {
  const t = useT();
  const [open, setOpen] = useNewParam();
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="open-new-subscription">
        {t("subscriptions.new")}
      </Button>
      <SubscriptionFormDialog
        open={open}
        onOpenChange={setOpen}
        options={options}
        initial={initial}
      />
    </>
  );
}
