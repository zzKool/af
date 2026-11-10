"use client";

import { useAction } from "next-safe-action/hooks";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
// The reading dialog (F131, review 2026-10-31 §6.3 — DI Studio's shape): opened when the OCR reading of the paper
// dropped on a bank row arrives (and on *Use it* for a proof already in the inbox, and on *Receipt lost* without a
// paper). Full screen: the preview on the left (the review page's viewer — zoom, rotate, pages); on the right, top to
// bottom, the row's facts pinned · *Paper* (D75: the radio re-reads with the other model) and *Becomes*
// (`proposeKind`, a *switch* link for the rare case) · the typed fields of the reading, a confidence glyph each,
// editable as the compare card's were (the entity takes the edited values; nothing is written on the document) ·
// *Also read (N)* and *Lines (N)* collapsed · the Partner block (the match card first, the full partner form inline)
// · the Checks (`checkProof`, warn never block — the warnings left standing go on the link's audit trail as
// `confirmedWarnings`) · the Group proposed from the paper's date (the covering trip, else the month's group — never
// list order) · the Category with its source · one primary, *Confirm & link* → `justifyRowAction` (one transaction),
// then the D74 toast when the result proposes a rule. Escape closes without writing. Replaces the F97 compare card.
// F186 (the board *Documents*): the same column pair as the documents desk — the document as paper with a box on
// every field read, the field active on the right lit — and on the right *What it read* (`WhatItRead` in form mode:
// each value its own quiet input, its confidence and bar; an ambiguous date or a total ≠ net + VAT asks) then *When
// you accept*: **creates** the kind (the paper radio and the switch in its step) · **links** this row, the checks
// as its evidence · **files** the category, the partner and the group — the partner match / new partner, the group
// and the category open in that step on a click (open while one lacks). One primary, *Accept all three*.
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { CURRENCIES } from "@/kernel/nav/constants";
import { confidenceLabel } from "@/kernel/ocr/confidence";
import {
  fieldConfidence,
  fieldContent,
  type OcrFieldMap,
  type OcrPage,
  type OcrTypedKey,
} from "@/kernel/ocr/fields";
import { DetailsSection } from "@/kernel/ui/details-section";
import { createRuleFromTransactionAction } from "@/modules/banking/ui";
import {
  AcceptChainView,
  AlsoReadSection,
  askFor,
  BoardTag,
  type ChainNode,
  DocumentViewer,
  type MarkedKey,
  type ReadField,
  WhatItRead,
} from "@/modules/documents/ui";
import {
  GroupPicker,
  type GroupProposalReason,
  NEW_GROUP,
  proposeGroupForDate,
  useCreateGroupIfNew,
} from "@/modules/expenses/ui";
import {
  BasPicker,
  type BasSuggestion,
  type BasSuggestionSource,
  partnerBasSuggestions,
} from "@/modules/settings/ui";
import {
  type NewTrip,
  NewTripFields,
  newTripFor,
  newTripMissing,
  useCreateTripGroup,
} from "@/modules/traktamente/ui";
import { checkProof, warningMessage } from "../check-proof";
import {
  type GreenCheck,
  greenChecks,
  isoDay,
  type JustifyKind,
  monthOf,
  PAPERS,
  type Paper,
  proposeKind,
  type Reading,
  type RowForJustify,
} from "../justify-rules";
import { justifyRowAction, proofFactsAction } from "../linking.actions";
import { prefillFromProposals } from "../proposals/policy";
import type { ProofFacts, ProofWarning, ProposalDto } from "../types";
import type { JustifyOptions, JustifyPartner } from "./justify-panel";
import { NONE, type PartnerPick, ReadingPartnerBlock } from "./reading-partner";

/** What the dialog shows of the document behind the reading — the review read's fields the viewer and the glyphs need. */
export type ReadDocument = {
  fileUrl: string;
  mimeType: string;
  prefixType: string;
  /** the OCR's own reading (before corrections): `fields` and `modelUsed` give the glyphs and *Also read* */
  fields: OcrFieldMap | undefined;
  modelUsed: string | undefined;
  /** F186: the pages the boxes are measured in, and how long the reading took */
  pages?: OcrPage[];
  processingTimeMs?: number;
};

/** a proposal's source as the picker names it (F98 → F125) */
const PROPOSAL_SOURCE: Record<string, BasSuggestionSource> = {
  rule: "rule",
  partner_default: "partner",
  memory: "history",
  model: "model",
};
const FACTS_DEBOUNCE_MS = 400;

