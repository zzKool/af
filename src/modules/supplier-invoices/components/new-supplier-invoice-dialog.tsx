"use client";

// New supplier invoice (US1, US3): the supplier (its currency, terms, category and registration pre-fill), the
// group (or a new one inline), the supplier's number, the dates, net / VAT / total, the category, the VAT
// registration, the document from the inbox (or "no document"), a note. *Copy last* takes the supplier's latest
// invoice (amounts, category, registration — a new number and dates). The key and the base come from the service.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useId, useState } from "react";
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
import { createExpenseGroupAction } from "@/modules/expenses/ui";
import {
  copyLastSupplierInvoiceAction,
  createSupplierInvoiceAction,
} from "@/modules/supplier-invoices/supplier-invoices.actions";
import type {
  CategoryOption,
  DocumentOption,
  GroupOption,
  RegistrationOption,
  SupplierOption,
} from "@/modules/supplier-invoices/types";
import { groupLabel } from "./labels";

const NONE = "__none__";
const NEW_GROUP = "__new__";
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
  onCreated?: (invoice: { id: string; key: string }) => void;
}) {
  const t = useT();
  const ids = useId();
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [groupId, setGroupId] = useState(defaultGroupId ?? groups[0]?.id ?? NEW_GROUP);
  const [newGroup, setNewGroup] = useState("");
  const [partnerId, setPartnerId] = useState(suppliers[0]?.id ?? "");
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
  const { executeAsync: createGroup, isPending: creatingGroup } =
    useAction(createExpenseGroupAction);
  const { executeAsync: copyLast, isPending: copying } = useAction(copyLastSupplierInvoiceAction);

  useEffect(() => {
    if (open) setGroupId(defaultGroupId ?? groups[0]?.id ?? NEW_GROUP);
  }, [open, defaultGroupId, groups]);

  // the supplier's defaults pre-fill the currency, the category and the due date
  const supplier = suppliers.find((s) => s.id === partnerId);
  useEffect(() => {
    if (!supplier) return;
    if (supplier.defaultCurrency) setCurrency(supplier.defaultCurrency);
    if (
      supplier.defaultBasCategoryCode &&
      categories.some((c) => c.code === supplier.defaultBasCategoryCode)
    )
      setBasCode(supplier.defaultBasCategoryCode);
  }, [supplier, categories]);
  useEffect(() => {
    if (!dueTouched) setDueDate(addDays(invoiceDate, supplier?.paymentTermsDays ?? DEFAULT_TERMS));
  }, [invoiceDate, supplier, dueTouched]);
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
    let targetGroup = groupId;
    if (groupId === NEW_GROUP) {
      const g = await createGroup({ description: newGroup.trim() });
      const error = extractError(g);
      if (error) {
        toast.error(error);
        return;
      }
      targetGroup = g?.data?.data?.id ?? "";
    }
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
    });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const created = r?.data?.data;
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
                  {suppliers.map((s) => (
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
          <div className={groupId === NEW_GROUP ? "" : "sm:col-span-2"}>
            <label htmlFor={`${ids}-group`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.group")}
            </label>
            <Select value={groupId} onValueChange={(v) => v && setGroupId(v)}>
              <SelectTrigger id={`${ids}-group`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {groupLabel(g)}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_GROUP}>{t("expenses.form.newGroup")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {groupId === NEW_GROUP && (
            <div>
              <label htmlFor={`${ids}-newgroup`} className="mb-1 block text-xs font-medium">
                {t("expenses.form.newGroupDescription")}
              </label>
              <Input
                id={`${ids}-newgroup`}
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                required
                data-testid="new-group-description"
              />
            </div>
          )}
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
                {documents.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.businessKey} · {d.fileName}
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
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={isPending || creatingGroup || !basCode || !partnerId}
              data-testid="create-supplier-invoice"
            >
              {t("supplierInvoices.form.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
