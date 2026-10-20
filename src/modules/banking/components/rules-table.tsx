"use client";

// The rules page: the list (priority order), new / edit / delete, "Apply rules" (dry run → apply).
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { applyRulesAction, deleteRuleAction } from "@/modules/banking/banking.actions";
import type { RuleListRow } from "@/modules/banking/types";
import type { CategoryOption, PartnerOption } from "@/modules/journal/ui";
import { RuleDialog } from "./rule-dialog";

export type RuleRow = Omit<RuleListRow, "lastHitAt" | "createdAt" | "updatedAt"> & {
  lastHitAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function RulesTable({
  rules,
  categories,
  partners,
  canWrite,
}: {
  rules: RuleRow[];
  categories: CategoryOption[];
  partners: PartnerOption[];
  canWrite: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<RuleRow | null>(null);
  const [preview, setPreview] = useState<{ matches: number; tested: number } | null>(null);
  const { executeAsync: apply, isPending: applying } = useAction(applyRulesAction);
  const { executeAsync: remove, isPending: deleting } = useAction(deleteRuleAction);

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

  async function confirmDelete() {
    if (!toDelete) return;
    const r = await remove({ id: toDelete.id });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("banking.rules.deleted"));
    setToDelete(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setCreating(true)} data-testid="new-rule">
            {t("banking.rules.new")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void dryRun()} disabled={applying}>
            {t("banking.rules.apply")}
          </Button>
          {preview && (
            <span className="flex items-center gap-2 text-sm" data-testid="apply-preview">
              {t("banking.rules.applyPreview", preview)}
              {preview.matches > 0 && (
                <Button size="sm" onClick={() => void applyNow()} disabled={applying}>
                  {t("banking.rules.applyConfirm")}
                </Button>
              )}
            </span>
          )}
        </div>
      )}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("banking.rules.col.name")}</TableHead>
              <TableHead>{t("banking.rules.col.type")}</TableHead>
              <TableHead>{t("banking.rules.col.pattern")}</TableHead>
              <TableHead>{t("banking.rules.col.field")}</TableHead>
              <TableHead>{t("banking.rules.col.category")}</TableHead>
              <TableHead>{t("banking.rules.col.partner")}</TableHead>
              <TableHead>{t("banking.rules.col.noDocument")}</TableHead>
              <TableHead className="text-right">{t("banking.rules.col.priority")}</TableHead>
              <TableHead>{t("banking.rules.col.source")}</TableHead>
              <TableHead className="text-right">{t("banking.rules.col.hits")}</TableHead>
              <TableHead>{t("banking.rules.col.lastHit")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground">
                  {t("banking.rules.empty")}
                </TableCell>
              </TableRow>
            )}
            {rules.map((r) => (
              <TableRow
                key={r.id}
                data-testid="rule-row"
                className={r.isActive ? "" : "opacity-50"}
              >
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{t(`banking.rules.type.${r.matchType}`)}</TableCell>
                <TableCell className="font-mono text-xs">{r.matchPattern}</TableCell>
                <TableCell>{t(`banking.rules.field.${r.matchField}`)}</TableCell>
                <TableCell>{r.basLabel ?? "—"}</TableCell>
                <TableCell>{r.partnerName ?? "—"}</TableCell>
                <TableCell>{r.noDocumentNeeded ? t("common.yes") : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.priority}</TableCell>
                <TableCell>
                  <Badge variant="outline">{t(`banking.rules.source.${r.ruleSource}`)}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.hitCount}</TableCell>
                <TableCell className="tabular-nums">
                  {r.lastHitAt ? r.lastHitAt.slice(0, 10) : "—"}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {canWrite && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                        {t("common.edit")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setToDelete(r)}>
                        {t("common.delete")}
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {canWrite && (
        <RuleDialog
          open={creating || !!editing}
          onOpenChange={(o) => {
            if (!o) {
              setCreating(false);
              setEditing(null);
            }
          }}
          rule={editing}
          categories={categories}
          partners={partners}
          onSaved={() => router.refresh()}
        />
      )}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        description={t("banking.rules.deleteConfirm", { name: toDelete?.name ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void confirmDelete()}
        isLoading={deleting}
      />
    </div>
  );
}
