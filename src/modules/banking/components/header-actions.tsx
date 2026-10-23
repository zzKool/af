"use client";

// The banking pages' title-row actions (D40: secondary buttons, then one primary).
//   /banking          Inbox · Imports · Rules · [Import CSV]
//   /banking/imports  [Import CSV]
//   /banking/rules    Apply rules (dry run → confirm) · [New rule]
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { applyRulesAction } from "@/modules/banking/banking.actions";
import type { CategoryOption, PartnerOption } from "@/modules/journal/ui";
import { type AccountOption, ImportDialog } from "./import-dialog";
import { RuleDialog } from "./rule-dialog";

/** The primary of the workbench and the imports page: opens the import dialog. */
export function ImportCsvButton({ accounts }: { accounts: AccountOption[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="open-import">
        {t("banking.import.button")}
      </Button>
      <ImportDialog open={open} onOpenChange={setOpen} accounts={accounts} />
    </>
  );
}

export function WorkbenchActions({
  accounts,
  canWrite,
}: {
  accounts: AccountOption[];
  canWrite: boolean;
}) {
  const t = useT();
  return (
    <>
      <Button
        variant="outline"
        nativeButton={false}
        render={<Link href="/banking/inbox" />}
        data-testid="go-inbox"
      >
        {t("banking.nav.inbox")}
      </Button>
      <Button variant="outline" nativeButton={false} render={<Link href="/banking/imports" />}>
        {t("banking.nav.imports")}
      </Button>
      <Button variant="outline" nativeButton={false} render={<Link href="/banking/rules" />}>
        {t("banking.nav.rules")}
      </Button>
      {canWrite && <ImportCsvButton accounts={accounts} />}
    </>
  );
}

export function RulesActions({
  categories,
  partners,
}: {
  categories: CategoryOption[];
  partners: PartnerOption[];
}) {
  const t = useT();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<{ matches: number; tested: number } | null>(null);
  const { executeAsync: apply, isPending: applying } = useAction(applyRulesAction);

  async function dryRun() {
    const r = await apply({ dryRun: true });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const d = r?.data?.data;
    if (d) setPreview({ matches: d.preview.length, tested: d.tested });
  }

  async function applyNow() {
    const r = await apply({ dryRun: false });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("banking.rules.applied", { count: r?.data?.data?.applied ?? 0 }));
    setPreview(null);
    router.refresh();
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => void dryRun()}
        disabled={applying}
        data-testid="apply-rules"
      >
        {t("banking.rules.apply")}
      </Button>
      <Button onClick={() => setCreating(true)} data-testid="new-rule">
        {t("banking.rules.new")}
      </Button>
      <RuleDialog
        open={creating}
        onOpenChange={setCreating}
        rule={null}
        categories={categories}
        partners={partners}
        onSaved={() => router.refresh()}
      />
      {/* the dry run's answer; nothing to apply → the same dialog, the confirm disabled */}
      <ConfirmDialog
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        title={t("banking.rules.apply")}
        description={preview ? t("banking.rules.applyPreview", preview) : ""}
        confirmLabel={t("banking.rules.applyConfirm")}
        cancelLabel={t("common.cancel")}
        variant="default"
        onConfirm={() => {
          if (preview && preview.matches > 0) void applyNow();
          else setPreview(null);
        }}
        isLoading={applying}
      />
    </>
  );
}
