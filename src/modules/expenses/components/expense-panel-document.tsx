"use client";

// The receipt after the expense (F94 FR-012): under the Proof's document line, the owner attaches a receipt from
// the inbox to an expense that has none (renamed with the expense's key, `created_from`), or removes the one it has
// (back in the inbox, its key kept). Allowed in every state — a document is proof, not a money fact.
import { useAction } from "next-safe-action/hooks";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import {
  attachExpenseDocumentAction,
  candidateExpenseDocumentsAction,
  detachExpenseDocumentAction,
} from "@/modules/expenses/expenses.actions";
import type { DocumentOption } from "@/modules/expenses/types";
import { type ExpensePanelDetail, NONE } from "./expense-panel-shared";

export function ExpenseDocumentAttach({
  detail,
  canWrite,
  onChanged,
}: {
  detail: ExpensePanelDetail;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const ids = useId();
  const e = detail.expense;
  const hasDocument = detail.document !== null;
  const [options, setOptions] = useState<DocumentOption[]>([]);
  const [pick, setPick] = useState(NONE);
  const { executeAsync: loadCandidates } = useAction(candidateExpenseDocumentsAction);
  const { executeAsync: attach, isPending: attaching } = useAction(attachExpenseDocumentAction);
  const { executeAsync: detach, isPending: detaching } = useAction(detachExpenseDocumentAction);

  useEffect(() => {
    if (!canWrite || hasDocument) return;
    let live = true;
    void loadCandidates({}).then((r) => {
      if (live && r?.data && "data" in r.data && Array.isArray(r.data.data))
        setOptions(r.data.data);
    });
    return () => {
      live = false;
    };
  }, [canWrite, hasDocument, loadCandidates]);

  async function run(p: Promise<unknown>, done: string) {
    const error = extractError(await p);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(done);
    setPick(NONE);
    onChanged();
  }

  if (!canWrite) return null;
  if (hasDocument) {
    return (
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={detaching}
          onClick={() =>
            void run(detach({ expenseId: e.id }), t("expenses.attachDocument.removed"))
          }
          data-testid="detach-document"
        >
          {t("expenses.attachDocument.remove")}
        </Button>
      </div>
    );
  }
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="attach-document">
      <div className="min-w-0 flex-1">
        <label htmlFor={`${ids}-doc`} className="mb-1 block text-xs font-medium">
          {t("expenses.attachDocument.pick")}
        </label>
        <Select value={pick} onValueChange={(v) => setPick(v ?? NONE)}>
          <SelectTrigger id={`${ids}-doc`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            {options.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.businessKey || d.fileName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        size="sm"
        disabled={attaching || pick === NONE}
        onClick={() =>
          void run(
            attach({ expenseId: e.id, documentId: pick }),
            t("expenses.attachDocument.attached"),
          )
        }
        data-testid="attach-document-button"
      >
        {t("expenses.attachDocument.attach")}
      </Button>
    </div>
  );
}
