"use client";

// A fact that never touches the bank (prepaid service, forfait): date, description, signed amount, currency,
// optional typed rate; category / partner / note optional. The SEK base comes from the service.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useId, useState } from "react";
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
import { createManualEntryAction } from "@/modules/journal/journal.actions";
import { type CategoryOption, type PartnerOption, proposedCategory } from "./categorise-form";

const NONE = "__none__";

export function ManualEntryDialog({
  open,
  onOpenChange,
  today,
  categories,
  partners,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  categories: CategoryOption[];
  partners: PartnerOption[];
}) {
  const t = useT();
  const ids = useId();
  const router = useRouter();
  const [entryDate, setEntryDate] = useState(today);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<string>("SEK");
  const [rate, setRate] = useState("");
  const [basCode, setBasCode] = useState(NONE);
  const [partnerId, setPartnerId] = useState(NONE);
  const [note, setNote] = useState("");
  const { executeAsync, isPending } = useAction(createManualEntryAction);

  async function submit() {
    const r = await executeAsync({
      entryDate,
      description: description.trim(),
      amount: amount.trim(),
      currency: currency as (typeof CURRENCIES)[number],
      rate: rate.trim() || undefined,
      basCode: basCode === NONE ? null : basCode,
      partnerId: partnerId === NONE ? null : partnerId,
      note: note.trim() || null,
    });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("journal.manual.created"));
    setDescription("");
    setAmount("");
    setRate("");
    setNote("");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="manual-entry-dialog">
        <DialogHeader>
          <DialogTitle>{t("journal.manual.title")}</DialogTitle>
          <DialogDescription>{t("journal.manual.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div>
            <label htmlFor={`${ids}-date`} className="mb-1 block text-xs font-medium">
              {t("journal.manual.date")}
            </label>
            <Input
              id={`${ids}-date`}
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${ids}-desc`} className="mb-1 block text-xs font-medium">
              {t("journal.manual.descriptionField")}
            </label>
            <Input
              id={`${ids}-desc`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor={`${ids}-amount`} className="mb-1 block text-xs font-medium">
              {t("journal.manual.amount")}
            </label>
            <Input
              id={`${ids}-amount`}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="-1200.00"
              required
            />
          </div>
          <div>
            <label htmlFor={`${ids}-ccy`} className="mb-1 block text-xs font-medium">
              {t("journal.manual.currency")}
            </label>
            <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
              <SelectTrigger id={`${ids}-ccy`} className="w-full">
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
            <label htmlFor={`${ids}-rate`} className="mb-1 block text-xs font-medium">
              {t("journal.manual.rate")}
            </label>
            <Input
              id={`${ids}-rate`}
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              disabled={currency === "SEK"}
            />
          </div>
          <div>
            <label htmlFor={`${ids}-cat`} className="mb-1 block text-xs font-medium">
              {t("journal.form.category")}
            </label>
            <Select value={basCode} onValueChange={(v) => setBasCode(v ?? NONE)}>
              <SelectTrigger id={`${ids}-cat`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("journal.form.noCategory")}</SelectItem>
                {categories.map((c) => (
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
                // the partner's default category fills an empty category; the owner can change it before saving
                const proposed = proposedCategory(
                  basCode === NONE ? null : basCode,
                  next === NONE ? null : next,
                  partners,
                );
                if (proposed) setBasCode(proposed);
              }}
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
            <Input id={`${ids}-note`} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isPending} data-testid="manual-entry-create">
              {t("journal.manual.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
