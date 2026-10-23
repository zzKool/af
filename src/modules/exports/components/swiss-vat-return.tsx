"use client";

// The Swiss VAT return page (specs/exports/spec.md US1–US3): registration and quarter, the FTA form row by row
// (copy a value, type the manual refs), the warnings, the drill-down (invoices and input sources), the CSV, and
// the declaration record — Declare (freezes the figures), Mark paid (with the vat_payment expense), undo both.
// D40 kit (F71): the quarter's state as <StateLabel> through state-family.ts, amounts through formatMoney (the
// plain decimal on data-amount), keys as <CodeChip>, country / credit note as <Tag>. The CSV is not a screen:
// swissVatCsv writes the stored decimals, unchanged (swiss-vat.pure.test.ts compares it with the pre-F71 file).
import { Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { extractError } from "@/kernel/errors/extract-error";
import { useLocale } from "@/kernel/i18n/locale-provider";
import { uiLanguage } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { StateIcon, StateLabel } from "@/kernel/ui/state-label";
import { CodeChip, Tag } from "@/kernel/ui/tags";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  declareSwissVatAction,
  getSwissVatReturnAction,
  markSwissVatPaidAction,
  saveSwissVatManualAction,
  undeclareSwissVatAction,
  unmarkSwissVatPaidAction,
} from "@/modules/exports/exports.actions";
import { declarationState, declarationStateFamily } from "@/modules/exports/state-family";
import { csvFileName, isManualRef, swissVatCsv } from "@/modules/exports/swiss-vat";
import type {
  ManualRef,
  ManualRefs,
  SwissVatDeclarationDto,
  SwissVatLine,
  SwissVatReturn,
} from "@/modules/exports/types";

export type DeclarationRow = Omit<SwissVatDeclarationDto, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};
export type ReturnData = Omit<SwissVatReturn, "declaration"> & {
  declaration: DeclarationRow | null;
};
export type PaymentOption = {
  id: string;
  key: string;
  label: string;
  date: string;
  amount: string;
  currency: string;
};

const SECTIONS: { id: SwissVatLine["section"]; titleKey: string }[] = [
  { id: "I", titleKey: "exports.vat.section.I" },
  { id: "II", titleKey: "exports.vat.section.II" },
  { id: "II-bis", titleKey: "exports.vat.section.IIbis" },
  { id: "III", titleKey: "exports.vat.section.III" },
];

const chf = (amount: string) => formatMoney(amount, "CHF");
/** a column whose header names the currency ("VAT (CHF)") or a secondary figure next to a full amount */
const bare = (amount: string) => formatMoney(amount, "CHF", { bare: true });

