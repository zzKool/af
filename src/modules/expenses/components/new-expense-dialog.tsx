"use client";

// New expense (US1): the group (or a new one inline), kind, date, description, the partner (F87 — optional, its
// default category proposed, never overwriting; from a document the match card offers the OCR merchant's vendor),
// category, amount, currency, who paid, the receipt from the inbox (or "no receipt"), a note. The key and the base
// come from the service.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { CURRENCIES } from "@/kernel/nav/constants";
import {
  type CategoryState,
  chooseCategory,
  proposeCategory,
} from "@/modules/expenses/category-proposal";
import {
  checkExpenseDuplicatesAction,
  createExpenseAction,
} from "@/modules/expenses/expenses.actions";
import type {
  CategoryOption,
  DocumentOption,
  GroupOption,
  SourceOption,
} from "@/modules/expenses/types";
import { EXPENSE_KINDS, type ExpenseKind } from "@/modules/expenses/types";
import { PartnerMatchCard, type VendorFacts } from "@/modules/partners/ui";
import { DuplicatePanel, hasHighMatch, useDuplicateCheck } from "./duplicate-panel";
import { GroupPicker, initialGroupId, useCreateGroupIfNew } from "./group-picker";
import { PartnerPicker, useVendors } from "./partner-picker";

/** What the review page pre-fills from the OCR facts as corrected (specs/documents US1). */
export type ExpenseInitial = {
  date?: string | null;
  description?: string | null;
  amount?: string | null;
  currency?: string | null;
  vatAmount?: string | null;
  documentId?: string | null;
  documentKey?: string | null;
  /** the OCR merchant (name, address) — the match card offers its vendor; nothing is picked without a click */
  vendor?: VendorFacts | null;
};

const NONE = "__none__";

