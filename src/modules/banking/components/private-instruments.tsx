"use client";

// The owner's private instruments (F114, D60 — specs/linking/payment-record.md US4): the bank accounts with
// `role = owner_private` (`Private SE`, `Private CH`) — the payers of a private expense, reimbursed through a
// settlement; no CSV, no rows. Listed under the statement accounts with *Add private instrument*: an alias and a
// currency, the only place a payer is created.
import { Plus } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/kernel/i18n/use-t";
import { CURRENCIES } from "@/kernel/nav/constants";
import { Tag } from "@/kernel/ui/tags";
import { createPrivateAccountAction } from "@/modules/banking/bank-accounts.actions";

export type PrivateInstrument = { id: string; label: string; currency: string };

export function PrivateInstruments({ initial }: { initial: PrivateInstrument[] }) {
  const t = useT();
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState(false);
  const [alias, setAlias] = useState("");
  const [currency, setCurrency] = useState<string>(CURRENCIES[0]);
  const { executeAsync, isPending } = useAction(createPrivateAccountAction);

  const add = async () => {
    const r = await executeAsync({ alias, currency: currency as (typeof CURRENCIES)[number] });
    const error =
      (r.serverError as { message?: string } | undefined)?.message ?? r.data?.error?.message;
    if (error || !r.data?.data) {
      toast.error(error ?? t("settings.privateInstruments.createFailed"));
      return;
    }
    setItems((list) => [...list, r.data?.data as PrivateInstrument]);
    setAlias("");
    setOpen(false);
    toast.success(t("settings.privateInstruments.created", { name: alias }));
  };

  return (
    <section className="flex flex-col gap-3" data-testid="private-instruments">
      <div>
        <h2 className="text-lg font-semibold">{t("settings.privateInstruments.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("settings.privateInstruments.description")}
        </p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("settings.privateInstruments.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
              data-testid="private-instrument"
            >
              <span className="font-medium">{p.label}</span>
              <Tag>{p.currency}</Tag>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="private-alias">{t("settings.privateInstruments.alias")}</Label>
            <Input
              id="private-alias"
              data-testid="private-alias"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="Private EUR"
              className="w-48"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="private-currency">{t("settings.privateInstruments.currency")}</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="private-currency" className="w-28" data-testid="private-currency">
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
          <Button onClick={add} disabled={isPending || !alias.trim()} data-testid="private-create">
            {t("settings.privateInstruments.create")}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          onClick={() => setOpen(true)}
          className="self-start"
          data-testid="private-add"
        >
          <Plus className="mr-1 h-4 w-4" />
          {t("settings.privateInstruments.add")}
        </Button>
      )}
    </section>
  );
}