export function SwissVatReturnPage({
  registrations,
  periods,
  payments,
  initial,
  canWrite,
}: {
  registrations: { id: string; vatNumber: string }[];
  periods: string[];
  payments: PaymentOption[];
  initial: ReturnData | null;
  canWrite: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const ids = useId();
  const { effectiveLocale: locale } = useLocale();
  const lang = uiLanguage(locale ?? null);
  const [registrationId, setRegistrationId] = useState(
    initial?.registrationId ?? registrations[0]?.id ?? "",
  );
  const [period, setPeriod] = useState(initial?.period ?? periods[0] ?? "");
  const [data, setData] = useState<ReturnData | null>(initial);
  const [manual, setManual] = useState<ManualRefs>(initial?.declaration?.manual ?? {});
  const [declaredAt, setDeclaredAt] = useState(new Date().toISOString().slice(0, 10));
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [paymentId, setPaymentId] = useState<string>("");
  const { executeAsync: load } = useAction(getSwissVatReturnAction);
  const { executeAsync: saveManual } = useAction(saveSwissVatManualAction);
  const { executeAsync: declare, isPending: declaring } = useAction(declareSwissVatAction);
  const { executeAsync: undeclare } = useAction(undeclareSwissVatAction);
  const { executeAsync: markPaid, isPending: paying } = useAction(markSwissVatPaidAction);
  const { executeAsync: unmarkPaid } = useAction(unmarkSwissVatPaidAction);
  const declareDialog = useConfirmDialog({
    title: t("exports.vat.declare"),
    confirmLabel: t("exports.vat.declare"),
    variant: "default",
  });

  const reload = useCallback(async () => {
    if (!registrationId || !period) return;
    const r = await load({ registrationId, period });
    const error = extractError(r);
    if (error) return toast.error(error);
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    if (!d) return;
    const next: ReturnData = {
      ...d,
      declaration: d.declaration
        ? {
            ...d.declaration,
            createdAt: String(d.declaration.createdAt),
            updatedAt: String(d.declaration.updatedAt),
          }
        : null,
    };
    setData(next);
    setManual(next.declaration?.manual ?? {});
  }, [registrationId, period, load]);

  // the first render shows the server's data; a change of registration or period reloads
  const [loadedFor, setLoadedFor] = useState(`${registrationId}|${period}`);
  useEffect(() => {
    const key = `${registrationId}|${period}`;
    if (key === loadedFor) return;
    setLoadedFor(key);
    void reload();
  }, [registrationId, period, loadedFor, reload]);

  const declaration = data?.declaration ?? null;
  const state = declarationState(declaration);
  const declared = state !== "draft";
  const paid = state === "paid";
  const editable = canWrite && !declared;

  async function blurManual(ref: ManualRef, value: string) {
    const cleaned = value.trim().replace(",", ".");
    const current = declaration?.manual[ref] ?? "";
    if (cleaned === current || (!cleaned && !current)) return;
    const next = { ...manual, [ref]: cleaned };
    setManual(next);
    const r = await saveManual({ vatRegistrationId: registrationId, period, manual: next });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    await reload();
  }

  function downloadCsv() {
    if (!data) return;
    const blob = new Blob([swissVatCsv(data.lines, lang === "fr" ? "fr" : "en")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = csvFileName(period);
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("exports.vat.copied", { value }));
    } catch {
      toast.error(t("exports.vat.copyFailed"));
    }
  }

  function requestDeclare() {
    if (!data) return;
    const ref500 = data.lines.find((l) => l.ref === "500")?.amount ?? "0.00";
    declareDialog.confirm(
      async () => {
        // no figures sent: the server declares what it computes now (the confirm shows the same 500)
        const r = await declare({ vatRegistrationId: registrationId, period, declaredAt });
        const error = extractError(r);
        if (error) throw new Error(error);
        toast.success(t("exports.vat.declared", { period }));
        await reload();
        router.refresh();
      },
      { description: t("exports.vat.declareConfirm", { period, amount: chf(ref500) }) },
    );
  }

  async function doUndeclare() {
    const r = await undeclare({ vatRegistrationId: registrationId, period });
    const error = extractError(r);
    if (error) return toast.error(error);
    toast.success(t("exports.vat.undeclared", { period }));
    await reload();
    router.refresh();
  }

  async function doMarkPaid() {
    // with the vat_payment expense, paid on is the expense's date (derived on the server); else the typed date
    const r = await markPaid({
      vatRegistrationId: registrationId,
      period,
      ...(paymentId ? { paymentExpenseId: paymentId } : { paidAt }),
    });
    const error = extractError(r);
    if (error) return toast.error(error);
    toast.success(t("exports.vat.paid", { period }));
    await reload();
    router.refresh();
  }

  async function doUnmarkPaid() {
    const r = await unmarkPaid({ vatRegistrationId: registrationId, period });
    const error = extractError(r);
    if (error) return toast.error(error);
    await reload();
    router.refresh();
  }

  const payment = payments.find((p) => p.id === declaration?.paymentExpenseId) ?? null;

  return (
    <div className="flex flex-col gap-6" data-testid="swiss-vat-return">
      {/* registration, period, status, actions */}
      <div className="flex flex-wrap items-end gap-3">
        {registrations.length > 1 && (
          <div>
            <label htmlFor={`${ids}-reg`} className="mb-1 block text-xs font-medium">
              {t("exports.vat.registration")}
            </label>
            <Select value={registrationId} onValueChange={(v) => v && setRegistrationId(v)}>
              <SelectTrigger id={`${ids}-reg`} className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {registrations.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.vatNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <label htmlFor={`${ids}-period`} className="mb-1 block text-xs font-medium">
            {t("exports.vat.period")}
          </label>
          <Select value={period} onValueChange={(v) => v && setPeriod(v)}>
            <SelectTrigger id={`${ids}-period`} className="w-40" data-testid="vat-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periods.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {data && (
          <span className="flex h-8 items-center" data-testid="vat-status" data-state={state}>
            <StateLabel
              family={declarationStateFamily(state)}
              state={
                paid
                  ? t("exports.vat.status.paid", { date: declaration?.paidAt ?? "" })
                  : declared
                    ? t("exports.vat.status.declared", { date: declaration?.declaredAt ?? "" })
                    : t("exports.vat.status.draft")
              }
            />
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={downloadCsv}
            disabled={!data}
            data-testid="vat-csv"
          >
            {t("exports.vat.csv")}
          </Button>
          {canWrite && data && !declared && (
            <>
              <Input
                type="date"
                value={declaredAt}
                onChange={(e) => setDeclaredAt(e.target.value)}
                className="w-40"
                aria-label={t("exports.vat.declaredOn")}
              />
              <Button
                size="sm"
                onClick={requestDeclare}
                disabled={declaring}
                data-testid="vat-declare"
              >
                {t("exports.vat.declare")}
              </Button>
            </>
          )}
          {canWrite && declared && !paid && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void doUndeclare()}
                data-testid="vat-undeclare"
              >
                {t("exports.vat.undeclare")}
              </Button>
              <Input
                type="date"
                value={payments.find((p) => p.id === paymentId)?.date ?? paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                disabled={!!paymentId}
                className="w-40"
                aria-label={t("exports.vat.paidOn")}
              />
              <Select value={paymentId} onValueChange={(v) => setPaymentId(v ?? "")}>
                <SelectTrigger className="w-56" data-testid="vat-payment">
                  <SelectValue placeholder={t("exports.vat.paymentNone")} />
                </SelectTrigger>
                <SelectContent>
                  {payments.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.key} · {p.date} · {formatMoney(p.amount, p.currency)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={() => void doMarkPaid()}
                disabled={paying}
                data-testid="vat-mark-paid"
              >
                {t("exports.vat.markPaid")}
              </Button>
            </>
          )}
          {canWrite && paid && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void doUnmarkPaid()}
              data-testid="vat-unmark-paid"
            >
              {t("exports.vat.unmarkPaid")}
            </Button>
          )}
        </div>
      </div>

      {payment && (
        <p className="text-sm text-muted-foreground">
          {t("exports.vat.paidWith", { key: payment.key, label: payment.label })}
        </p>
      )}

      {data && data.warnings.length > 0 && (
        <ul
          className="flex flex-col gap-1.5 rounded-lg bg-tag px-3 py-2 text-[13px]"
          data-testid="vat-warnings"
        >
          {data.warnings.map((w) => (
            <li key={`${w.type}-${w.message}`} className="flex items-start gap-2">
              <StateIcon family="attention" className="mt-0.5" />
              <CodeChip className="bg-surface">{w.type}</CodeChip>
              <span className="min-w-0">{w.message}</span>
            </li>
          ))}
        </ul>
      )}

      {!data ? (
        <p className="text-sm text-muted-foreground">{t("exports.vat.noRegistration")}</p>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* the form */}
          <section className="flex flex-col gap-4" data-testid="vat-form">
            <h2 className="text-sm font-medium">
              {t("exports.vat.form", { period, vatNumber: data.vatNumber })}
              {declared && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {t("exports.vat.frozen")}
                </span>
              )}
            </h2>
            {SECTIONS.map((s) => (
              <div key={s.id} className="rounded-md border">
                <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium">
                  {t(s.titleKey as Parameters<typeof t>[0])}
                </div>
                <Table>
                  <TableBody>
                    {data.lines
                      .filter((l) => l.section === s.id)
                      .map((l) => (
                        <TableRow
                          key={l.ref}
                          data-testid={`vat-ref-${l.ref}`}
                          data-source={l.source}
                        >
                          <TableCell className="w-12 font-mono text-xs">{l.ref}</TableCell>
                          <TableCell>
                            <div className="text-sm">{lang === "fr" ? l.labelFr : l.labelEn}</div>
                            <div className="text-xs text-muted-foreground">
                              {lang === "fr" ? l.labelEn : l.labelFr}
                            </div>
                          </TableCell>
                          <TableCell className="w-28 text-right text-xs text-muted-foreground tabular-nums">
                            {l.base !== undefined ? bare(l.base) : ""}
                          </TableCell>
                          <TableCell className="w-36 text-right tabular-nums">
                            {editable && isManualRef(l.ref) ? (
                              <ManualInput
                                refId={l.ref}
                                value={manual[l.ref] ?? ""}
                                onBlur={blurManual}
                              />
                            ) : (
                              <span
                                className={l.source === "calc" ? "font-medium" : ""}
                                data-testid={`vat-amount-${l.ref}`}
                                data-amount={l.amount}
                              >
                                {chf(l.amount)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="w-10">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="size-7 p-0 text-muted-foreground"
                              onClick={() => void copy(l.amount)}
                              title={t("exports.vat.copy")}
                              aria-label={`${t("exports.vat.copy")} ${l.ref}`}
                            >
                              <Copy className="size-3.5" aria-hidden />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </section>

          {/* the drill-down */}
          <section className="flex flex-col gap-4">
            <div>
              <h2 className="mb-2 text-sm font-medium">
                {t("exports.vat.invoices", { count: data.invoices.length })}
              </h2>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("exports.vat.col.number")}</TableHead>
                      <TableHead>{t("exports.vat.col.client")}</TableHead>
                      <TableHead className="w-12">{t("exports.vat.col.country")}</TableHead>
                      <TableHead className="w-28">{t("exports.vat.col.date")}</TableHead>
                      <TableHead className="w-28 text-right">{t("exports.vat.col.net")}</TableHead>
                      <TableHead className="w-24 text-right">{t("exports.vat.col.vat")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.invoices.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-muted-foreground">
                          —
                        </TableCell>
                      </TableRow>
                    )}
                    {data.invoices.map((i) => (
                      <TableRow key={i.id} data-testid="vat-invoice">
                        <TableCell>
                          <span className="inline-flex items-center gap-1">
                            <CodeChip>{i.number}</CodeChip>
                            {i.type === "credit_note" && <Tag>CN</Tag>}
                          </span>
                        </TableCell>
                        <TableCell className="truncate">{i.client}</TableCell>
                        <TableCell>
                          {i.clientCountry ? (
                            <Tag>{i.clientCountry}</Tag>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums">{i.issueDate}</TableCell>
                        <TableCell
                          className="text-right tabular-nums"
                          title={i.conversion ? `${i.currency} × ${i.conversion.rate}` : undefined}
                        >
                          {chf(i.net)}
                          {i.conversion ? "*" : ""}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{bare(i.vat)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div>
              <h2 className="mb-2 text-sm font-medium">
                {t("exports.vat.inputSources", { count: data.inputSources.length })}
              </h2>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-44">{t("exports.vat.col.key")}</TableHead>
                      <TableHead>{t("exports.vat.col.label")}</TableHead>
                      <TableHead className="w-28">{t("exports.vat.col.date")}</TableHead>
                      <TableHead className="w-28 text-right">{t("exports.vat.col.net")}</TableHead>
                      <TableHead className="w-24 text-right">{t("exports.vat.col.vat")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.inputSources.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-muted-foreground">
                          —
                        </TableCell>
                      </TableRow>
                    )}
                    {data.inputSources.map((s) => (
                      <TableRow key={`${s.kind}:${s.id}`} data-testid="vat-source">
                        <TableCell>
                          <CodeChip>{s.key}</CodeChip>
                        </TableCell>
                        <TableCell className="truncate">{s.label}</TableCell>
                        <TableCell className="tabular-nums">{s.date}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(s.net, s.currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{bare(s.vat)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </section>
        </div>
      )}
      <ConfirmDialog {...declareDialog.dialogProps} />
    </div>
  );
}

function ManualInput({
  refId,
  value,
  onBlur,
}: {
  refId: ManualRef;
  value: string;
  onBlur: (ref: ManualRef, value: string) => Promise<void>;
}) {
  return (
    <Input
      className="h-7 text-right tabular-nums"
      inputMode="decimal"
      defaultValue={value}
      placeholder="0.00"
      onBlur={(e) => void onBlur(refId, e.target.value)}
      data-testid={`vat-manual-${refId}`}
    />
  );
}
