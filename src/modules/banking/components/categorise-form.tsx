"use client";

// The owner's facts on a bank row — category, partner, note, "no document needed" — saved on change (F113: on
// the row itself). The workbench's side panel. Reads only (accountant): plain values.
import { useAction } from "next-safe-action/hooks";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { DetailsGrid } from "@/kernel/ui/details-section";
import { Tag } from "@/kernel/ui/tags";
import { categoriseTransactionAction } from "@/modules/banking/banking.actions";
import { basName } from "@/modules/banking/bas-name";
import type { TransactionWire } from "@/modules/banking/detail-wire";

export type CategoryOption = { code: string; label: string };
export type PartnerOption = {
  id: string;
  name: string;
  /** the partner's default BAS category — proposed when a row without one gets this partner (journal T002) */
  defaultBasCode?: string | null;
};

/**
 * The category to propose when `partnerId` is picked (journal T002, US2): the partner's default, only while the
 * row has none — never overwriting a category already set. Saved as the owner's choice (`categorised_by = manual`).
 */
export function proposedCategory(
  currentBasCode: string | null,
  partnerId: string | null,
  partners: readonly PartnerOption[],
): string | null {
  if (currentBasCode || !partnerId) return null;
  return partners.find((p) => p.id === partnerId)?.defaultBasCode ?? null;
}

const NONE = "__none__";

export function CategoriseForm({
  entry,
  categories,
  partners,
  canWrite,
  onSaved,
  prefill = {},
}: {
  entry: Pick<
    TransactionWire,
    "id" | "basCode" | "partnerId" | "note" | "noDocumentNeeded" | "categorisedBy"
  >;
  categories: CategoryOption[];
  partners: PartnerOption[];
  canWrite: boolean;
  onSaved?: (row: TransactionWire) => void;
  /**
   * F98 (the owner's answer 2, 2026-10-27): a HIGH proposal shown as the picker's value while the row has none —
   * drawn as a proposal (dashed, *proposed — not saved*), never saved here: the Proposed line's Accept writes it.
   */
  prefill?: { basCode?: string; partnerId?: string };
}) {
  const t = useT();
  const ids = useId();
  const [basCode, setBasCode] = useState(entry.basCode ?? NONE);
  const [partnerId, setPartnerId] = useState(entry.partnerId ?? NONE);
  // the pre-fill shows only while nothing is chosen — neither saved on the row nor picked here
  const prefilledBas = basCode === NONE && prefill.basCode ? prefill.basCode : null;
  const prefilledPartner = partnerId === NONE && prefill.partnerId ? prefill.partnerId : null;
  const [note, setNote] = useState(entry.note ?? "");
  const [noDocument, setNoDocument] = useState(entry.noDocumentNeeded);
  const { executeAsync, isPending } = useAction(categoriseTransactionAction);

  // another row selected → fresh values
  useEffect(() => {
    setBasCode(entry.basCode ?? NONE);
    setPartnerId(entry.partnerId ?? NONE);
    setNote(entry.note ?? "");
    setNoDocument(entry.noDocumentNeeded);
  }, [entry.basCode, entry.partnerId, entry.note, entry.noDocumentNeeded]);

  async function save(patch: {
    basCode?: string | null;
    partnerId?: string | null;
    note?: string | null;
    noDocumentNeeded?: boolean;
  }) {
    const r = await executeAsync({ id: entry.id, ...patch });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("banking.form.saved"));
    if (r?.data?.data) onSaved?.(r.data.data);
  }

  const shownCode = entry.basCode ?? prefilledBas;
  const categoryList =
    shownCode && !categories.some((c) => c.code === shownCode)
      ? [{ code: shownCode, label: shownCode }, ...categories]
      : categories;

  if (!canWrite) {
    const cat = categoryList.find((c) => c.code === entry.basCode);
    const partner = partners.find((p) => p.id === entry.partnerId);
    return (
      <DetailsGrid
        rows={[
          [
            t("banking.form.category"),
            entry.basCode ? (
              <span key="cat" className="inline-flex flex-wrap items-center gap-1.5">
                <Tag>{entry.basCode}</Tag>
                {basName(entry.basCode, cat?.label)}
              </span>
            ) : null,
          ],
          [t("banking.form.partner"), partner?.name ?? null],
          [t("banking.form.note"), entry.note],
          [t("banking.form.noDocument"), entry.noDocumentNeeded ? t("common.yes") : t("common.no")],
        ]}
      />
    );
  }

  return (
    <div className="grid gap-3" data-testid="categorise-form">
      {entry.categorisedBy === "rule" && (
        <p className="text-xs text-muted-foreground">{t("banking.form.categorisedByRule")}</p>
      )}
      <div>
        <label htmlFor={`${ids}-cat`} className="mb-1 block text-xs font-medium">
          {t("banking.form.category")}
        </label>
        <Select
          value={prefilledBas ?? basCode}
          onValueChange={(v) => {
            const next = v ?? NONE;
            setBasCode(next);
            void save({ basCode: next === NONE ? null : next });
          }}
          disabled={isPending}
        >
          <SelectTrigger
            id={`${ids}-cat`}
            className={prefilledBas ? "w-full border-dashed border-primary" : "w-full"}
            data-prefilled={prefilledBas ? "true" : undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("banking.form.noCategory")}</SelectItem>
            {categoryList.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {prefilledBas && (
          <p className="mt-1 text-xs text-muted-foreground" data-testid="prefill-hint">
            {t("banking.form.prefilled")}
          </p>
        )}
      </div>
      <div>
        <label htmlFor={`${ids}-partner`} className="mb-1 block text-xs font-medium">
          {t("banking.form.partner")}
        </label>
        <Select
          value={prefilledPartner ?? partnerId}
          onValueChange={(v) => {
            const next = v ?? NONE;
            setPartnerId(next);
            const id = next === NONE ? null : next;
            const proposed = proposedCategory(basCode === NONE ? null : basCode, id, partners);
            if (proposed) setBasCode(proposed);
            void save({ partnerId: id, ...(proposed ? { basCode: proposed } : {}) });
          }}
          disabled={isPending}
        >
          <SelectTrigger
            id={`${ids}-partner`}
            className={prefilledPartner ? "w-full border-dashed border-primary" : "w-full"}
            data-prefilled={prefilledPartner ? "true" : undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("banking.form.noPartner")}</SelectItem>
            {partners.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label htmlFor={`${ids}-note`} className="mb-1 block text-xs font-medium">
          {t("banking.form.note")}
        </label>
        <Input
          id={`${ids}-note`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if ((note.trim() || null) !== (entry.note ?? null))
              void save({ note: note.trim() || null });
          }}
          disabled={isPending}
        />
      </div>
      {/* the label wraps the control: a `for` cannot name Base UI's span[role=checkbox] */}
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          id={`${ids}-nodoc`}
          checked={noDocument}
          onCheckedChange={(checked) => {
            const next = checked === true;
            setNoDocument(next);
            void save({ noDocumentNeeded: next });
          }}
          disabled={isPending}
          aria-label={t("banking.form.noDocument")}
        />
        <span>{t("banking.form.noDocument")}</span>
      </label>
    </div>
  );
}