export function NewExpenseDialog({
  open,
  onOpenChange,
  groups,
  categories,
  sources,
  documents,
  defaultGroupId,
  initial,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: GroupOption[];
  categories: CategoryOption[];
  sources: SourceOption[];
  documents: DocumentOption[];
  defaultGroupId?: string;
  /** the OCR facts of the document this expense is made from — applied when the dialog opens */
  initial?: ExpenseInitial;
  onCreated?: (expense: { id: string; key: string }) => void;
}) {
  const t = useT();
  const ids = useId();
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [groupId, setGroupId] = useState(initialGroupId(groups, defaultGroupId));
  const [newGroup, setNewGroup] = useState("");
  const [kind, setKind] = useState<ExpenseKind>("receipt");
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  // the first category is a pre-selection, not the owner's choice: a partner's default may replace it (FR-003)
  const [category, setCategory] = useState<CategoryState>({
    code: categories[0]?.code ?? "",
    source: null,
  });
  const basCode = category.code;
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const { vendors, add: addVendor } = useVendors(open);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<string>("SEK");
  const [sourceId, setSourceId] = useState(sources.find((s) => s.isActive)?.id ?? "");
  const [documentId, setDocumentId] = useState(NONE);
  const [documentMissing, setDocumentMissing] = useState(false);
  const [vatAmount, setVatAmount] = useState("");
  const [note, setNote] = useState("");
  const [ackNote, setAckNote] = useState("");
  const { executeAsync: create, isPending } = useAction(createExpenseAction);
  const { resolveGroupId, isPending: creatingGroup } = useCreateGroupIfNew();
  const { executeAsync: checkDuplicates } = useAction(checkExpenseDuplicatesAction);

  // what the dialog sets when it opens — once per opening: the page may re-render while it is open (a server action
  // that refreshes the session cookie refreshes the route), the option arrays come back new, and that must not
  // reset what the owner picked (the group, the pre-filled facts)
  const opened = useRef(false);
  useEffect(() => {
    if (!open) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    setGroupId(initialGroupId(groups, defaultGroupId));
    setPartnerId(null);
    setCategory((c) => (c.source === "partner" ? { ...c, source: null } : c));
    // the document's facts fill the form when the dialog opens from the review page or the inbox
    if (!initial) return;
    if (initial.date) setDate(initial.date);
    if (initial.description) setDescription(initial.description);
    if (initial.amount) setAmount(initial.amount);
    if (initial.currency) setCurrency(initial.currency);
    if (initial.vatAmount) setVatAmount(initial.vatAmount);
    if (initial.documentId) {
      setDocumentId(initial.documentId);
      setDocumentMissing(false);
    }
    setAckNote("");
  }, [open, defaultGroupId, groups, initial]);

  // the duplicate check (specs/documents US3): the same bytes, or a similar expense of the same merchant
  const checkKey = open
    ? JSON.stringify([
        documentId === NONE ? "" : documentId,
        description.trim(),
        amount.trim(),
        currency,
        date,
      ])
    : "";
  const duplicates = useDuplicateCheck(open, checkKey, async () => {
    const r = await checkDuplicates({
      documentId: documentId === NONE ? undefined : documentId,
      merchant: description.trim() || null,
      amount: amount.trim() || null,
      currency,
      date: date || null,
    });
    return r?.data?.data ?? [];
  });
  const blocked = hasHighMatch(duplicates);
  const documentOptions =
    initial?.documentId && !documents.some((d) => d.id === initial.documentId)
      ? [
          {
            id: initial.documentId,
            businessKey: initial.documentKey ?? "",
            fileName: "",
            status: "extracted",
          },
          ...documents,
        ]
      : documents;

  const categoryCodes = categories.map((c) => c.code);
  function pickPartner(id: string | null, defaultCode?: string | null) {
    setPartnerId(id);
    const def =
      defaultCode !== undefined
        ? defaultCode
        : (vendors.find((v) => v.id === id)?.defaultBasCategoryCode ?? null);
    setCategory((c) => proposeCategory(c, id ? def : null, categoryCodes));
  }

  // the payer's currency pre-fills the expense's
  const sourceCurrency = sources.find((x) => x.id === sourceId)?.currency ?? null;
  useEffect(() => {
    if (sourceCurrency) setCurrency(sourceCurrency);
  }, [sourceCurrency]);

  async function submit() {
    const targetGroup = await resolveGroupId(groupId, newGroup);
    if (!targetGroup) return;
    const r = await create({
      groupId: targetGroup,
      kind,
      date,
      description: description.trim(),
      basCode,
      amount: amount.trim(),
      currency: currency as (typeof CURRENCIES)[number],
      paymentSourceId: sourceId,
      documentId: documentId === NONE ? undefined : documentId,
      documentMissing,
      partnerId,
      vatAmount: vatAmount.trim() || null,
      note: note.trim() || null,
      duplicateAck: blocked
        ? {
            entityIds: duplicates.filter((m) => m.confidence === "high").map((m) => m.entityId),
            note: ackNote.trim(),
          }
        : undefined,
    });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const created = r?.data?.data;
    toast.success(t("expenses.form.created", { key: created?.key ?? "" }));
    setDescription("");
    setAmount("");
    setVatAmount("");
    setNote("");
    setAckNote("");
    setDocumentId(NONE);
    setDocumentMissing(false);
    setNewGroup("");
    setPartnerId(null);
    onOpenChange(false);
    if (created) onCreated?.(created);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="new-expense-dialog" className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("expenses.form.title")}</DialogTitle>
          <DialogDescription>{t("expenses.form.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <GroupPicker
            idPrefix={ids}
            label={t("expenses.form.group")}
            groups={groups}
            value={groupId}
            onChange={setGroupId}
            newDescription={newGroup}
            onNewDescription={setNewGroup}
          />
          <div>
            <label htmlFor={`${ids}-kind`} className="mb-1 block text-xs font-medium">
              {t("expenses.form.kind")}
            </label>
            <Select value={kind} onValueChange={(v) => v && setKind(v as ExpenseKind)}>
              <SelectTrigger id={`${ids}-kind`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_KINDS.filter((k) => k !== "per_diem").map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`expenses.kind.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor={`${ids}-date`} className="mb-1 block text-xs font-medium">
              {t("expenses.form.date")}
            </label>
            <Input
              id={`${ids}-date`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${ids}-desc`} className="mb-1 block text-xs font-medium">
              {t("expenses.form.descriptionField")}
            </label>
            <Input
              id={`${ids}-desc`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              data-testid="expense-description"
            />
          </div>
          {initial?.vendor && (
            <PartnerMatchCard
              vendor={initial.vendor}
              selectedId={partnerId ?? ""}
              onUseMatch={(id) => pickPartner(id)}
              onCreated={(p) => {
                addVendor({ id: p.id, name: p.name, defaultBasCategoryCode: null });
                pickPartner(p.id, null);
              }}
            />
          )}
          <div className="sm:col-span-2">
            <label htmlFor={`${ids}-partner`} className="mb-1 block text-xs font-medium">
              {t("expenses.partner")}
            </label>
            <PartnerPicker
              id={`${ids}-partner`}
              value={partnerId}
              onChange={(id) => pickPartner(id)}
              vendors={vendors}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${ids}-cat`} className="mb-1 block text-xs font-medium">
              {t("expenses.form.category")}
            </label>
            <Select value={basCode} onValueChange={(v) => v && setCategory(chooseCategory(v))}>
              <SelectTrigger id={`${ids}-cat`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {category.source === "partner" && (
              <p className="mt-1 text-xs text-muted-foreground" data-testid="category-from-partner">
                {t("expenses.categoryFromPartner")}
              </p>
            )}
          </div>
          <div>
            <label htmlFor={`${ids}-src`} className="mb-1 block text-xs font-medium">
              {t("expenses.form.paidBy")}
            </label>
            <Select value={sourceId} onValueChange={(v) => v && setSourceId(v)}>
              <SelectTrigger id={`${ids}-src`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sources
                  .filter((s) => s.isActive)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div>
              <label htmlFor={`${ids}-amount`} className="mb-1 block text-xs font-medium">
                {t("expenses.form.amount")}
              </label>
              <Input
                id={`${ids}-amount`}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="600.00"
                required
                data-testid="expense-amount"
              />
            </div>
            <div>
              <label htmlFor={`${ids}-ccy`} className="mb-1 block text-xs font-medium">
                {t("expenses.form.currency")}
              </label>
              <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
                <SelectTrigger id={`${ids}-ccy`} className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label htmlFor={`${ids}-doc`} className="mb-1 block text-xs font-medium">
              {t("expenses.form.document")}
            </label>
            <Select value={documentId} onValueChange={(v) => setDocumentId(v ?? NONE)}>
              <SelectTrigger id={`${ids}-doc`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("expenses.form.noDocument")}</SelectItem>
                {documentOptions.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.fileName ? `${d.businessKey} · ${d.fileName}` : d.businessKey}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {documentId === NONE && (
              <label className="mt-2 flex items-center gap-2 text-sm">
                <Checkbox
                  id={`${ids}-missing`}
                  checked={documentMissing}
                  onCheckedChange={(c) => setDocumentMissing(c === true)}
                  aria-label={t("expenses.form.documentMissing")}
                />
                <span>{t("expenses.form.documentMissing")}</span>
              </label>
            )}
          </div>
          <div>
            <label htmlFor={`${ids}-vat`} className="mb-1 block text-xs font-medium">
              {t("expenses.form.vatAmount")}
            </label>
            <Input
              id={`${ids}-vat`}
              inputMode="decimal"
              value={vatAmount}
              onChange={(e) => setVatAmount(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${ids}-note`} className="mb-1 block text-xs font-medium">
              {t("expenses.form.note")}
            </label>
            <Input id={`${ids}-note`} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DuplicatePanel matches={duplicates} ackNote={ackNote} onAckNote={setAckNote} />
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                isPending || creatingGroup || !basCode || !sourceId || (blocked && !ackNote.trim())
              }
              data-testid="create-expense"
            >
              {blocked ? t("documents.duplicate.panel.createAnyway") : t("expenses.form.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
