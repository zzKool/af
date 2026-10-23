"use client";

// The owner's facts on a journal entry — category, partner, note, "no document needed" — saved on change.
// Shared by the banking workbench's side panel and the journal page. Reads only (accountant): plain values.
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
import { basName } from "@/modules/journal/bas-name";
import { categoriseEntryAction } from "@/modules/journal/journal.actions";
import type { JournalEntryDto } from "@/modules/journal/types";

export type CategoryOption = { code: string; label: string };
export type PartnerOption = {
  id: string;
  name: string;
  /** the partner's default BAS category — proposed when an entry without one gets this partner (T002) */
  defaultBasCode?: string | null;
};

/**
 * The category to propose when `partnerId` is picked (T002, US2): the partner's default, only while the entry has
 * none — never overwriting a category already set. Saved as the owner's choice (`categorised_by = manual`).
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
}: {
  entry: Pick<
    JournalEntryDto,
    "id" | "basCode" | "partnerId" | "note" | "noDocumentNeeded" | "categorisedBy"
  >;
  categories: CategoryOption[];
  partners: PartnerOption[];
  canWrite: boolean;
  onSaved?: (entry: JournalEntryDto) => void;
}) {
  const t = useT();
  const ids = useId();
  const [basCode, setBasCode] = useState(entry.basCode ?? NONE);
  const [partnerId, setPartnerId] = useState(entry.partnerId ?? NONE);
  const [note, setNote] = useState(entry.note ?? "");
  const [noDocument, setNoDocument] = useState(entry.noDocumentNeeded);
  const { executeAsync, isPending } = useAction(categoriseEntryAction);

  // another entry selected → fresh values
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
    toast.success(t("journal.form.saved"));
    if (r?.data?.data) onSaved?.(r.data.data);
  }

  const categoryList =
    entry.basCode && !categories.some((c) => c.code === entry.basCode)
      ? [{ code: entry.basCode, label: entry.basCode }, ...categories]
      : categories;

  if (!canWrite) {
    const cat = categoryList.find((c) => c.code === entry.basCode);
    const partner = partners.find((p) => p.id === entry.partnerId);
    return (
      <DetailsGrid
        rows={[
          [
            t("journal.form.category"),
            entry.basCode ? (
              <span key="cat" className="inline-flex flex-wrap items-center gap-1.5">
                <Tag>{entry.basCode}</Tag>
                {basName(entry.basCode, cat?.label)}
              </span>
            ) : null,
          ],
          [t("journal.form.partner"), partner?.name ?? null],
          [t("journal.form.note"), entry.note],
          [t("journal.form.noDocument"), entry.noDocumentNeeded ? t("common.yes") : t("common.no")],
        ]}
      />
    );
  }

  return (
    <div className="grid gap-3" data-testid="categorise-form">
      {entry.categorisedBy === "rule" && (
        <p className="text-xs text-muted-foreground">{t("journal.form.categorisedByRule")}</p>
      )}
      <div>
        <label htmlFor={`${ids}-cat`} className="mb-1 block text-xs font-medium">
          {t("journal.form.category")}
        </label>
        <Select
          value={basCode}
          onValueChange={(v) => {
            const next = v ?? NONE;
            setBasCode(next);
            void save({ basCode: next === NONE ? null : next });
          }}
          disabled={isPending}
        >
          <SelectTrigger id={`${ids}-cat`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("journal.form.noCategory")}</SelectItem>
            {categoryList.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label htmlFor={`${ids}-partner`} className="mb-1 block text-xs font-medium">
          {t("journal.form.partner")}
        </label>
        <Select
          value={partnerId}
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
          <SelectTrigger id={`${ids}-partner`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("journal.form.noPartner")}</SelectItem>
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
          {t("journal.form.note")}
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
          aria-label={t("journal.form.noDocument")}
        />
        <span>{t("journal.form.noDocument")}</span>
      </label>
    </div>
  );
}
