"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
// Edit mode of the sheet (D7): the same layout as the print, with inputs where the values sit. Owns the
// draft's state, autosaves on blur through `updateDraftAction` (header + lines wholesale), shows live
// totals from the pure arithmetic. The editor never decides the layout — it fills the sheet's slots.
import { DateInput } from "@/components/ui/date-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";
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
  /** F168: the days the line bills, as picked on the studio's calendar */
  workedDays: string[];
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

/** What the studio reads of the draft being edited (F143). */
export type EditorDraft = {
  language: string;
  periodLabel: string;
  issueDate: string;
  printedReferences: PrintedReference[];
  lines: { description: string; quantity: string; unitPrice: string; vatRate: string }[];
  registration: Registration | null;
  treatment: ReturnType<typeof vatTreatmentFor>["treatment"];
  total: string | null;
};

/** the draft's total as the server would store it, or null while a line does not compute */
function liveTotal(
  lines: { quantity: string; unitPrice: string; vatRate: string; discountPercent: string }[],
  discountPercent: string,
): string | null {
  try {
    return invoiceTotals(
      lines.map((l) => ({
        quantity: l.quantity || "0",
        unitPrice: l.unitPrice || "0",
        vatRate: l.vatRate || "0",
        discountPercent: l.discountPercent || null,
      })),
      discountPercent || null,
    ).total;
  } catch {
    return null;
  }
}

let keySeq = 0;
const newKey = () => `n${++keySeq}`;

