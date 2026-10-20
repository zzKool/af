"use client";

// Edit mode of the sheet (D7): the same layout as the print, with inputs where the values sit. Owns the
// draft's state, autosaves on blur through `updateDraftAction` (header + lines wholesale), shows live
// totals from the pure arithmetic. The editor never decides the layout — it fills the sheet's slots.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useMemo, useRef, useState } from "react";
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
import { extractError } from "@/kernel/errors/extract-error";
import { SUPPORTED_UI_LANGUAGES, translator } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { updateDraftAction } from "@/modules/invoices/invoices.actions";
import { formatVatPercent, invoiceTotals, TotalsError } from "@/modules/invoices/totals";
import type { InvoiceDto, PrintedParties, PrintedReference } from "@/modules/invoices/types";
import {
  type Registration,
  registrationRates,
  vatTreatmentFor,
} from "@/modules/invoices/vat-treatment";
import { InvoiceSheet, type SheetDocument, sheetMoney } from "./invoice-sheet";
import { toSheetDocument } from "./sheet-document";

/** The DTO with its timestamps serialised (server → client). */
export type EditorInvoice = Omit<
  InvoiceDto,
  "issuedAt" | "sentAt" | "decidedAt" | "createdAt" | "updatedAt"
> & {
  issuedAt: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type LineState = {
  key: string;
  description: string;
  quantity: string;
  unit: "day";
  unitPrice: string;
  discountPercent: string;
  vatRate: string;
  rateSourceId: string | null;
};

type HeaderState = {
  issueDate: string;
  dueDate: string;
  periodLabel: string;
  language: string;
  vatRegistrationId: string;
  discountPercent: string;
  notes: string;
  paymentTermsText: string;
  printedReferences: PrintedReference[];
};

let keySeq = 0;
const newKey = () => `n${++keySeq}`;

export function InvoiceEditor({
  invoice,
  parties,
  numberHint,
  relatedNumber,
  registrations,
  partnerForVat,
}: {
  invoice: EditorInvoice;
  parties: PrintedParties;
  numberHint: string | null;
  relatedNumber: string | null;
  registrations: Registration[];
  partnerForVat: { address: { country?: string } | null; vatNumber: string | null };
}) {
  const tUi = useT();
  const router = useRouter();
  const [header, setHeader] = useState<HeaderState>({
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate ?? "",
    periodLabel: invoice.periodLabel ?? "",
    language: invoice.language,
    vatRegistrationId: invoice.vatRegistrationId ?? "",
    discountPercent: invoice.discountPercent ?? "",
    notes: invoice.notes ?? "",
    paymentTermsText: invoice.paymentTermsText ?? "",
    printedReferences: invoice.printedReferences,
  });
  const [lines, setLines] = useState<LineState[]>(
    invoice.lines.map((l) => ({
      key: l.id,
      description: l.description,
      quantity: l.quantity,
      unit: "day",
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent ?? "",
      vatRate: l.vatRate,
      rateSourceId: l.rateSourceId,
    })),
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const { executeAsync: save } = useAction(updateDraftAction);
  const latest = useRef({ header, lines });
  latest.current = { header, lines };

  const t = useMemo(() => translator(header.language), [header.language]);
  const registration = registrations.find((r) => r.id === header.vatRegistrationId) ?? null;
  const vat = useMemo(
    () => vatTreatmentFor(registration, partnerForVat),
    [registration, partnerForVat],
  );
  const rateOptions = useMemo(() => {
    const list = registrationRates(registration);
    return [...new Set(["0", ...list, ...lines.map((l) => l.vatRate)])].sort(
      (a, b) => Number(a) - Number(b),
    );
  }, [registration, lines]);

  // live totals — the same arithmetic the server stores
  const totals = useMemo(() => {
    try {
      return {
        ok: true as const,
        value: invoiceTotals(
          lines.map((l) => ({
            quantity: l.quantity || "0",
            unitPrice: l.unitPrice || "0",
            vatRate: l.vatRate || "0",
            discountPercent: l.discountPercent || null,
          })),
          header.discountPercent || null,
        ),
      };
    } catch (e) {
      return { ok: false as const, message: e instanceof TotalsError ? e.message : String(e) };
    }
  }, [lines, header.discountPercent]);

  const persist = useCallback(async () => {
    const { header: h, lines: ls } = latest.current;
    setSaveState("saving");
    const r = await save({
      id: invoice.id,
      issueDate: h.issueDate,
      dueDate: h.dueDate || null,
      periodLabel: h.periodLabel || null,
      language: h.language,
      vatRegistrationId: h.vatRegistrationId || null,
      discountPercent: h.discountPercent || null,
      notes: h.notes || null,
      paymentTermsText: h.paymentTermsText || null,
      printedReferences: h.printedReferences.filter((x) => x.label.trim() && x.value.trim()),
      lines: ls.map((l) => ({
        description: l.description,
        quantity: l.quantity || "0",
        unit: l.unit,
        unitPrice: l.unitPrice || "0",
        discountPercent: l.discountPercent || null,
        vatRate: l.vatRate || "0",
        rateSourceId: l.rateSourceId,
      })),
    });
    const error = extractError(r);
    if (error) {
      setSaveState("error");
      toast.error(error);
      return;
    }
    setSaveState("saved");
    router.refresh();
  }, [invoice.id, router, save]);

  const setH = <K extends keyof HeaderState>(k: K, v: HeaderState[K]) =>
    setHeader((prev) => ({ ...prev, [k]: v }));
  const setLine = (key: string, patch: Partial<LineState>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        key: newKey(),
        description: "",
        quantity: "1",
        unit: "day",
        unitPrice: prev[prev.length - 1]?.unitPrice ?? "0.00",
        discountPercent: "",
        vatRate: vat.rate,
        rateSourceId: null,
      },
    ]);
  };
  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
    queueMicrotask(() => void persist());
  };
  const duplicateLine = (key: string) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.key === key);
      if (i < 0) return prev;
      return [...prev.slice(0, i + 1), { ...prev[i], key: newKey() }, ...prev.slice(i + 1)];
    });
    queueMicrotask(() => void persist());
  };

  const doc: SheetDocument = toSheetDocument(
    {
      ...invoice,
      issueDate: header.issueDate,
      dueDate: header.dueDate || null,
      periodLabel: header.periodLabel || null,
      language: header.language,
      discountPercent: header.discountPercent || null,
      notes: header.notes || null,
      paymentTermsText: header.paymentTermsText || null,
      printedReferences: header.printedReferences,
      printedParties: null,
      subtotal: totals.ok ? totals.value.subtotal : invoice.subtotal,
      discountAmount: totals.ok ? totals.value.discountAmount : invoice.discountAmount,
      netAmount: totals.ok ? totals.value.net : invoice.netAmount,
      vatByRate: totals.ok ? totals.value.vatByRate : invoice.vatByRate,
      vatAmount: totals.ok ? totals.value.vat : invoice.vatAmount,
      totalAmount: totals.ok ? totals.value.total : invoice.totalAmount,
      lines: lines.map((l, i) => ({
        id: l.key,
        lineNo: i + 1,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent || null,
        discountAmount: totals.ok ? (totals.value.lines[i]?.discountAmount ?? "0.00") : "0.00",
        netAmount: totals.ok ? (totals.value.lines[i]?.net ?? "0.00") : "0.00",
        vatRate: l.vatRate,
        vatAmount: totals.ok ? (totals.value.lines[i]?.vatAmount ?? "0.00") : "0.00",
        periodStart: null,
        periodEnd: null,
        rateSourceId: l.rateSourceId,
      })),
      issuedAt: null,
      sentAt: null,
      decidedAt: null,
      createdAt: new Date(invoice.createdAt),
      updatedAt: new Date(invoice.updatedAt),
    },
    {
      parties: {
        ...parties,
        tenant: {
          ...parties.tenant,
          vatNumber: registration?.vatNumber ?? null,
          vatCountry: registration?.country ?? null,
        },
      },
      treatment: vat.treatment,
      numberHint,
      relatedNumber,
    },
  );

  const vatColumn = true;
  const inputCls = "h-7 border-dashed bg-transparent px-1 text-[11pt]";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {saveState === "saving" && "…"}
          {saveState === "saved" && tUi("invoices.saved")}
          {!totals.ok && <span className="text-destructive">{totals.message}</span>}
        </span>
      </div>
      <InvoiceSheet
        mode="edit"
        doc={doc}
        slots={{
          headerTools: (
            <div className="mt-2 flex justify-end gap-2 print:hidden">
              <Select
                value={header.language}
                onValueChange={(v) => {
                  if (v) {
                    setH("language", v);
                    queueMicrotask(() => void persist());
                  }
                }}
              >
                <SelectTrigger
                  className="h-7 w-20 text-xs"
                  aria-label={tUi("invoices.form.language")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_UI_LANGUAGES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={header.vatRegistrationId || "__none__"}
                onValueChange={(v) => {
                  setH("vatRegistrationId", !v || v === "__none__" ? "" : v);
                  queueMicrotask(() => void persist());
                }}
              >
                <SelectTrigger
                  className="h-7 w-44 text-xs"
                  aria-label={tUi("invoices.form.vatRegistration")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{tUi("invoices.form.noVatRegistration")}</SelectItem>
                  {registrations.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.country} · {r.vatNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ),
          issueDate: (
            <Input
              type="date"
              value={header.issueDate}
              onChange={(e) => setH("issueDate", e.target.value)}
              onBlur={() => void persist()}
              className={`${inputCls} w-40`}
              aria-label={tUi("invoices.form.issueDate")}
            />
          ),
          dueDate: (
            <Input
              type="date"
              value={header.dueDate}
              onChange={(e) => setH("dueDate", e.target.value)}
              onBlur={() => void persist()}
              className={`${inputCls} w-40`}
              aria-label={t("invoice.dueDate")}
            />
          ),
          periodLabel: (
            <Input
              value={header.periodLabel}
              onChange={(e) => setH("periodLabel", e.target.value)}
              onBlur={() => void persist()}
              placeholder={tUi("invoices.form.periodPlaceholder")}
              className={`${inputCls} w-48`}
              aria-label={tUi("invoices.form.period")}
            />
          ),
          references: (
            <div className="space-y-1">
              {header.printedReferences.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: editable list without ids
                <div key={i} className="flex gap-1">
                  <Input
                    value={r.label}
                    onChange={(e) =>
                      setH(
                        "printedReferences",
                        header.printedReferences.map((x, j) =>
                          j === i ? { ...x, label: e.target.value } : x,
                        ),
                      )
                    }
                    onBlur={() => void persist()}
                    className={`${inputCls} w-36`}
                    placeholder="Label"
                  />
                  <Input
                    value={r.value}
                    onChange={(e) =>
                      setH(
                        "printedReferences",
                        header.printedReferences.map((x, j) =>
                          j === i ? { ...x, value: e.target.value } : x,
                        ),
                      )
                    }
                    onBlur={() => void persist()}
                    className={`${inputCls} flex-1`}
                    placeholder="Value"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setH(
                        "printedReferences",
                        header.printedReferences.filter((_, j) => j !== i),
                      );
                      queueMicrotask(() => void persist());
                    }}
                  >
                    ×
                  </Button>
                </div>
              ))}
              {header.printedReferences.length < 10 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    setH("printedReferences", [
                      ...header.printedReferences,
                      { label: "", value: "" },
                    ])
                  }
                >
                  + {tUi("invoices.form.addReference")}
                </Button>
              )}
            </div>
          ),
          lines: (
            <table className="w-full border-collapse text-left">
              <thead className="border-b border-black">
                <tr>
                  <th className="py-1 pr-2 font-semibold">{t("invoice.table.description")}</th>
                  <th className="w-24 py-1 pr-2 text-center font-semibold">
                    {t("invoice.table.quantity")}
                  </th>
                  <th className="w-32 py-1 pr-2 text-right font-semibold">
                    {t("invoice.table.unitPrice")}
                  </th>
                  <th className="w-20 py-1 pr-2 text-right font-semibold">
                    {t("invoice.totals.discount")} %
                  </th>
                  {vatColumn && (
                    <th className="w-24 py-1 pr-2 text-right font-semibold">
                      {t("invoice.table.vatPercent")}
                    </th>
                  )}
                  <th className="w-32 py-1 text-right font-semibold">
                    {t("invoice.table.amount")}
                  </th>
                  <th className="w-16 py-1" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr
                    key={l.key}
                    className="border-b border-neutral-200 align-top"
                    data-testid="line-row"
                  >
                    <td className="py-1 pr-2">
                      <Input
                        value={l.description}
                        onChange={(e) => setLine(l.key, { description: e.target.value })}
                        onBlur={() => void persist()}
                        placeholder={tUi("invoices.line.descriptionPlaceholder")}
                        className={`${inputCls} w-full`}
                        aria-label={t("invoice.table.description")}
                      />
                      {l.rateSourceId && (
                        <div className="mt-0.5 text-[8pt] text-neutral-500">
                          {tUi("invoices.line.fromContractRate")}
                        </div>
                      )}
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        inputMode="decimal"
                        value={l.quantity}
                        onChange={(e) =>
                          setLine(l.key, { quantity: e.target.value.replace(",", ".") })
                        }
                        onBlur={() => void persist()}
                        className={`${inputCls} text-center`}
                        aria-label={t("invoice.table.quantity")}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        inputMode="decimal"
                        value={l.unitPrice}
                        onChange={(e) =>
                          setLine(l.key, {
                            unitPrice: e.target.value.replace(",", "."),
                            rateSourceId: null,
                          })
                        }
                        onBlur={() => void persist()}
                        className={`${inputCls} text-right`}
                        aria-label={t("invoice.table.unitPrice")}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        inputMode="decimal"
                        value={l.discountPercent}
                        onChange={(e) =>
                          setLine(l.key, { discountPercent: e.target.value.replace(",", ".") })
                        }
                        onBlur={() => void persist()}
                        className={`${inputCls} text-right`}
                        aria-label={`${t("invoice.totals.discount")} %`}
                      />
                    </td>
                    {vatColumn && (
                      <td className="py-1 pr-2">
                        <Select
                          value={l.vatRate}
                          onValueChange={(v) => {
                            if (v) {
                              setLine(l.key, { vatRate: v });
                              queueMicrotask(() => void persist());
                            }
                          }}
                        >
                          <SelectTrigger
                            className="h-7 w-full justify-end border-dashed bg-transparent px-1 text-[11pt]"
                            aria-label={t("invoice.table.vatPercent")}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {rateOptions.map((r) => (
                              <SelectItem key={r} value={r}>
                                {formatVatPercent(r)}%
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    )}
                    <td className="py-1 text-right tabular-nums" data-testid="line-net">
                      {totals.ok
                        ? sheetMoney(totals.value.lines[i]?.net ?? "0.00", invoice.currency)
                        : "—"}
                    </td>
                    <td className="py-1 text-right whitespace-nowrap">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        title={tUi("invoices.line.duplicate")}
                        onClick={() => duplicateLine(l.key)}
                      >
                        ⧉
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        title={tUi("invoices.line.remove")}
                        onClick={() => removeLine(l.key)}
                        disabled={lines.length <= 1}
                      >
                        ×
                      </Button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={7} className="py-1">
                    <Button type="button" variant="outline" size="xs" onClick={addLine}>
                      + {tUi("invoices.line.add")}
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          ),
          discount: (
            <Input
              inputMode="decimal"
              value={header.discountPercent}
              onChange={(e) => setH("discountPercent", e.target.value.replace(",", "."))}
              onBlur={() => void persist()}
              placeholder="0"
              className={`${inputCls} ml-2 inline-block w-14 text-right`}
              aria-label={tUi("invoices.form.discountPercent")}
            />
          ),
          notes: (
            <textarea
              value={header.notes}
              onChange={(e) => setH("notes", e.target.value)}
              onBlur={() => void persist()}
              placeholder={tUi("invoices.form.notes")}
              className="w-full rounded border border-dashed bg-transparent p-1 text-[11pt]"
              rows={2}
              aria-label={tUi("invoices.form.notes")}
            />
          ),
          paymentTerms: (
            <textarea
              value={header.paymentTermsText}
              onChange={(e) => setH("paymentTermsText", e.target.value)}
              onBlur={() => void persist()}
              placeholder={
                doc.paymentTermsDays !== null
                  ? t("invoice.payment.termsDefault", { days: doc.paymentTermsDays })
                  : tUi("invoices.form.paymentTermsText")
              }
              className="w-full rounded border border-dashed bg-transparent p-1 text-[10pt]"
              rows={1}
              aria-label={tUi("invoices.form.paymentTermsText")}
            />
          ),
        }}
      />
    </div>
  );
}
