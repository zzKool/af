"use client";

// New supplier invoice (US1, US3): the supplier (its currency, terms, category and registration pre-fill), the
// group (or a new one inline), the supplier's number, the dates, net / VAT / total, the category, the VAT
// registration, the document from the inbox (or "no document"), a note. *Copy last* takes the supplier's latest
// invoice (amounts, category, registration — a new number and dates). The key and the base come from the service.
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
import { createClock } from "@/kernel/clock/clock";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { CURRENCIES } from "@/kernel/nav/constants";
import {
  DuplicatePanel,
  GroupPicker,
  hasHighMatch,
  initialGroupId,
  useCreateGroupIfNew,
  useDuplicateCheck,
} from "@/modules/expenses/ui";
import {
  checkSupplierInvoiceDuplicatesAction,
  copyLastSupplierInvoiceAction,
  createSupplierInvoiceAction,
} from "@/modules/supplier-invoices/supplier-invoices.actions";
import { withCreatedSuppliers } from "@/modules/supplier-invoices/supplier-options";
import type {
  CategoryOption,
  DocumentOption,
  GroupOption,
  RegistrationOption,
  SupplierOption,
} from "@/modules/supplier-invoices/types";
import { ExactNumberStop, exactMatches } from "./exact-number-stop";
import { SupplierMatchCard, type VendorFacts } from "./supplier-match-card";

/** What the review page pre-fills from the OCR facts as corrected (specs/documents US1). */
export type SupplierInvoiceInitial = {
  vendor?: VendorFacts;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  currency?: string | null;
  amountNet?: string | null;
  vatAmount?: string | null;
  amountTotal?: string | null;
  documentId?: string | null;
  documentKey?: string | null;
};

const NONE = "__none__";
const DEFAULT_TERMS = 30;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function sum(a: string, b: string): string {
  const n = Number(a || 0);
  const v = Number(b || 0);
  if (Number.isNaN(n) || Number.isNaN(v)) return "";
  return (Math.round((n + v) * 100) / 100).toFixed(2);
}

