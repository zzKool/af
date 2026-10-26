"use client";

// The panel's lower sections (F94 US5): the dated prices (a new price from a date closes the previous one, the
// contract-rate rule; the latest can be removed), the pauses (a note each; the periods in them are skipped), and the
// facts later confirms use (match text, tolerance, note) — saved on blur.
import { useAction } from "next-safe-action/hooks";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { formatMoney } from "@/kernel/money/format-money";
import { CURRENCIES, type Currency } from "@/kernel/nav/constants";
import {
  addSubscriptionPauseAction,
  addSubscriptionPriceAction,
  removeSubscriptionPauseAction,
  removeSubscriptionPriceAction,
  updateSubscriptionAction,
} from "../subscriptions.actions";
import type { SubscriptionDetailWire } from "../types";

const label = "mb-1 block text-xs font-medium";

function useRun(onChanged: () => void) {
  return async (p: Promise<unknown>, done: string) => {
    const error = extractError(await p);
    if (error) {
      toast.error(error);
      return false;
    }
    toast.success(done);
    onChanged();
    return true;
  };
}

export function SubscriptionPrices({
  detail,
  canWrite,
  onChanged,
}: {
  detail: SubscriptionDetailWire;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const ids = useId();
  const run = useRun(onChanged);
  const latest = detail.prices.at(-1);
  const [from, setFrom] = useState(() => createClock().today());
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>(
    (latest?.currency as Currency) ?? CURRENCIES[0],
  );
  const { executeAsync: add, isPending } = useAction(addSubscriptionPriceAction);
  const { executeAsync: remove } = useAction(removeSubscriptionPriceAction);

  return (
    <div className="grid gap-2 text-[13px]">
      <ul className="divide-y divide-subtle" data-testid="price-list">
        {detail.prices.map((p) => (
          <li key={p.id} className="flex items-center gap-2 py-1">
            <span className="tabular-nums">
              {p.validFrom} → {p.validTo ?? "…"}
            </span>
            <span className="ml-auto tabular-nums">{formatMoney(p.amount, p.currency)}</span>
            {canWrite && detail.prices.length > 1 && p.id === latest?.id && (
              <Button
                size="sm"
                variant="link"
                className="h-auto p-0"
                onClick={() =>
                  void run(remove({ id: p.id }), t("subscriptions.panel.priceRemoved"))
                }
              >
                {t("subscriptions.panel.removePrice")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <form
          className="grid grid-cols-[1fr_1fr_5rem_auto] items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              add({ subscriptionId: detail.subscription.id, validFrom: from, amount, currency }),
              t("subscriptions.panel.priceAdded"),
            ).then((ok) => ok && setAmount(""));
          }}
        >
          <div>
            <label htmlFor={`${ids}-from`} className={label}>
              {t("subscriptions.panel.newPriceFrom")}
            </label>
            <Input
              id={`${ids}-from`}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={`${ids}-amount`} className={label}>
              {t("subscriptions.form.price")}
            </label>
            <Input
              id={`${ids}-amount`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="tabular-nums"
              required
            />
          </div>
          <div>
            <label htmlFor={`${ids}-ccy`} className={label}>
              {t("subscriptions.form.currency")}
            </label>
            <Select value={currency} onValueChange={(v) => v && setCurrency(v as Currency)}>
              <SelectTrigger id={`${ids}-ccy`} className="w-full">
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
          <Button type="submit" size="sm" disabled={isPending}>
            {t("subscriptions.panel.addPrice")}
          </Button>
        </form>
      )}
    </div>
  );
}

export function SubscriptionPauses({
  detail,
  canWrite,
  onChanged,
}: {
  detail: SubscriptionDetailWire;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const ids = useId();
  const run = useRun(onChanged);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const { executeAsync: add, isPending } = useAction(addSubscriptionPauseAction);
  const { executeAsync: remove } = useAction(removeSubscriptionPauseAction);

  return (
    <div className="grid gap-2 text-[13px]">
      {detail.pauses.length === 0 ? (
        <p className="text-muted-foreground">{t("subscriptions.panel.noPauses")}</p>
      ) : (
        <ul className="divide-y divide-subtle">
          {detail.pauses.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-1">
              <span className="tabular-nums">
                {p.fromDate} → {p.toDate}
              </span>
              <span className="truncate text-muted-foreground">{p.note}</span>
              {canWrite && (
                <Button
                  size="sm"
                  variant="link"
                  className="ml-auto h-auto p-0"
                  onClick={() =>
                    void run(remove({ id: p.id }), t("subscriptions.panel.pauseRemoved"))
                  }
                >
                  {t("subscriptions.panel.removePause")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form
          className="grid grid-cols-2 items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              add({ subscriptionId: detail.subscription.id, fromDate: from, toDate: to, note }),
              t("subscriptions.panel.pauseAdded"),
            ).then((ok) => {
              if (ok) {
                setFrom("");
                setTo("");
                setNote("");
              }
            });
          }}
        >
          <div>
            <label htmlFor={`${ids}-pfrom`} className={label}>
              {t("subscriptions.panel.pauseFrom")}
            </label>
            <Input
              id={`${ids}-pfrom`}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor={`${ids}-pto`} className={label}>
              {t("subscriptions.panel.pauseTo")}
            </label>
            <Input
              id={`${ids}-pto`}
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            />
          </div>
          <div className="col-span-2 grid grid-cols-[1fr_auto] items-end gap-2">
            <div>
              <label htmlFor={`${ids}-pnote`} className={label}>
                {t("subscriptions.panel.pauseNote")}
              </label>
              <Input
                id={`${ids}-pnote`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required
              />
            </div>
            <Button type="submit" size="sm" disabled={isPending}>
              {t("subscriptions.panel.addPause")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function SubscriptionFacts({
  detail,
  onChanged,
}: {
  detail: SubscriptionDetailWire;
  onChanged: () => void;
}) {
  const t = useT();
  const ids = useId();
  const run = useRun(onChanged);
  const s = detail.subscription;
  const { executeAsync: update } = useAction(updateSubscriptionAction);
  const [matchText, setMatchText] = useState(s.matchText ?? "");
  const [tolerance, setTolerance] = useState(s.tolerancePct);
  const [note, setNote] = useState(s.note ?? "");
  const save = (patch: Record<string, string | null>) =>
    void run(update({ id: s.id, patch }), t("subscriptions.panel.saved"));

  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">{t("subscriptions.panel.factsHint")}</p>
      <div>
        <label htmlFor={`${ids}-match`} className={label}>
          {t("subscriptions.form.matchText")}
        </label>
        <Input
          id={`${ids}-match`}
          value={matchText}
          onChange={(e) => setMatchText(e.target.value)}
          onBlur={() =>
            matchText !== (s.matchText ?? "") && save({ matchText: matchText.trim() || null })
          }
        />
      </div>
      <div>
        <label htmlFor={`${ids}-tol`} className={label}>
          {t("subscriptions.form.tolerance")}
        </label>
        <Input
          id={`${ids}-tol`}
          value={tolerance}
          onChange={(e) => setTolerance(e.target.value)}
          onBlur={() => tolerance !== s.tolerancePct && save({ tolerancePct: tolerance.trim() })}
          className="tabular-nums"
        />
      </div>
      <div>
        <label htmlFor={`${ids}-note`} className={label}>
          {t("subscriptions.form.note")}
        </label>
        <Input
          id={`${ids}-note`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (s.note ?? "") && save({ note: note.trim() || null })}
        />
      </div>
    </div>
  );
}
