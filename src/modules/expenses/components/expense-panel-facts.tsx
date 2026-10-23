"use client";

// The facts of the expense panel — description, category, note (saved on change / blur), *document missing* —
// and its document (the Proof section).
import Link from "next/link";
import { useId, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/kernel/i18n/use-t";
import { DetailsGrid } from "@/kernel/ui/details-section";
import type { CategoryOption } from "@/modules/expenses/types";
import type { ExpensePanelDetail, SaveExpense } from "./expense-panel-shared";

export function ExpenseFactsSection({
  detail,
  categories,
  canWrite,
  save,
  saving,
}: {
  detail: ExpensePanelDetail;
  categories: CategoryOption[];
  canWrite: boolean;
  save: SaveExpense;
  saving: boolean;
}) {
  const t = useT();
  const ids = useId();
  const e = detail.expense;

  // the fields are put back to the saved values on every reload of the panel
  const fromDetail = () => ({ description: e.description, note: e.note ?? "" });
  const [form, setForm] = useState(fromDetail);
  const [loaded, setLoaded] = useState(detail);
  if (loaded !== detail) {
    setLoaded(detail);
    setForm(fromDetail());
  }
  const { description, note } = form;

  return (
    <div>
      {canWrite ? (
        <div className="grid gap-3" data-testid="facts-form">
          <div>
            <label htmlFor={`${ids}-desc`} className="mb-1 block text-xs font-medium">
              {t("expenses.form.descriptionField")}
            </label>
            <Input
              id={`${ids}-desc`}
              value={description}
              onChange={(ev) => setForm((f) => ({ ...f, description: ev.target.value }))}
              onBlur={() => {
                if (description.trim() && description.trim() !== e.description)
                  void save({ description: description.trim() });
              }}
            />
          </div>
          <div>
            <label htmlFor={`${ids}-cat`} className="mb-1 block text-xs font-medium">
              {t("expenses.form.category")}
            </label>
            <Select
              value={e.basCode}
              onValueChange={(v) => v && v !== e.basCode && void save({ basCode: v })}
              disabled={saving}
            >
              <SelectTrigger id={`${ids}-cat`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(categories.some((c) => c.code === e.basCode)
                  ? categories
                  : [{ code: e.basCode, label: detail.basLabel }, ...categories]
                ).map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">{t("expenses.form.aliasWarning")}</p>
          </div>
          <div>
            <label htmlFor={`${ids}-note`} className="mb-1 block text-xs font-medium">
              {t("expenses.form.note")}
            </label>
            <Input
              id={`${ids}-note`}
              value={note}
              onChange={(ev) => setForm((f) => ({ ...f, note: ev.target.value }))}
              onBlur={() => {
                if ((note.trim() || null) !== (e.note ?? null))
                  void save({ note: note.trim() || null });
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              id={`${ids}-missing`}
              checked={e.documentMissing}
              onCheckedChange={(c) => void save({ documentMissing: c === true })}
              disabled={saving}
              aria-label={t("expenses.form.documentMissing")}
            />
            <span>{t("expenses.form.documentMissing")}</span>
          </label>
        </div>
      ) : (
        <DetailsGrid
          rows={[
            [t("expenses.form.descriptionField"), e.description],
            [t("expenses.form.note"), e.note],
          ]}
        />
      )}
    </div>
  );
}

/** The receipt the expense was created from — the first line of Proof. */
export function ExpenseDocumentLine({ detail }: { detail: ExpensePanelDetail }) {
  const t = useT();
  return (
    <DetailsGrid
      rows={[
        [
          t("expenses.panel.document"),
          detail.document ? (
            <Link
              key="doc"
              href={`/documents/${detail.document.id}`}
              className="font-mono text-xs text-primary hover:text-primary-hover hover:underline"
            >
              {detail.document.fileName}
            </Link>
          ) : (
            <span key="none" className="text-muted-foreground">
              {detail.expense.documentMissing
                ? t("expenses.document.missing")
                : t("expenses.form.noDocument")}
            </span>
          ),
        ],
      ]}
    />
  );
}