type Props = {
  row: RowForJustify;
  /** the uploaded proof; null = the receipt is lost (`document_missing`) */
  documentId: string | null;
  document: ReadDocument | null;
  /** the OCR reading as corrected (`resolvedData`); empty when nothing was read */
  reading: Reading;
  /** the OCR failed / timed out: said once above the fields */
  note: string | null;
  paper: Paper;
  /** D75: the other paper re-reads the document with the other model — the host classifies and polls */
  onPaper: (paper: Paper) => void;
  /** the host is reading again after a paper switch: the fields wait */
  rereading?: boolean;
  options: JustifyOptions;
  proposals: ProposalDto[];
  onCancel: () => void;
  onDone: () => void;
};

export function ReadingDialog(props: Props) {
  return (
    <Dialog open onOpenChange={(open) => !open && props.onCancel()}>
      <DialogContent
        size="lg"
        className="flex h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 data-[size=lg]:max-w-[calc(100vw-2rem)]"
        data-testid="reading-dialog"
      >
        <ReadingDialogBody {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ReadingDialogBody({
  row,
  documentId,
  document,
  reading,
  note,
  paper,
  onPaper,
  rereading = false,
  options,
  proposals,
  onCancel,
  onDone,
}: Props) {
  const t = useT();
  const ids = useId();
  const incoming = Number(row.amount) > 0;
  const { executeAsync: justify, isPending } = useAction(justifyRowAction);
  const { executeAsync: createRule } = useAction(createRuleFromTransactionAction);
  const { executeAsync: loadFacts } = useAction(proofFactsAction);
  const { resolveGroupId, isPending: creatingGroup } = useCreateGroupIfNew();
  const { createTrip, isPending: creatingTrip } = useCreateTripGroup();

  // --- what the paper becomes (D75: derived, a switch for the rare case) ---
  const [kind, setKind] = useState<JustifyKind>(() => proposeKind(row, reading));
  const receiptRead = !!reading.merchantName && !reading.vendorName;

  // --- the fields, pre-filled from the reading else from the row; edited here, sent to the entity (never written on the document) ---
  const [vendorName, setVendorName] = useState(reading.vendorName ?? reading.merchantName ?? "");
  const [vatNumber, setVatNumber] = useState(reading.vendorTaxId ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(reading.invoiceNumber ?? "");
  const paperDate = isoDay(reading.invoiceDate) ?? isoDay(reading.transactionDate);
  const [date, setDate] = useState(paperDate ?? row.bookingDate);
  const [dueDate, setDueDate] = useState(isoDay(reading.dueDate) ?? "");
  const rowAmount = Math.abs(Number(row.amount)).toFixed(2);
  const [amount, setAmount] = useState(
    typeof reading.invoiceTotal === "number" && reading.invoiceTotal > 0
      ? reading.invoiceTotal.toFixed(2)
      : rowAmount,
  );
  const [currency, setCurrency] = useState(
    reading.currency ? reading.currency.toUpperCase() : row.currency,
  );
  const [vat, setVat] = useState(
    typeof reading.totalTax === "number" && reading.totalTax > 0 ? reading.totalTax.toFixed(2) : "",
  );
  const net =
    vat && Number(vat) > 0 && Number(amount) >= Number(vat)
      ? (Number(amount) - Number(vat)).toFixed(2)
      : Number(amount) > 0
        ? Number(amount).toFixed(2)
        : "";
  const billedTo = [reading.customerName, reading.customerTaxId].filter(Boolean).join(" · ");

  /** the reading as edited — what the checks and the partner match see */
  const edited: Reading = useMemo(
    () => ({
      ...reading,
      vendorName: receiptRead ? undefined : vendorName || undefined,
      merchantName: receiptRead ? vendorName || undefined : reading.merchantName,
      vendorTaxId: vatNumber || undefined,
      invoiceNumber: invoiceNumber || undefined,
      invoiceDate: receiptRead ? undefined : date || undefined,
      transactionDate: receiptRead ? date || undefined : reading.transactionDate,
      dueDate: dueDate || undefined,
      invoiceTotal: Number(amount) > 0 ? Number(amount) : undefined,
      totalTax: vat && Number(vat) > 0 ? Number(vat) : undefined,
      currency: currency || undefined,
    }),
    [
      reading,
      receiptRead,
      vendorName,
      vatNumber,
      invoiceNumber,
      date,
      dueDate,
      amount,
      vat,
      currency,
    ],
  );

  // --- the partner (F129: every exit names one) ---
  const prefill = prefillFromProposals(proposals);
  const [extraPartners, setExtraPartners] = useState<JustifyPartner[]>([]);
  const partners = [...extraPartners, ...options.partners];
  const [pick, setPick] = useState<PartnerPick | null>(() =>
    prefill.partnerId && options.partners.some((p) => p.id === prefill.partnerId)
      ? { partnerId: prefill.partnerId, from: "picked" }
      : null,
  );
  const picked = pick ? partners.find((p) => p.id === pick.partnerId) : undefined;
  const partnerId = picked?.id ?? NONE;
  // the latest pick for the proposals that arrive asynchronously (a match, the memory) — no side effect in an updater
  const pickRef = useRef(pick);
  pickRef.current = pick;

  // --- the category: a HIGH proposal pre-fills it (F98), else the picked partner's default; the source is named ---
  const [basCode, setBasCode] = useState<string>(() => {
    if (prefill.basCode && options.categories.some((c) => c.code === prefill.basCode))
      return prefill.basCode;
    const p = options.partners.find((x) => x.id === prefill.partnerId);
    return p?.defaultBasCode ?? NONE;
  });
  const basSuggestions: BasSuggestion[] = [
    ...proposals.flatMap((p) =>
      p.kind === "bas"
        ? [
            {
              code: p.payload.basCode,
              source: PROPOSAL_SOURCE[p.source] ?? ("proposal" as const),
              ...(p.reason ? { reason: p.reason } : {}),
            },
          ]
        : [],
    ),
    ...(picked
      ? partnerBasSuggestions({
          defaultCode: picked.defaultBasCode,
          history: options.basHistory?.[picked.id],
          historyReason: (count) => t("settings.basPicker.usedBefore", { count }),
        })
      : []),
  ];
  const categorySource = basSuggestions.find((s) => s.code === basCode)?.source ?? null;
  function pickPartner(next: PartnerPick | null) {
    setPick(next);
    const p = next ? partners.find((x) => x.id === next.partnerId) : undefined;
    // the partner's default category fills an empty one (journal T002, on the row)
    if (p?.defaultBasCode) setBasCode((b) => (b === NONE ? (p.defaultBasCode ?? NONE) : b));
  }
  /** a proposal from a fact: it never replaces the owner's pick; a match replaces the memory's proposal */
  function proposePartner(next: PartnerPick) {
    const cur = pickRef.current;
    if (cur && !(cur.from === "memory" && next.from === "match")) return;
    pickPartner(next);
  }

  // --- the group, proposed from the paper's date (review §5.2): the covering trip, else the month's group ---
  const groupProposal = useMemo(
    () =>
      proposeGroupForDate(
        date || row.bookingDate,
        options.groups.map((g) => ({
          id: g.id,
          name: g.description ?? g.label,
          kind: g.kind,
          departure: g.departure,
          return: g.return,
          month: g.month ?? null,
        })),
      ),
    [date, row.bookingDate, options.groups],
  );
  const [groupId, setGroupId] = useState<string>(groupProposal.groupId ?? "");
  const [groupTouched, setGroupTouched] = useState(false);
  const [newGroupDescription, setNewGroupDescription] = useState(monthOf(date || row.bookingDate));
  // the date edited → the proposal follows, until the owner picked a group himself
  useEffect(() => {
    if (groupTouched) return;
    setGroupId(groupProposal.groupId ?? "");
    setNewGroupDescription(monthOf(date || row.bookingDate));
  }, [groupProposal, groupTouched, date, row.bookingDate]);
  const groupReason: GroupProposalReason | null =
    groupId && groupId === groupProposal.groupId ? groupProposal.reason : null;
  // *+ New group* is a month's group or a trip (review §5.2, T020): the trip in place — departure, return, country;
  // the per-diem comes with it (the group page types the meals and writes the per-diem expense)
  const [newGroupKind, setNewGroupKind] = useState<"batch" | "trip">("batch");
  const [newTrip, setNewTrip] = useState<NewTrip>(() => newTripFor(date || row.bookingDate));
  // a group created by a submit that then failed is picked, not created twice on the next click
  const [createdGroups, setCreatedGroups] = useState<
    { id: string; number: number; description: string; kind: "trip" | "batch" }[]
  >([]);
  const groupOptions = [
    ...options.groups.map((g) => ({
      id: g.id,
      number: g.number ?? 0,
      description: g.description ?? g.label,
      kind: g.kind ?? ("batch" as const),
    })),
    ...createdGroups,
  ];
  const newTripTodo =
    groupId === NEW_GROUP && newGroupKind === "trip" ? newTripMissing(newTrip) : [];

  // --- the checks (F130): the facts from the server, the comparison in the browser ---
  const [facts, setFacts] = useState<ProofFacts | null>(null);
  const factsKey = JSON.stringify([
    row.id,
    documentId,
    currency,
    partnerId,
    kind === "supplier_invoice" ? invoiceNumber : "",
    reading.customerName ?? "",
    reading.customerTaxId ?? "",
  ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `factsKey` serialises every input of the read
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void loadFacts({
        transactionId: row.id,
        documentId,
        readingCurrency: currency || null,
        invoiceNumber: kind === "supplier_invoice" ? invoiceNumber || null : null,
        partnerId: partnerId === NONE ? null : partnerId,
        customerName: reading.customerName ?? null,
        customerTaxId: reading.customerTaxId ?? null,
      }).then((r) => {
        const d = r?.data && "data" in r.data ? r.data.data : undefined;
        if (live && d) setFacts(d);
      });
    }, FACTS_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [factsKey]);

  const warnings: ProofWarning[] = facts
    ? checkProof({
        row,
        reading: edited,
        partner: picked
          ? { id: picked.id, name: picked.name, vatNumber: picked.vatNumber ?? null }
          : null,
        memory: facts.memory,
        rulePartnerIds: facts.rulePartnerIds,
        fxRate: facts.fxRate,
        billedToFits: facts.billedToFits,
        companyName: facts.companyName,
        documentJustifiesOther: facts.documentJustifiesOther,
        supplierNumberTaken: facts.supplierNumberTaken,
      })
    : [];
  const green: GreenCheck[] = facts
    ? greenChecks(
        row,
        edited,
        !!picked,
        warnings.map((w) => w.code),
      )
    : [];

  // --- what the click still needs (the key wants a category; a supplier invoice its number; every exit a partner) ---
  const missing = [
    ...(!picked ? [t("linking.reading.partner")] : []),
    ...(kind === "supplier_invoice" && !invoiceNumber.trim()
      ? [t("linking.reading.field.invoiceNumber")]
      : []),
    ...(kind === "expense" && !vendorName.trim() ? [t("linking.reading.field.description")] : []),
    ...(!(Number(amount) > 0) ? [t("linking.reading.field.total")] : []),
    ...(!date ? [t("linking.justify.field.date")] : []),
    ...(!groupId || (groupId === NEW_GROUP && !newGroupDescription.trim())
      ? [t("linking.reading.group")]
      : []),
    ...newTripTodo.map((f) => t(`linking.reading.newTrip.${f}`)),
    ...(basCode === NONE ? [t("linking.reading.category")] : []),
  ];

  async function submit() {
    if (!picked) return;
    const gid =
      groupId === NEW_GROUP && newGroupKind === "trip"
        ? await createTrip(newGroupDescription, newTrip)
        : // the month's group carries its month as a fact (T025): the next paper of that month finds it
          await resolveGroupId(groupId, newGroupDescription, monthOf(date || row.bookingDate));
    if (!gid) return;
    if (groupId === NEW_GROUP) {
      setCreatedGroups((list) => [
        ...list,
        { id: gid, number: 0, description: newGroupDescription.trim(), kind: newGroupKind },
      ]);
      setGroupTouched(true);
      setGroupId(gid);
    }
    const common = {
      transactionId: row.id,
      ...(documentId ? { documentId } : {}),
      // the warnings left standing: the owner saw them — they go on the link's audit trail (F130)
      ...(warnings.length ? { confirmedWarnings: warnings.map((w) => w.code) } : {}),
    };
    const vatAmount = vat && Number(vat) > 0 ? Number(vat).toFixed(2) : undefined;
    const r =
      kind === "supplier_invoice"
        ? await justify({
            ...common,
            kind: "supplier_invoice",
            supplier: {
              groupId: gid,
              partnerId: picked.id,
              invoiceNumber: invoiceNumber.trim(),
              invoiceDate: date,
              ...(dueDate ? { dueDate } : {}),
              currency: currency as (typeof CURRENCIES)[number],
              amountNet: net || Number(amount).toFixed(2),
              ...(vatAmount ? { vatAmount } : {}),
              amountTotal: Number(amount).toFixed(2),
              basCode: basCode === NONE ? "" : basCode,
            },
          })
        : await justify({
            ...common,
            kind: "expense",
            expense: {
              groupId: gid,
              date,
              description: vendorName.trim(),
              basCode: basCode === NONE ? "" : basCode,
              amount: Number(amount).toFixed(2),
              currency: currency as (typeof CURRENCIES)[number],
              ...(vatAmount ? { vatAmount } : {}),
              partnerId: picked.id,
            },
          });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const data = r?.data && "data" in r.data ? r.data.data : undefined;
    toast.success(t("linking.justify.done", { key: data?.entity.key ?? "" }));
    // D74 (F129): the confirmed vendor ↔ counterparty becomes a rule on one click — applied at the next import
    const draft = data?.proposeRule;
    if (draft) {
      const partnerName = partners.find((p) => p.id === draft.partnerId)?.name ?? "";
      toast(
        t("linking.justify.proposeVendorRule", {
          counterparty: row.counterpartyKey,
          partner: partnerName,
        }),
        {
          action: {
            label: t("linking.justify.proposeRuleAction"),
            onClick: () => {
              void createRule({ transactionId: row.id, ...draft }).then((rr) => {
                const err = extractError(rr);
                if (err) toast.error(err);
                else toast.success(t("linking.justify.ruleCreated"));
              });
            },
          },
        },
      );
    }
    onDone();
  }

  // --- what it read (F186): the dialog's fields as the board's rows — DI's confidence, the box on the page ---
  const docReading = document
    ? { fields: document.fields, modelUsed: document.modelUsed ?? "" }
    : null;
  const conf = (...keys: OcrTypedKey[]) =>
    keys.reduce<number | null>((found, key) => found ?? fieldConfidence(docReading, key), null);
  const content = (...keys: OcrTypedKey[]) =>
    keys.reduce<string | null>((found, key) => found ?? fieldContent(docReading, key), null);
  const paperWord = t(`linking.justify.paper.${paper}`).toLowerCase();
  const otherKind: JustifyKind = kind === "supplier_invoice" ? "expense" : "supplier_invoice";
  const busy = rereading || isPending || creatingGroup || creatingTrip;
  const signedAmount = formatMoney(row.amount, row.currency, { signed: true });
  const title = documentId
    ? t("linking.reading.title", {
        date: row.bookingDate,
        amount: signedAmount,
        counterparty: row.counterpartyKey || row.description,
      })
    : t("linking.reading.lostTitle", {
        date: row.bookingDate,
        amount: signedAmount,
        counterparty: row.counterpartyKey || row.description,
      });
  const items = reading.items ?? [];
  const vendorKey: MarkedKey = receiptRead ? "merchantName" : "vendorName";
  const dateKey: MarkedKey = receiptRead ? "transactionDate" : "invoiceDate";
  const asked = {
    [vendorKey]: vendorName,
    [dateKey]: date,
    dueDate,
    invoiceTotal: Number(amount) || undefined,
    totalTax: Number(vat) || undefined,
    subtotal: reading.subtotal,
  };
  const row_ = (
    key: MarkedKey,
    label: string,
    raw: string,
    input: ReadField["input"],
    testId: string,
    extra: Partial<ReadField> = {},
  ): ReadField => {
    const c = documentId ? conf(key) : null;
    return {
      key,
      label,
      value: raw,
      raw,
      input,
      confidence: c,
      sure: confidenceLabel(c) === "high",
      ask: documentId && raw ? askFor(key, c, content(key), asked) : null,
      testId,
      ...extra,
    };
  };
  const fields: ReadField[] = [
    row_(vendorKey, t("linking.reading.field.vendor"), vendorName, "text", "justify-vendor"),
    row_(
      "vendorTaxId",
      t("linking.reading.field.vatNumber"),
      vatNumber,
      "text",
      "justify-vat-number",
    ),
    ...(kind === "supplier_invoice"
      ? [
          row_(
            "invoiceNumber",
            t("linking.reading.field.invoiceNumber"),
            invoiceNumber,
            "text",
            "justify-invoice-number",
          ),
        ]
      : []),
    row_(
      dateKey,
      receiptRead
        ? t("linking.reading.field.transactionDate")
        : t("linking.reading.field.invoiceDate"),
      date,
      "date",
      "justify-date",
    ),
    ...(kind === "supplier_invoice"
      ? [row_("dueDate", t("linking.reading.field.dueDate"), dueDate, "date", "justify-due")]
      : []),
    row_("invoiceTotal", t("linking.reading.field.total"), amount, "amount", "justify-amount", {
      suffix: (
        <Select value={currency} onValueChange={(v) => setCurrency(v ?? row.currency)}>
          <SelectTrigger
            id={`${ids}-currency`}
            className="h-7 w-[4.5rem] shrink-0"
            aria-label={t("linking.reading.field.currency")}
            data-testid="justify-currency"
          >
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
      ),
    }),
    row_("totalTax", t("linking.reading.field.vat"), vat, "amount", "justify-vat"),
    row_("subtotal", t("linking.reading.field.net"), net, "amount", "reading-net", {
      readOnly: true,
      ask: null,
    }),
  ];
  const setters: Record<string, (v: string) => void> = {
    vendorName: setVendorName,
    merchantName: setVendorName,
    vendorTaxId: setVatNumber,
    invoiceNumber: setInvoiceNumber,
    invoiceDate: setDate,
    transactionDate: setDate,
    dueDate: setDueDate,
    invoiceTotal: setAmount,
    totalTax: setVat,
  };
  const [active, setActive] = useState<string | null>(null);

  // --- when you accept: creates · links · files (the board's chain; the checks are the links step's evidence) ---
  const lacksFiles = !picked || basCode === NONE || !groupId;
  const [filesOpen, setFilesOpen] = useState(true);
  const groupName =
    groupId === NEW_GROUP
      ? `${newGroupDescription.trim() || monthOf(date || row.bookingDate)} (${t("linking.reading.newGroupShort")})`
      : (groupOptions.find((g) => g.id === groupId)?.description ?? "");
  const category = options.categories.find((c) => c.code === basCode);
  const nodes: ChainNode[] = [
    {
      verb: "creates",
      body: (
        <span className="inline-block first-letter:uppercase" data-testid="reading-becomes">
          {t(`linking.reading.becomes.${kind}`)}
        </span>
      ),
      children: (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5" data-testid="reading-paper">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{t("linking.justify.paper")}</span>
            <div className="flex gap-1" role="radiogroup" aria-label={t("linking.justify.paper")}>
              {PAPERS.map((p) => (
                <Button
                  key={p}
                  size="xs"
                  variant={paper === p ? "secondary" : "ghost"}
                  role="radio"
                  aria-checked={paper === p}
                  disabled={busy || !documentId}
                  onClick={() => p !== paper && onPaper(p)}
                  data-testid={`reading-paper-${p}`}
                >
                  {t(`linking.justify.paper.${p}`)}
                </Button>
              ))}
            </div>
          </div>
          <Button
            size="sm"
            variant="link"
            className="h-auto p-0 text-xs"
            onClick={() => setKind(otherKind)}
            disabled={busy}
            data-testid="reading-switch"
          >
            {t("linking.reading.switch", { kind: t(`linking.reading.becomes.${otherKind}`) })}
          </Button>
        </div>
      ),
    },
    {
      verb: "links",
      body: (
        <span className="tabular-nums">
          {t("linking.reading.bankRow", { date: row.bookingDate, amount: signedAmount })}
        </span>
      ),
      aside: facts ? (
        <span className={warnings.length ? "text-state-attention" : "text-state-done"} data-public>
          {warnings.length
            ? t("linking.reading.warningsCount", { count: warnings.length })
            : t("linking.reading.checksCount", { count: green.length })}
        </span>
      ) : null,
      children: (
        <>
          <ul className="flex flex-col gap-1 text-xs" data-testid="reading-checks">
            {green.map((g) => (
              <li
                key={g.code}
                className="flex items-start gap-2 text-muted-foreground"
                data-testid="reading-check-ok"
              >
                <span aria-hidden className="w-3 shrink-0 text-center text-state-done">
                  ✓
                </span>
                <span>{greenText(g, t)}</span>
              </li>
            ))}
            {warnings.map((w) => (
              <li
                key={w.code}
                className="flex items-start gap-2 text-state-attention"
                data-testid="reading-check-warning"
                data-code={w.code}
              >
                <span aria-hidden className="w-3 shrink-0 text-center font-semibold">
                  !
                </span>
                <span>{warningMessage(w, t)}</span>
              </li>
            ))}
            {facts && green.length === 0 && warnings.length === 0 && (
              <li className="text-muted-foreground">{t("linking.reading.checksNone")}</li>
            )}
          </ul>
          {warnings.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("linking.reading.warningsConfirmed")}
            </p>
          )}
        </>
      ),
    },
    {
      verb: "files",
      lacking: lacksFiles,
      onOpen: () => setFilesOpen((o) => !o),
      body: (
        <span data-testid="reading-files">
          {category ? category.label.replace(" · ", " ") : t("linking.reading.pickCategory")}
          {" · "}
          {picked
            ? t("documents.chain.partner", { name: picked.name })
            : t("linking.reading.pickPartner")}
          {groupName ? ` · ${groupName}` : ""}
        </span>
      ),
      children: filesOpen ? (
        <div className="flex flex-col gap-3">
          <Block label={t("linking.reading.partner")}>
            <ReadingPartnerBlock
              rowId={row.id}
              incoming={incoming}
              vendor={{
                name: vendorName || null,
                vatNumber: vatNumber || null,
                address: reading.vendorAddress ?? null,
              }}
              readingCurrency={currency || null}
              partners={partners}
              pick={pick}
              onPick={pickPartner}
              onPropose={proposePartner}
              onCreated={(p) => {
                setExtraPartners((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
                pickPartner({ partnerId: p.id, from: "created" });
              }}
              paperWord={paperWord}
              disabled={busy}
            />
          </Block>
          <Block label={t("linking.reading.group")}>
            <div className="grid gap-2" data-testid="justify-group">
              <GroupPicker
                idPrefix={`${ids}-grp`}
                label={t("linking.reading.group")}
                groups={groupOptions}
                value={groupId}
                onChange={(id) => {
                  setGroupTouched(true);
                  setGroupId(id);
                }}
                newDescription={newGroupDescription}
                onNewDescription={setNewGroupDescription}
              />
              {groupId === NEW_GROUP && (
                <div
                  className="flex flex-wrap items-center gap-1"
                  role="radiogroup"
                  aria-label={t("linking.reading.newGroupKind")}
                >
                  <span className="mr-1 text-xs font-medium">
                    {t("linking.reading.newGroupKind")}
                  </span>
                  {(["batch", "trip"] as const).map((k) => (
                    <Button
                      key={k}
                      size="sm"
                      variant={newGroupKind === k ? "secondary" : "ghost"}
                      role="radio"
                      aria-checked={newGroupKind === k}
                      onClick={() => setNewGroupKind(k)}
                      data-testid={`reading-new-group-${k}`}
                    >
                      {t(`linking.reading.newGroupKind.${k}`)}
                    </Button>
                  ))}
                </div>
              )}
              {groupId === NEW_GROUP && newGroupKind === "trip" && (
                <NewTripFields idPrefix={`${ids}-trip`} value={newTrip} onChange={setNewTrip} />
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground" data-testid="reading-group-hint">
              {groupReason
                ? t(`linking.reading.groupProposed.${groupReason}`)
                : !groupId
                  ? t("linking.reading.groupNone", {
                      date: date || row.bookingDate,
                      month: monthOf(date || row.bookingDate),
                    })
                  : null}
            </p>
          </Block>
          <Block label={t("linking.reading.category")}>
            <BasPicker
              id={`${ids}-cat`}
              options={options.categories}
              value={basCode === NONE ? "" : basCode}
              onChange={(code) => setBasCode(code || NONE)}
              suggestions={basSuggestions}
              direction="cost"
              requireAlias
              data-testid="justify-category"
            />
            {categorySource && (
              <p className="mt-1 text-xs text-muted-foreground" data-testid="reading-category-hint">
                {t("linking.reading.categoryProposed", {
                  source: t(`linking.reading.categorySource.${categorySource}`),
                })}
              </p>
            )}
          </Block>
        </div>
      ) : undefined,
    },
  ];
  const kindTag =
    kind === "supplier_invoice" ? "documents.kind.supplierInvoice" : "documents.kind.receipt";
  const pages = document?.pages?.length ?? 0;
  const readMs = document?.processingTimeMs;

  return (
    <>
      <DialogHeader className="border-b px-5 py-3 pr-12">
        <DialogTitle className="truncate" data-testid="reading-title">
          {title}
        </DialogTitle>
        <DialogDescription className="truncate text-xs" data-testid="reading-row-facts">
          {t("linking.reading.rowFacts", {
            account: row.accountLabel,
            description: row.description,
          })}
        </DialogDescription>
      </DialogHeader>

      <div className="grid min-h-0 flex-1 grid-cols-1 bg-app md:grid-cols-[minmax(0,1fr)_400px]">
        {/* left — the document, its boxes lit by the field active on the right (the board *Documents*) */}
        <div className="hidden min-h-0 flex-col gap-3 p-5 md:flex">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
            <BoardTag tone={kind === "supplier_invoice" ? "progress" : "attention"}>
              {t(kindTag)}
            </BoardTag>
            <span data-public>
              {[
                t("linking.reading.readAs", { paper: paperWord }),
                pages > 0
                  ? t(pages === 1 ? "documents.desk.page" : "documents.desk.pages", {
                      count: pages,
                    })
                  : null,
                readMs ? t("documents.desk.readIn", { seconds: (readMs / 1000).toFixed(1) }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {document && <span className="ml-auto">{t("documents.desk.previewHint")}</span>}
          </div>
          {document ? (
            <div className="relative min-h-0 flex-1" data-testid="reading-preview">
              <div className="absolute inset-0">
                <DocumentViewer
                  bare
                  fileUrl={document.fileUrl}
                  mimeType={document.mimeType}
                  reading={
                    document.fields && document.modelUsed
                      ? {
                          ...reading,
                          fields: document.fields,
                          modelUsed: document.modelUsed,
                          pages: document.pages,
                          processingTimeMs: document.processingTimeMs ?? 0,
                        }
                      : null
                  }
                  active={active}
                />
              </div>
            </div>
          ) : (
            <p className="p-6 text-sm text-muted-foreground" data-testid="reading-no-document">
              {t("linking.reading.noDocument")}
            </p>
          )}
        </div>

        {/* right — what it read, and what one click does with it */}
        <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain border-l border-subtle bg-surface px-4 py-4 text-sm">
          {rereading && (
            <p className="mb-2 px-1 text-xs text-muted-foreground" data-testid="reading-rereading">
              {t("linking.reading.rereading", { paper: paperWord })}
            </p>
          )}
          {note && !rereading && (
            <p className="mb-2 px-1 text-xs text-muted-foreground" data-testid="reading-note">
              {note}
            </p>
          )}
          <fieldset disabled={busy} className="min-w-0" data-testid="reading-fields">
            <WhatItRead
              mode="form"
              fields={fields}
              active={active}
              onActive={setActive}
              onAnswer={(key, raw) => setters[key]?.(raw)}
              canWrite
              formatAmount={(v) => formatMoney(v, currency || row.currency)}
              testId="reading-what-it-read"
            />
          </fieldset>
          {documentId && billedTo && (
            <p
              className="mt-1 px-2.5 text-xs text-muted-foreground"
              data-testid="reading-billed-to"
            >
              {t("linking.reading.billedToLine", { who: billedTo })}
            </p>
          )}
          {kind === "expense" && (
            <p className="mt-1 px-2.5 text-xs text-muted-foreground" data-testid="reading-payer">
              {t("linking.reading.payer", { account: row.accountLabel })}
            </p>
          )}
          <div className="mt-2 flex flex-col gap-1">
            {document && (
              <AlsoReadSection fields={document.fields} modelUsed={document.modelUsed} />
            )}
            {items.length > 0 && (
              <DetailsSection
                title={t("linking.reading.lines", { count: items.length })}
                defaultOpen={false}
              >
                <table
                  className="w-full table-fixed border-collapse text-[13px]"
                  data-testid="reading-lines"
                >
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="font-normal">{t("linking.reading.lines.description")}</th>
                      <th className="w-14 text-right font-normal">
                        {t("linking.reading.lines.quantity")}
                      </th>
                      <th className="w-24 text-right font-normal">
                        {t("linking.reading.lines.amount")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((line, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: the reading's lines have no id; the list is static
                      <tr key={i} className="border-t border-subtle">
                        <td className="truncate py-0.5">{line.description ?? "—"}</td>
                        <td className="py-0.5 text-right tabular-nums">{line.quantity ?? ""}</td>
                        <td className="py-0.5 text-right tabular-nums">
                          {typeof line.amount === "number" ? line.amount.toFixed(2) : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DetailsSection>
            )}
          </div>

          <AcceptChainView
            nodes={nodes}
            label={t("documents.chain.accept.three")}
            onAccept={() => void submit()}
            disabled={busy || missing.length > 0}
            buttonTestId="justify-create"
            hint={
              missing.length > 0 ? (
                <span data-testid="justify-missing">
                  {t("linking.justify.missing", { fields: missing.join(" · ") })}
                </span>
              ) : null
            }
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t px-5 py-2.5">
        <Button variant="ghost" onClick={onCancel} data-testid="justify-cancel">
          {t("linking.justify.cancel")}
        </Button>
      </div>
    </>
  );
}

function greenText(g: GreenCheck, t: ReturnType<typeof useT>): string {
  switch (g.code) {
    case "amount":
      if (g.kind === "equal") return t("linking.reading.check.amount.equal");
      if (g.kind === "fx") return t("linking.reading.check.amount.fx", { currency: g.currency });
      return t("linking.reading.check.amount.within", {
        difference: formatMoney(g.difference, g.currency, { signed: true }),
      });
    case "days":
      return g.days === 0
        ? t("linking.reading.check.sameDay")
        : t("linking.reading.check.days", { days: g.days });
    case "vendor":
      return t("linking.reading.check.vendor");
  }
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[6rem_minmax(0,1fr)]">
      <div className="pt-1 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