export function InvoiceEditor({
  invoice,
  parties,
  numberHint,
  relatedNumber,
  registrations,
  partnerForVat,
  onDraft,
  toolbar,
  daysRequest,
}: {
  /** F160: the studio's days calendar — when `seq` changes, the first line's quantity becomes `value` (saved) */
  /** F168: the days picked on the studio's calendar, for the first line */
  daysRequest?: { days: string[]; seq: number } | null;
  /** F145: more controls in the toolbar above the paper (the PDF preview) */
  toolbar?: ReactNode;
  /** F143: the draft as the owner types it — the studio's *Ready to send?* reads it live */
  onDraft?: (draft: EditorDraft) => void;
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
      workedDays: l.workedDays,
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

  // F143: hand the draft up as it changes (the studio's checklist)
  useEffect(() => {
    onDraft?.({
      language: header.language,
      periodLabel: header.periodLabel,
      issueDate: header.issueDate,
      printedReferences: header.printedReferences,
      lines: lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        vatRate: l.vatRate,
      })),
      registration,
      treatment: vat.treatment,
      total: liveTotal(lines, header.discountPercent),
    });
  }, [header, lines, registration, vat.treatment, onDraft]);

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
        workedDays: l.workedDays,
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

  // F160 / F168: the days calendar sets the first line's days and its quantity (their count) — applied once per
  // request, then saved
  const appliedSeq = useRef(daysRequest?.seq ?? 0);
  useEffect(() => {
    if (!daysRequest || daysRequest.seq === appliedSeq.current) return;
    appliedSeq.current = daysRequest.seq;
    const prev = latest.current.lines;
    if (prev.length === 0) return;
    const days = [...daysRequest.days].sort();
    const next = [
      { ...(prev[0] as LineState), quantity: String(days.length), workedDays: days },
      ...prev.slice(1),
    ];
    setLines(next);
    latest.current = { ...latest.current, lines: next }; // persist reads it before the next render
    void persist();
  }, [daysRequest, persist]);

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
        workedDays: [],
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
      return [
        ...prev.slice(0, i + 1),
        { ...(prev[i] as LineState), key: newKey(), workedDays: [] },
        ...prev.slice(i + 1),
      ];
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
        workedDays: l.workedDays,
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

  // F145: fields sit where the values print, tinted so they read as editable; the paper stays the invoice
  const field =
    "rounded-[3px] border border-transparent bg-[#eef4ff] px-1 py-0.5 text-inherit outline-none hover:border-[#c7d2fe] focus:border-[#2563eb] focus:bg-white";
  const [showDiscount, setShowDiscount] = useState(header.discountPercent !== "");
  const [showNotes, setShowNotes] = useState(header.notes !== "");
  // F146: a discount and a VAT rate per line, on demand — not a column of zeros on every invoice
  const [lineDiscounts, setLineDiscounts] = useState<Set<string>>(
    () => new Set(lines.filter((l) => Number(l.discountPercent || 0) !== 0).map((l) => l.key)),
  );
  const [vatPerLine, setVatPerLine] = useState(() => new Set(lines.map((l) => l.vatRate)).size > 1);
  const linkBtn = "text-[9pt] text-[#2563eb] hover:underline print:hidden";
  const commonRate = lines[0]?.vatRate ?? vat.rate;
  const unitLabel = (q: string) =>
    t(Number(q) === 1 ? "invoice.unit.day.one" : "invoice.unit.day.other");
  const setAllRates = (rate: string) => {
    setLines((prev) => prev.map((l) => ({ ...l, vatRate: rate })));
    queueMicrotask(() => void persist());
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {/* F143, the board *Invoice studio*: the page changes language, the numbers do not */}
        <fieldset
          aria-label={tUi("invoices.form.language")}
          className="m-0 inline-flex min-w-0 rounded-full border border-subtle bg-surface p-0.5"
          data-testid="invoice-language"
        >
          {SUPPORTED_UI_LANGUAGES.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={header.language === l}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold uppercase",
                header.language === l
                  ? "bg-action text-action-fg"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                if (header.language === l) return;
                setH("language", l);
                queueMicrotask(() => void persist());
              }}
            >
              {l}
            </button>
          ))}
        </fieldset>
        {/* F145: the VAT registration is a choice about the document, not a mark on the paper */}
        <Select
          value={header.vatRegistrationId || "__none__"}
          onValueChange={(v) => {
            setH("vatRegistrationId", !v || v === "__none__" ? "" : v);
            queueMicrotask(() => void persist());
          }}
        >
          <SelectTrigger
            className="h-8 w-56 text-xs"
            aria-label={tUi("invoices.form.vatRegistration")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{tUi("invoices.form.noVatRegistration")}</SelectItem>
            {registrations.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {tUi("invoices.form.vatRegistrationOption", {
                  country: r.country,
                  number: r.vatNumber,
                })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {toolbar}
        <span className="ml-auto">
          {saveState === "saving" && "…"}
          {saveState === "saved" && tUi("invoices.saved")}
          {!totals.ok && <span className="text-destructive">{totals.message}</span>}
        </span>
      </div>
      <InvoiceSheet
        mode="edit"
        doc={doc}
        slots={{
          issueDate: (
            <DateInput
              plain
              value={header.issueDate}
              onChange={(e) => setH("issueDate", e.target.value)}
              onBlur={() => void persist()}
              className={`${field} w-[31mm] font-bold`}
              aria-label={tUi("invoices.form.issueDate")}
            />
          ),
          dueDate: (
            <DateInput
              plain
              value={header.dueDate}
              onChange={(e) => setH("dueDate", e.target.value)}
              onBlur={() => void persist()}
              className={`${field} w-[31mm] font-bold`}
              aria-label={t("invoice.dueDate")}
            />
          ),
          periodLabel: (
            <input
              value={header.periodLabel}
              onChange={(e) => setH("periodLabel", e.target.value)}
              onBlur={() => void persist()}
              placeholder={tUi("invoices.form.periodPlaceholder")}
              className={`${field} w-[31mm] font-bold`}
              aria-label={tUi("invoices.form.period")}
            />
          ),
          references: (
            <>
              {header.printedReferences.map((r, i) => {
                const setRef = (patch: Partial<PrintedReference>) =>
                  setH(
                    "printedReferences",
                    header.printedReferences.map((x, j) => (j === i ? { ...x, ...patch } : x)),
                  );
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: editable list without ids
                  <div key={i} className="contents">
                    <dt>
                      <input
                        value={r.label}
                        onChange={(e) => setRef({ label: e.target.value })}
                        onBlur={() => void persist()}
                        className={`${field} w-[26mm]`}
                        placeholder={tUi("invoices.form.referenceLabel")}
                        aria-label={tUi("invoices.form.referenceLabel")}
                      />
                    </dt>
                    <dd className="flex items-center gap-1 font-bold">
                      <input
                        value={r.value}
                        onChange={(e) => setRef({ value: e.target.value })}
                        onBlur={() => void persist()}
                        className={`${field} w-[27mm] font-bold`}
                        placeholder={tUi("invoices.form.referenceValue")}
                        aria-label={tUi("invoices.form.referenceValue")}
                      />
                      <button
                        type="button"
                        className="text-[#9ca3af] hover:text-[#b91c1c] print:hidden"
                        title={tUi("invoices.line.remove")}
                        onClick={() => {
                          setH(
                            "printedReferences",
                            header.printedReferences.filter((_, j) => j !== i),
                          );
                          queueMicrotask(() => void persist());
                        }}
                      >
                        ×
                      </button>
                    </dd>
                  </div>
                );
              })}
              {header.printedReferences.length < 10 && (
                <dd className="col-span-2">
                  <button
                    type="button"
                    className={linkBtn}
                    onClick={() =>
                      setH("printedReferences", [
                        ...header.printedReferences,
                        { label: "", value: "" },
                      ])
                    }
                  >
                    + {tUi("invoices.form.addReference")}
                  </button>
                </dd>
              )}
            </>
          ),
          vatColumn: vatPerLine,
          lines: (cols) =>
            lines.map((l, i) => (
              <tr
                key={l.key}
                className="group align-top"
                style={{ borderBottom: "1px solid #e5e7eb" }}
                data-testid="line-row"
              >
                <td className="px-2 py-2">
                  <textarea
                    value={l.description}
                    rows={Math.max(1, l.description.split("\n").length)}
                    onChange={(e) => setLine(l.key, { description: e.target.value })}
                    onBlur={() => void persist()}
                    placeholder={tUi("invoices.line.descriptionPlaceholder")}
                    className={`${field} block w-full resize-none`}
                    aria-label={t("invoice.table.description")}
                  />
                  {(lineDiscounts.has(l.key) || l.rateSourceId) && (
                    <div className="mt-1 flex items-center gap-2 px-1 text-[8pt] text-[#6b7280]">
                      {l.rateSourceId && <span>{tUi("invoices.line.fromContractRate")}</span>}
                      {lineDiscounts.has(l.key) && (
                        <label className="flex items-center gap-1" data-testid="line-discount">
                          {t("invoice.totals.discount")}
                          <input
                            inputMode="decimal"
                            value={l.discountPercent}
                            onChange={(e) =>
                              setLine(l.key, { discountPercent: e.target.value.replace(",", ".") })
                            }
                            onBlur={() => void persist()}
                            className={`${field} w-10 text-right`}
                            aria-label={tUi("invoices.line.discountPercent")}
                          />
                          %
                          <button
                            type="button"
                            className="text-[#9ca3af] hover:text-[#b91c1c]"
                            aria-label={tUi("invoices.line.removeDiscount")}
                            onClick={() => {
                              setLine(l.key, { discountPercent: "" });
                              setLineDiscounts((prev) => {
                                const next = new Set(prev);
                                next.delete(l.key);
                                return next;
                              });
                              queueMicrotask(() => void persist());
                            }}
                          >
                            ×
                          </button>
                        </label>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-1 py-2 text-center whitespace-nowrap">
                  <input
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) => setLine(l.key, { quantity: e.target.value.replace(",", ".") })}
                    onBlur={() => void persist()}
                    className={`${field} w-[10mm] text-center tabular-nums`}
                    aria-label={t("invoice.table.quantity")}
                  />{" "}
                  {unitLabel(l.quantity)}
                </td>
                <td className="px-1 py-2 text-right whitespace-nowrap">
                  {invoice.currency}{" "}
                  <input
                    inputMode="decimal"
                    value={l.unitPrice}
                    onChange={(e) =>
                      setLine(l.key, {
                        unitPrice: e.target.value.replace(",", "."),
                        rateSourceId: null,
                      })
                    }
                    onBlur={() => void persist()}
                    className={`${field} w-[18mm] text-right tabular-nums`}
                    aria-label={t("invoice.table.unitPrice")}
                  />
                </td>
                {cols.vat && (
                  <td className="px-1 py-2 text-right">
                    <select
                      value={l.vatRate}
                      onChange={(e) => {
                        setLine(l.key, { vatRate: e.target.value });
                        queueMicrotask(() => void persist());
                      }}
                      className={`${field} text-right`}
                      aria-label={t("invoice.table.vatPercent")}
                    >
                      {rateOptions.map((r) => (
                        <option key={r} value={r}>
                          {formatVatPercent(r)}%
                        </option>
                      ))}
                    </select>
                  </td>
                )}
                <td className="px-3 py-2.5 text-right tabular-nums" data-testid="line-net">
                  {totals.ok
                    ? sheetMoney(totals.value.lines[i]?.net ?? "0.00", invoice.currency)
                    : "—"}
                </td>
                <td className="py-2 text-right whitespace-nowrap opacity-40 group-hover:opacity-100 focus-within:opacity-100 print:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="px-1 text-[#6b7280] hover:text-[#111827]"
                      aria-label={tUi("invoices.line.options")}
                      data-testid="line-options"
                    >
                      ⋯
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={lineDiscounts.has(l.key)}
                        onClick={() => setLineDiscounts((prev) => new Set(prev).add(l.key))}
                      >
                        {tUi("invoices.line.addDiscount")}
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={vatPerLine} onClick={() => setVatPerLine(true)}>
                        {tUi("invoices.line.vatPerLine")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <button
                    type="button"
                    className="px-1 text-[#6b7280] hover:text-[#111827]"
                    title={tUi("invoices.line.duplicate")}
                    aria-label={tUi("invoices.line.duplicate")}
                    onClick={() => duplicateLine(l.key)}
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    className="px-1 text-[#6b7280] hover:text-[#b91c1c] disabled:opacity-30"
                    title={tUi("invoices.line.remove")}
                    aria-label={tUi("invoices.line.remove")}
                    onClick={() => removeLine(l.key)}
                    disabled={lines.length <= 1}
                  >
                    ×
                  </button>
                </td>
              </tr>
            )),
          afterLines: (
            <tr className="print:hidden">
              <td colSpan={6} className="px-2 pt-2">
                <button type="button" className={linkBtn} onClick={addLine}>
                  + {tUi("invoices.line.add")}
                </button>
              </td>
            </tr>
          ),
          vat:
            rateOptions.length > 1 && !vatPerLine ? (
              <select
                value={commonRate}
                onChange={(e) => setAllRates(e.target.value)}
                className={`${field} tabular-nums`}
                aria-label={tUi("invoices.form.vatRate")}
                data-testid="sheet-vat-rate"
              >
                {rateOptions.map((r) => (
                  <option key={r} value={r}>
                    ({formatVatPercent(r)}%)
                  </option>
                ))}
              </select>
            ) : undefined,
          discount: showDiscount ? (
            <span className="ml-1 inline-flex items-center gap-1">
              <input
                inputMode="decimal"
                value={header.discountPercent}
                onChange={(e) => setH("discountPercent", e.target.value.replace(",", "."))}
                onBlur={() => {
                  if (header.discountPercent === "" || Number(header.discountPercent) === 0) {
                    setH("discountPercent", "");
                    setShowDiscount(false);
                  }
                  void persist();
                }}
                className={`${field} w-10 text-right`}
                aria-label={tUi("invoices.form.discountPercent")}
              />
              %
            </span>
          ) : undefined,
          afterTotals: (
            <div className="mt-1 flex gap-3 print:hidden">
              {!showDiscount && (
                <button type="button" className={linkBtn} onClick={() => setShowDiscount(true)}>
                  + {tUi("invoices.form.addDiscount")}
                </button>
              )}
              {vatPerLine && new Set(lines.map((l) => l.vatRate)).size === 1 && (
                <button type="button" className={linkBtn} onClick={() => setVatPerLine(false)}>
                  {tUi("invoices.line.oneVatRate")}
                </button>
              )}
              {!showNotes && (
                <button type="button" className={linkBtn} onClick={() => setShowNotes(true)}>
                  + {tUi("invoices.form.addNote")}
                </button>
              )}
            </div>
          ),
          notes: showNotes ? (
            <textarea
              value={header.notes}
              onChange={(e) => setH("notes", e.target.value)}
              onBlur={() => {
                if (header.notes.trim() === "") setShowNotes(false);
                void persist();
              }}
              placeholder={tUi("invoices.form.notes")}
              className={`${field} block w-full resize-none`}
              rows={2}
              aria-label={tUi("invoices.form.notes")}
            />
          ) : undefined,
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
              className={`${field} block w-full resize-none placeholder:text-[#111827]`}
              rows={1}
              aria-label={tUi("invoices.form.paymentTermsText")}
            />
          ),
        }}
      />
    </div>
  );
}
