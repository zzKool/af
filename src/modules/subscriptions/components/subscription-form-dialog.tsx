"use client";

// *New subscription* (F94 US1, FR-013): describe a recurring cost once. The vendor proposes its default category and
// currency — never over what the owner chose (D49's rule); the group defaults to a new batch group named after the
// subscription (Q2 B); a supplier invoice is paid from a company account (US1-2); the match text defaults to the
// vendor's name. *Make it recurring* (US1-5) opens the same form with `initial` and an `entity` to attribute.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import type { SubscriptionPageOptions } from "../page-data";
import { createSubscriptionAction, makeRecurringAction } from "../subscriptions.actions";
import type { Becomes, Cadence } from "../types";

const NONE = "__none__";
const NEW_GROUP = "__new__";

export type SubscriptionFormInitial = {
  name?: string;
  partnerId?: string;
  becomes?: Becomes;
  basCode?: string;
  groupId?: string;
  paidFromAccountId?: string;
  startDate?: string;
  amount?: string;
  currency?: string;
  /** *Make it recurring*: the expense / supplier invoice that becomes the first period */
  entity?: { type: Becomes; id: string; key: string };
};

const label = "mb-1 block text-xs font-medium";

export function SubscriptionFormDialog({
  open,
  onOpenChange,
  options,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: SubscriptionPageOptions;
  initial?: SubscriptionFormInitial | null;
}) {
  const t = useT();
  const ids = useId();
  const router = useRouter();
  const { executeAsync: create, isPending: creating } = useAction(createSubscriptionAction);
  const { executeAsync: recurring, isPending: linking } = useAction(makeRecurringAction);

  const [name, setName] = useState("");
  const [partnerId, setPartnerId] = useState(NONE);
  const [becomes, setBecomes] = useState<Becomes>("expense");
  const [basCode, setBasCode] = useState(NONE);
  const [basFromPartner, setBasFromPartner] = useState(false);
  const [groupId, setGroupId] = useState(NEW_GROUP);
  const [sourceId, setSourceId] = useState(NONE);
  const [registrationId, setRegistrationId] = useState(NONE);
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<string>(CURRENCIES[0]);
  const [currencyFromPartner, setCurrencyFromPartner] = useState(true);
  const [tolerance, setTolerance] = useState("5");
  const [matchText, setMatchText] = useState("");
  const [matchTouched, setMatchTouched] = useState(false);
  const [note, setNote] = useState("");

  // a fresh form every time it opens, from `initial` when given
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setPartnerId(initial?.partnerId ?? NONE);
    setBecomes(initial?.becomes ?? "expense");
    setBasCode(initial?.basCode ?? NONE);
    setBasFromPartner(false);
    setGroupId(initial?.groupId ?? NEW_GROUP);
    setSourceId(initial?.paidFromAccountId ?? NONE);
    setRegistrationId(NONE);
    setCadence("monthly");
    setStartDate(initial?.startDate ?? "");
    setEndDate("");
    setAmount(initial?.amount ?? "");
    setCurrency(initial?.currency ?? CURRENCIES[0]);
    setCurrencyFromPartner(!initial?.currency);
    setTolerance("5");
    setMatchText("");
    setMatchTouched(false);
    setNote("");
  }, [open, initial]);

  const sources =
    becomes === "supplier_invoice"
      ? options.sources.filter((s) => s.kind === "bank_account")
      : options.sources;

  function pickVendor(id: string) {
    setPartnerId(id);
    const v = options.vendors.find((x) => x.id === id);
    // a proposal never replaces the owner's choice (D49): only an empty or partner-proposed value moves
    if (v?.defaultBasCategoryCode && (basCode === NONE || basFromPartner)) {
      setBasCode(v.defaultBasCategoryCode);
      setBasFromPartner(true);
    }
    if (v?.defaultCurrency && currencyFromPartner) setCurrency(v.defaultCurrency);
    if (v && !matchTouched) setMatchText(v.name);
    if (v && !name) setName(v.name);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (partnerId === NONE || basCode === NONE || sourceId === NONE) {
      toast.error(t("subscriptions.form.missing"));
      return;
    }
    const subscription = {
      name: name.trim(),
      partnerId,
      becomes,
      basCode,
      ...(groupId === NEW_GROUP ? { newGroup: { description: name.trim() } } : { groupId }),
      paidFromAccountId: sourceId,
      vatRegistrationId: registrationId === NONE ? null : registrationId,
      cadence,
      startDate,
      endDate: endDate || null,
      matchText: matchText.trim() || null,
      tolerancePct: tolerance.trim() || "5",
      note: note.trim() || null,
      price: { amount: amount.trim(), currency: currency as (typeof CURRENCIES)[number] },
    };
    const r = initial?.entity
      ? await recurring({
          entity: { type: initial.entity.type, id: initial.entity.id },
          subscription,
        })
      : await create(subscription);
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("subscriptions.form.created"));
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="subscription-form" className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {initial?.entity
              ? t("subscriptions.form.recurringTitle", { key: initial.entity.key })
              : t("subscriptions.form.title")}
          </DialogTitle>
          <DialogDescription>{t("subscriptions.form.description")}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => void submit(e)}>
          <div className="sm:col-span-2">
            <label htmlFor={`${ids}-vendor`} className={label}>
              {t("subscriptions.form.vendor")}
            </label>
            <Select value={partnerId} onValueChange={(v) => v && pickVendor(v)}>
              <SelectTrigger id={`${ids}-vendor`} className="w-full" data-testid="sub-vendor">
                <SelectValue>
                  {options.vendors.find((v) => v.id === partnerId)?.name ?? "—"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {options.vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${ids}-name`} className={label}>
              {t("subscriptions.form.name")}
            </label>
            <Input
              id={`${ids}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
              data-testid="sub-name"
            />
          </div>
          <div>
            <label htmlFor={`${ids}-becomes`} className={label}>
              {t("subscriptions.form.becomes")}
            </label>
            <Select
              value={becomes}
              onValueChange={(v) => {
                setBecomes(v as Becomes);
                if (
                  v === "supplier_invoice" &&
                  options.sources.find((s) => s.id === sourceId)?.kind === "private"
                )
                  setSourceId(NONE);
              }}
            >
              <SelectTrigger id={`${ids}-becomes`} className="w-full" data-testid="sub-becomes">
                <SelectValue>{t(`subscriptions.becomes.${becomes}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">{t("subscriptions.becomes.expense")}</SelectItem>
                <SelectItem value="supplier_invoice">
                  {t("subscriptions.becomes.supplier_invoice")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor={`${ids}-payer`} className={label}>
              {t("subscriptions.form.payer")}
            </label>
            <Select value={sourceId} onValueChange={(v) => v && setSourceId(v)}>
              <SelectTrigger id={`${ids}-payer`} className="w-full" data-testid="sub-payer">
                <SelectValue>{sources.find((s) => s.id === sourceId)?.label ?? "—"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {becomes === "supplier_invoice" && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("subscriptions.form.payerCompanyOnly")}
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${ids}-cat`} className={label}>
              {t("subscriptions.form.category")}
              {basFromPartner && (
                <span className="ml-1 font-normal text-muted-foreground">
                  · {t("subscriptions.form.fromPartner")}
                </span>
              )}
            </label>
            <Select
              value={basCode}
              onValueChange={(v) => {
                if (!v) return;
                setBasCode(v);
                setBasFromPartner(false);
              }}
            >
              <SelectTrigger id={`${ids}-cat`} className="w-full" data-testid="sub-category">
                <SelectValue>
                  {options.categories.find((c) => c.code === basCode)?.label ?? "—"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {options.categories.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${ids}-group`} className={label}>
              {t("subscriptions.form.group")}
            </label>
            <Select value={groupId} onValueChange={(v) => v && setGroupId(v)}>
              <SelectTrigger id={`${ids}-group`} className="w-full" data-testid="sub-group">
                <SelectValue>
                  {groupId === NEW_GROUP
                    ? t("subscriptions.form.newGroup", { name: name.trim() || "…" })
                    : (options.groups.find((g) => g.id === groupId)?.label ?? "—")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_GROUP}>
                  {t("subscriptions.form.newGroup", { name: name.trim() || "…" })}
                </SelectItem>
                {options.groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor={`${ids}-cadence`} className={label}>
              {t("subscriptions.form.cadence")}
            </label>
            <Select value={cadence} onValueChange={(v) => v && setCadence(v as Cadence)}>
              <SelectTrigger id={`${ids}-cadence`} className="w-full" data-testid="sub-cadence">
                <SelectValue>{t(`subscriptions.cadence.${cadence}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">{t("subscriptions.cadence.monthly")}</SelectItem>
                <SelectItem value="yearly">{t("subscriptions.cadence.yearly")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`${ids}-start`} className={label}>
                {t("subscriptions.form.start")}
              </label>
              <Input
                id={`${ids}-start`}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                data-testid="sub-start"
              />
            </div>
            <div>
              <label htmlFor={`${ids}-end`} className={label}>
                {t("subscriptions.form.end")}
              </label>
              <Input
                id={`${ids}-end`}
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <div>
              <label htmlFor={`${ids}-amount`} className={label}>
                {t("subscriptions.form.price")}
              </label>
              <Input
                id={`${ids}-amount`}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="tabular-nums"
                data-testid="sub-amount"
              />
            </div>
            <div>
              <label htmlFor={`${ids}-ccy`} className={label}>
                {t("subscriptions.form.currency")}
              </label>
              <Select
                value={currency}
                onValueChange={(v) => {
                  if (!v) return;
                  setCurrency(v);
                  setCurrencyFromPartner(false);
                }}
              >
                <SelectTrigger id={`${ids}-ccy`} className="w-full" data-testid="sub-currency">
                  <SelectValue>{currency}</SelectValue>
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
            <label htmlFor={`${ids}-tol`} className={label}>
              {t("subscriptions.form.tolerance")}
            </label>
            <Input
              id={`${ids}-tol`}
              inputMode="decimal"
              value={tolerance}
              onChange={(e) => setTolerance(e.target.value)}
              className="tabular-nums"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${ids}-match`} className={label}>
              {t("subscriptions.form.matchText")}
            </label>
            <Input
              id={`${ids}-match`}
              value={matchText}
              onChange={(e) => {
                setMatchText(e.target.value);
                setMatchTouched(true);
              }}
              maxLength={100}
              data-testid="sub-match"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("subscriptions.form.matchTextHint")}
            </p>
          </div>
          {becomes === "supplier_invoice" && options.registrations.length > 0 && (
            <div className="sm:col-span-2">
              <label htmlFor={`${ids}-reg`} className={label}>
                {t("subscriptions.form.registration")}
              </label>
              <Select value={registrationId} onValueChange={(v) => v && setRegistrationId(v)}>
                <SelectTrigger id={`${ids}-reg`} className="w-full">
                  <SelectValue>
                    {options.registrations.find((r) => r.id === registrationId)?.label ?? "—"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {options.registrations.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="sm:col-span-2">
            <label htmlFor={`${ids}-note`} className={label}>
              {t("subscriptions.form.note")}
            </label>
            <Input
              id={`${ids}-note`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={creating || linking} data-testid="sub-create">
              {t("subscriptions.form.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