export function NewSupplierInvoiceDialog({
  open,
  onOpenChange,
  groups,
  categories,
  suppliers,
  registrations,
  documents,
  defaultGroupId,
  initial,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: GroupOption[];
  categories: CategoryOption[];
  suppliers: SupplierOption[];
  registrations: RegistrationOption[];
  documents: DocumentOption[];
  defaultGroupId?: string;
  /** the OCR facts of the document this invoice is made from — applied when the dialog opens */
  initial?: SupplierInvoiceInitial;
  onCreated?: (invoice: { id: string; key: string }) => void;
}) {
  const t = useT();
  const ids = useId();
  const router = useRouter();
  const today = createClock().today();
  const [groupId, setGroupId] = useState(initialGroupId(groups, defaultGroupId));
  const [newGroup, setNewGroup] = useState("");
  const [partnerId, setPartnerId] = useState(initial?.vendor ? "" : (suppliers[0]?.id ?? ""));
  const [extraSuppliers, setExtraSuppliers] = useState<SupplierOption[]>([]);
  const [ackNote, setAckNote] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [dueTouched, setDueTouched] = useState(false);
  const [currency, setCurrency] = useState<string>("SEK");
  const [amountNet, setAmountNet] = useState("");
  const [vatAmount, setVatAmount] = useState("");
  const [amountTotal, setAmountTotal] = useState("");
  const [totalTouched, setTotalTouched] = useState(false);
  const [basCode, setBasCode] = useState(categories[0]?.code ?? "");
  const [registrationId, setRegistrationId] = useState(NONE);
  const [documentId, setDocumentId] = useState(NONE);
  const [documentMissing, setDocumentMissing] = useState(false);
  const [note, setNote] = useState("");
  const { executeAsync: create, isPending } = useAction(createSupplierInvoiceAction);
  const { resolveGroupId, isPending: creatingGroup } = useCreateGroupIfNew();
  const { executeAsync: copyLast, isPending: copying } = useAction(copyLastSupplierInvoiceAction);
  const { executeAsync: checkDuplicates } = useAction(checkSupplierInvoiceDuplicatesAction);

  // what the dialog sets when it opens — once per opening: the page may re-render while it is open (a server action
  // that refreshes the session cookie refreshes the route), the option arrays come back new, and that must not
  // reset what the owner picked (a new group typed in, the pre-filled facts)
  const opened = useRef(false);
  useEffect(() => {
    if (!open) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    setGroupId(initialGroupId(groups, defaultGroupId));
    // the document's facts fill the form when the dialog opens from the review page or the inbox
    if (!initial) return;
    if (initial.invoiceNumber) setInvoiceNumber(initial.invoiceNumber);
    if (initial.invoiceDate) setInvoiceDate(initial.invoiceDate);
    if (initial.dueDate) {
      setDueDate(initial.dueDate);
      setDueTouched(true);
    }
    if (initial.currency) setCurrency(initial.currency);
    if (initial.amountNet) setAmountNet(initial.amountNet);
    if (initial.vatAmount) setVatAmount(initial.vatAmount);
    if (initial.amountTotal) {
      setAmountTotal(initial.amountTotal);
      setTotalTouched(true);
    }
    if (initial.documentId) {
      setDocumentId(initial.documentId);
      setDocumentMissing(false);
    }
    setAckNote("");
  }, [open, defaultGroupId, groups, initial]);

  // created from the match card, then listed by the refreshed page too → once (the duplicate React key)
  const allSuppliers = withCreatedSuppliers(extraSuppliers, suppliers);
  // the supplier's defaults pre-fill the currency, the category and the due date
  const supplier = allSuppliers.find((s) => s.id === partnerId);
  const initialCurrency = initial?.currency ?? null;
  // plain values, so a re-render with new option arrays does not re-apply the defaults over the owner's edits
  const supplierId = supplier?.id ?? null;
  const supplierCurrency = supplier?.defaultCurrency ?? null;
  const supplierBas =
    supplier?.defaultBasCategoryCode &&
    categories.some((c) => c.code === supplier.defaultBasCategoryCode)
      ? supplier.defaultBasCategoryCode
      : null;
  const supplierTerms = supplier?.paymentTermsDays ?? DEFAULT_TERMS;
  useEffect(() => {
    if (!supplierId) return;
    // the document's currency wins over the supplier's default when the dialog opens from the review page
    if (supplierCurrency && !initialCurrency) setCurrency(supplierCurrency);
    if (supplierBas) setBasCode(supplierBas);
  }, [supplierId, supplierCurrency, supplierBas, initialCurrency]);
  useEffect(() => {
    if (!dueTouched) setDueDate(addDays(invoiceDate, supplierTerms));
  }, [invoiceDate, supplierTerms, dueTouched]);
  useEffect(() => {
    if (!totalTouched) setAmountTotal(amountNet || vatAmount ? sum(amountNet, vatAmount) : "");
  }, [amountNet, vatAmount, totalTouched]);

  async function prefillFromLast() {
    if (!partnerId) return;
    const r = await copyLast({ partnerId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const last = r?.data && "data" in r.data ? r.data.data : null;
    if (!last) {
      toast.info(t("supplierInvoices.form.noLast"));
      return;
    }
    setCurrency(last.currency);
    setAmountNet(last.amountNet);
    setVatAmount(last.vatAmount);
    setAmountTotal(last.amountTotal);
    setTotalTouched(true);
    setBasCode(last.basCode);
    setRegistrationId(last.vatRegistrationId ?? NONE);
    setNote(last.note ?? "");
    if (groups.some((g) => g.id === last.groupId) && !defaultGroupId) setGroupId(last.groupId);
  }

  // the duplicate check (specs/documents US3): same partner + number, the same bytes, a similar invoice
  const checkKey = open
    ? JSON.stringify([
        documentId === NONE ? "" : documentId,
        partnerId,
        invoiceNumber.trim(),
        amountTotal.trim(),
        currency,
        invoiceDate,
      ])
    : "";
  const duplicates = useDuplicateCheck(open, checkKey, async () => {
    const r = await checkDuplicates({
      documentId: documentId === NONE ? undefined : documentId,
      partnerId: partnerId || null,
      invoiceNumber: invoiceNumber.trim() || null,
      amount: amountTotal.trim() || null,
      currency,
      date: invoiceDate || null,
    });
    return r?.data?.data ?? [];
  });
  // an exact number match is refused (D35): the stop, nothing to acknowledge; hash / fuzzy keep *Create anyway*
  const taken = exactMatches(duplicates);
  const refused = taken.length > 0;
  const warnings = duplicates.filter((m) => m.kind !== "exact");
  const blocked = !refused && hasHighMatch(warnings);
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

  function reset() {
    setInvoiceNumber("");
    setAmountNet("");
    setVatAmount("");
    setAmountTotal("");
    setTotalTouched(false);
    setDueTouched(false);
    setNote("");
    setDocumentId(NONE);
    setDocumentMissing(false);
    setNewGroup("");
  }

  async function submit() {
    const targetGroup = await resolveGroupId(groupId, newGroup);
    if (!targetGroup) return;
    const r = await create({
      groupId: targetGroup,
      partnerId,
      invoiceNumber: invoiceNumber.trim(),
      invoiceDate,
      dueDate: dueDate || undefined,
      currency: currency as (typeof CURRENCIES)[number],
      amountNet: amountNet.trim(),
      vatAmount: vatAmount.trim() || "0",
      amountTotal: amountTotal.trim(),
      basCode,
      vatRegistrationId: registrationId === NONE ? null : registrationId,
      documentId: documentId === NONE ? undefined : documentId,
      documentMissing,
      note: note.trim() || null,
      duplicateAck: blocked
        ? {
            entityIds: warnings.filter((m) => m.confidence === "high").map((m) => m.entityId),
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
    setAckNote("");
    toast.success(t("supplierInvoices.form.created", { key: created?.key ?? "" }));
    reset();
    onOpenChange(false);
    if (created) onCreated?.(created);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="new-supplier-invoice-dialog" className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("supplierInvoices.form.title")}</DialogTitle>
          <DialogDescription>{t("supplierInvoices.form.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {initial?.vendor && (
            <SupplierMatchCard
              vendor={initial.vendor}
              selectedId={partnerId}
              onUseMatch={setPartnerId}
              onCreated={(p) => {
                setExtraSuppliers((prev) => [
                  {
                    id: p.id,
                    name: p.name,
                    defaultCurrency: null,
                    defaultBasCategoryCode: null,
                    paymentTermsDays: null,
                  },
                  ...prev,
                ]);
                setPartnerId(p.id);
              }}
            />
          )}
          <div className="sm:col-span-2 grid grid-cols-[1fr_auto] items-end gap-2">
            <div>
              <label htmlFor={`${ids}-supplier`} className="mb-1 block text-xs font-medium">
                {t("supplierInvoices.form.supplier")}
              </label>
              <Select value={partnerId} onValueChange={(v) => v && setPartnerId(v)}>
                <SelectTrigger id={`${ids}-supplier`} className="w-full" data-testid="si-supplier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allSuppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void prefillFromLast()}
              disabled={copying || !partnerId}
              data-testid="copy-last"
            >
              {t("supplierInvoices.form.copyLast")}
            </Button>
          </div>
          <GroupPicker
            idPrefix={ids}
            label={t("supplierInvoices.form.group")}
            groups={groups}
            value={groupId}
            onChange={setGroupId}
            newDescription={newGroup}
            onNewDescription={setNewGroup}
          />
          <div>
            <label htmlFor={`${ids}-number`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.number")}
            </label>
            <Input
              id={`${ids}-number`}
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              required
              data-testid="si-number"
            />
          </div>
          <div>
            <label htmlFor={`${ids}-ccy`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.currency")}
            </label>
            <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
              <SelectTrigger id={`${ids}-ccy`} className="w-full" data-testid="si-currency">
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
          <div>
            <label htmlFor={`${ids}-date`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.invoiceDate")}
            </label>
            <Input
              id={`${ids}-date`}
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              required
              data-testid="si-date"
            />
          </div>
          <div>
            <label htmlFor={`${ids}-due`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.dueDate")}
              {!dueTouched && supplier ? (
                <span className="ml-1 text-muted-foreground">
                  {t("supplierInvoices.form.dueFromTerms", {
                    days: supplier.paymentTermsDays ?? DEFAULT_TERMS,
                  })}
                </span>
              ) : null}
            </label>
            <Input
              id={`${ids}-due`}
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueTouched(true);
                setDueDate(e.target.value);
              }}
              data-testid="si-due"
            />
          </div>
          <div>
            <label htmlFor={`${ids}-net`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.net")}
            </label>
            <Input
              id={`${ids}-net`}
              inputMode="decimal"
              value={amountNet}
              onChange={(e) => setAmountNet(e.target.value)}
              placeholder="1200.00"
              required
              data-testid="si-net"
            />
          </div>
          <div>
            <label htmlFor={`${ids}-vat`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.vat")}
            </label>
            <Input
              id={`${ids}-vat`}
              inputMode="decimal"
              value={vatAmount}
              onChange={(e) => setVatAmount(e.target.value)}
              placeholder="0.00"
              data-testid="si-vat"
            />
          </div>
          <div>
            <label htmlFor={`${ids}-total`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.total")}
            </label>
            <Input
              id={`${ids}-total`}
              inputMode="decimal"
              value={amountTotal}
              onChange={(e) => {
                setTotalTouched(true);
                setAmountTotal(e.target.value);
              }}
              required
              data-testid="si-total"
            />
          </div>
          <div>
            <label htmlFor={`${ids}-cat`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.category")}
            </label>
            <Select value={basCode} onValueChange={(v) => v && setBasCode(v)}>
              <SelectTrigger id={`${ids}-cat`} className="w-full" data-testid="si-category">
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
          </div>
          <div>
            <label htmlFor={`${ids}-reg`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.registration")}
            </label>
            <Select value={registrationId} onValueChange={(v) => setRegistrationId(v ?? NONE)}>
              <SelectTrigger id={`${ids}-reg`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("supplierInvoices.form.noRegistration")}</SelectItem>
                {registrations.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor={`${ids}-doc`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.document")}
            </label>
            <Select value={documentId} onValueChange={(v) => setDocumentId(v ?? NONE)}>
              <SelectTrigger id={`${ids}-doc`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("supplierInvoices.form.noDocument")}</SelectItem>
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
                  aria-label={t("supplierInvoices.form.documentMissing")}
                />
                <span>{t("supplierInvoices.form.documentMissing")}</span>
              </label>
            )}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${ids}-note`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.note")}
            </label>
            <Input id={`${ids}-note`} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {refused ? (
            <ExactNumberStop matches={taken} />
          ) : (
            <DuplicatePanel matches={warnings} ackNote={ackNote} onAckNote={setAckNote} />
          )}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                isPending ||
                creatingGroup ||
                !basCode ||
                !partnerId ||
                refused ||
                (blocked && !ackNote.trim())
              }
              data-testid="create-supplier-invoice"
            >
              {blocked
                ? t("documents.duplicate.panel.createAnyway")
                : t("supplierInvoices.form.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
