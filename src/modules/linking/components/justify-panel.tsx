"use client";

// Justify from the bank row (F97, specs/justify/spec.md): one panel, five ways out — drop the proof (upload →
// OCR → the compare card → *Create & link*), pick what exists (the Suggestions below it), no proof needed (the
// reasons), the receipt lost (the card without a document). Rendered by the banking panel and the inbox's
// right pane for an open outgoing row; the keyboard bumps `proofKey` / `noProofKey` / `lostKey` (p · n · x).
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
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
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { CURRENCIES } from "@/kernel/nav/constants";
import { DetailsSection } from "@/kernel/ui/details-section";
import { Tag } from "@/kernel/ui/tags";
import { createRuleFromTransactionAction } from "@/modules/banking/ui";
import { getDocumentForReviewAction, uploadDocumentAction } from "@/modules/documents/ui";
import { PartnerMatchCard } from "@/modules/partners/ui";
import {
  type CompareCard,
  compareRowToReading,
  type JustifyKind,
  NO_PROOF_REASONS,
  type NoProofReason,
  proposeKind,
  type Reading,
  type RowForJustify,
} from "../justify-rules";
import {
  counterpartyMemoryAction,
  justifyRowAction,
  noProofNeededAction,
} from "../linking.actions";

/** The option lists the card needs — loaded by the page (`justifyOptions`), plain data. */
export type JustifyOptions = {
  groups: { id: string; label: string }[];
  /** the expense categories (a short code each — the keys need one) */
  categories: { code: string; label: string }[];
  partners: { id: string; name: string; defaultBasCode: string | null }[];
};

const NONE = "__none__";
const OCR_POLL_MS = 2000;
const OCR_WAIT_MS = 60_000;
const READ_STATES = new Set(["extracted", "reviewed", "ocr_failed"]);

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "reading"; documentId: string; startedAt: number }
  | { kind: "card"; documentId: string | null; reading: Reading; note: string | null };

export function JustifyPanel({
  row,
  canWrite,
  options,
  onDone,
  proofKey = 0,
  noProofKey = 0,
  lostKey = 0,
}: {
  row: RowForJustify;
  canWrite: boolean;
  options: JustifyOptions | null;
  /** the row is justified (or flagged): the host reloads and moves on */
  onDone?: () => void;
  proofKey?: number;
  noProofKey?: number;
  lostKey?: number;
}) {
  const t = useT();
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const [kind, setKind] = useState<JustifyKind>(() => proposeKind(row, {}));
  const { executeAsync: upload } = useAction(uploadDocumentAction);
  const { executeAsync: readDocument } = useAction(getDocumentForReviewAction);
  const { executeAsync: noProof, isPending: flagging } = useAction(noProofNeededAction);
  const { executeAsync: createRule } = useAction(createRuleFromTransactionAction);

  const incoming = Number(row.amount) > 0;

  // the keyboard: p opens the file picker, n the reasons, x the card without a document
  // biome-ignore lint/correctness/useExhaustiveDependencies: the keys are the signals
  useEffect(() => {
    if (proofKey > 0 && !incoming) fileInput.current?.click();
  }, [proofKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the keys are the signals
  useEffect(() => {
    if (noProofKey > 0) setReasonsOpen(true);
  }, [noProofKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the keys are the signals
  useEffect(() => {
    if (lostKey > 0 && !incoming)
      setPhase({ kind: "card", documentId: null, reading: {}, note: null });
  }, [lostKey]);

  // the OCR wait: poll the review read until the document is read (or the OCR failed), 60 s at most
  useEffect(() => {
    if (phase.kind !== "reading") return;
    const { documentId, startedAt } = phase;
    let live = true;
    const tick = async () => {
      const r = await readDocument({ documentId });
      const d = r?.data && "data" in r.data ? r.data.data : undefined;
      if (!live) return;
      if (d && READ_STATES.has(d.status)) {
        const reading = d.status === "ocr_failed" ? {} : d.resolvedData;
        setKind(proposeKind(row, reading));
        setPhase({
          kind: "card",
          documentId,
          reading,
          note: d.status === "ocr_failed" ? t("linking.justify.readFailed") : null,
        });
        return;
      }
      if (Date.now() - startedAt > OCR_WAIT_MS) {
        setPhase({ kind: "card", documentId, reading: {}, note: t("linking.justify.readTimeout") });
        return;
      }
      timer = setTimeout(tick, OCR_POLL_MS);
    };
    let timer = setTimeout(tick, OCR_POLL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [phase, readDocument, row, t]);

  async function takeFile(file: File) {
    setPhase({ kind: "uploading" });
    const formData = new FormData();
    formData.append("file", file);
    formData.append("prefixType", kind === "expense" ? "expense" : "invoice");
    const r = await upload(formData);
    const error = extractError(r);
    if (error) {
      toast.error(error);
      setPhase({ kind: "idle" });
      return;
    }
    const data = r?.data && "data" in r.data ? r.data.data : undefined;
    if (!data) {
      setPhase({ kind: "idle" });
      return;
    }
    if (data.kind === "duplicate") {
      toast.message(t("linking.justify.duplicate"));
      setPhase({ kind: "reading", documentId: data.existing.id, startedAt: Date.now() });
      return;
    }
    setPhase({ kind: "reading", documentId: data.id, startedAt: Date.now() });
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void takeFile(file);
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void takeFile(file);
  }

  async function flag(reason: NoProofReason) {
    setReasonsOpen(false);
    const r = await noProof({ transactionId: row.id, reason });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const data = r?.data && "data" in r.data ? r.data.data : undefined;
    toast.success(t("linking.justify.noProofDone"));
    if (data?.proposeRule) {
      toast(t("linking.justify.proposeRule", { counterparty: row.counterpartyKey }), {
        action: {
          label: t("linking.justify.proposeRuleAction"),
          onClick: () => {
            void createRule({
              transactionId: row.id,
              noDocumentNeeded: true,
              ...(data.basCode ? { basCode: data.basCode } : {}),
            }).then((rr) => {
              const err = extractError(rr);
              if (err) toast.error(err);
              else toast.success(t("linking.justify.ruleCreated"));
            });
          },
        },
      });
    }
    onDone?.();
  }

  if (!canWrite) return null;

  return (
    <DetailsSection title={t("linking.justify.title")}>
      {incoming ? (
        <p className="text-sm text-muted-foreground">{t("linking.justify.incoming")}</p>
      ) : phase.kind === "card" ? (
        options ? (
          <CompareCardForm
            row={row}
            documentId={phase.documentId}
            reading={phase.reading}
            note={phase.note}
            kind={kind}
            onKind={setKind}
            options={options}
            onCancel={() => setPhase({ kind: "idle" })}
            onDone={() => {
              setPhase({ kind: "idle" });
              onDone?.();
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t("linking.justify.needsOptions")}</p>
        )
      ) : (
        <div className="flex flex-col gap-3" data-testid="justify-panel">
          {/* biome-ignore lint/a11y/noStaticElementInteractions: the drop target; the button inside is the keyboard path */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex flex-wrap items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-4 text-sm ${
              dragging ? "border-primary bg-primary/5" : "border-border"
            }`}
            data-testid="justify-drop"
          >
            {phase.kind === "uploading" ? (
              <span className="text-muted-foreground">{t("linking.justify.uploading")}</span>
            ) : phase.kind === "reading" ? (
              <span className="text-muted-foreground">{t("linking.justify.reading")}</span>
            ) : (
              <>
                <span className="text-muted-foreground">{t("linking.justify.drop")}</span>
                <Button
                  size="sm"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => fileInput.current?.click()}
                  data-testid="justify-choose"
                >
                  {t("linking.justify.choose")}
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf"
                  className="hidden"
                  onChange={onPick}
                  data-testid="justify-file"
                />
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <KindToggle kind={kind} onKind={setKind} />
            <span className="grow" />
            {reasonsOpen ? (
              <div className="flex flex-wrap gap-1" data-testid="justify-reasons">
                {NO_PROOF_REASONS.map((reason) => (
                  <Button
                    key={reason}
                    size="sm"
                    variant="outline"
                    disabled={flagging}
                    onClick={() => void flag(reason)}
                    data-testid={`justify-reason-${reason}`}
                  >
                    {t(`linking.justify.reason.${reason}`)}
                  </Button>
                ))}
              </div>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setReasonsOpen(true)}
                  data-testid="justify-no-proof"
                >
                  {t("linking.justify.noProof")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setPhase({ kind: "card", documentId: null, reading: {}, note: null })
                  }
                  data-testid="justify-lost"
                >
                  {t("linking.justify.lost")}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </DetailsSection>
  );
}

function KindToggle({ kind, onKind }: { kind: JustifyKind; onKind: (k: JustifyKind) => void }) {
  const t = useT();
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={t("linking.justify.field.kind")}>
      {(["supplier_invoice", "expense"] as const).map((k) => (
        <Button
          key={k}
          size="sm"
          variant={kind === k ? "secondary" : "ghost"}
          role="radio"
          aria-checked={kind === k}
          onClick={() => onKind(k)}
          data-testid={`justify-kind-${k}`}
        >
          {t(`linking.justify.kind.${k}`)}
        </Button>
      ))}
    </div>
  );
}

/** The compare card: the two sides, the verdicts, the few fields the entity needs, the one button. */
function CompareCardForm({
  row,
  documentId,
  reading,
  note,
  kind,
  onKind,
  options,
  onCancel,
  onDone,
}: {
  row: RowForJustify;
  documentId: string | null;
  reading: Reading;
  note: string | null;
  kind: JustifyKind;
  onKind: (k: JustifyKind) => void;
  options: JustifyOptions;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const ids = useId();
  const card: CompareCard = compareRowToReading(row, reading);
  const { executeAsync: justify, isPending } = useAction(justifyRowAction);

  // the fields, pre-filled from the reading, else from the row
  const [partnerId, setPartnerId] = useState<string>(NONE);
  const [extraPartners, setExtraPartners] = useState<JustifyOptions["partners"]>([]);
  const [invoiceNumber, setInvoiceNumber] = useState(card.invoiceNumber ?? "");
  const [date, setDate] = useState(card.documentDate ?? row.bookingDate);
  const [description, setDescription] = useState(card.vendorName ?? row.description);
  const [amount, setAmount] = useState(card.documentAmount ?? card.rowAmount);
  const [currency, setCurrency] = useState(card.documentCurrency ?? row.currency);
  const [vat, setVat] = useState(
    typeof reading.totalTax === "number" && reading.totalTax > 0 ? reading.totalTax.toFixed(2) : "",
  );
  const [basCode, setBasCode] = useState<string>(NONE);
  const [groupId, setGroupId] = useState<string>(options.groups[0]?.id ?? NONE);
  const partners = [...extraPartners, ...options.partners];

  // the partner's default category fills an empty one (journal T002, on the row)
  function pickPartner(id: string) {
    setPartnerId(id);
    const p = partners.find((x) => x.id === id);
    if (basCode === NONE && p?.defaultBasCode) setBasCode(p.defaultBasCode);
  }

  // the counterparty memory (F116 US3): the partner this row's counterparty was linked to most often is proposed
  // when nothing else picked one — the same memory the suggestions score with
  const { executeAsync: loadMemory } = useAction(counterpartyMemoryAction);
  const [remembered, setRemembered] = useState<{ name: string; count: number } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per row — the proposal must not override a later pick
  useEffect(() => {
    let live = true;
    void loadMemory({ bankTransactionId: row.id }).then((r) => {
      const result = r?.data;
      const list = result && "data" in result ? result.data : [];
      const top = list.find((m) => options.partners.some((p) => p.id === m.partnerId));
      if (!live || !top) return;
      setRemembered({ name: top.name, count: top.count });
      setPartnerId((current) => {
        if (current !== NONE) return current;
        const p = options.partners.find((x) => x.id === top.partnerId);
        if (p?.defaultBasCode) setBasCode((b) => (b === NONE ? (p.defaultBasCode ?? NONE) : b));
        return top.partnerId;
      });
    });
    return () => {
      live = false;
    };
  }, [row.id]);

  async function submit() {
    const common = { transactionId: row.id, ...(documentId ? { documentId } : {}) };
    const net =
      vat && Number(vat) > 0
        ? (Number(amount) - Number(vat)).toFixed(2)
        : Number(amount).toFixed(2);
    const r =
      kind === "supplier_invoice"
        ? await justify({
            ...common,
            kind: "supplier_invoice",
            supplier: {
              groupId,
              partnerId,
              invoiceNumber,
              invoiceDate: date,
              currency: currency as (typeof CURRENCIES)[number],
              amountNet: net,
              ...(vat && Number(vat) > 0 ? { vatAmount: Number(vat).toFixed(2) } : {}),
              amountTotal: Number(amount).toFixed(2),
              basCode: basCode === NONE ? "" : basCode,
            },
          })
        : await justify({
            ...common,
            kind: "expense",
            expense: {
              groupId,
              date,
              description,
              basCode: basCode === NONE ? "" : basCode,
              amount: Number(amount).toFixed(2),
              currency: currency as (typeof CURRENCIES)[number],
              ...(vat && Number(vat) > 0 ? { vatAmount: Number(vat).toFixed(2) } : {}),
              partnerId: partnerId === NONE ? null : partnerId,
            },
          });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const data = r?.data && "data" in r.data ? r.data.data : undefined;
    toast.success(t("linking.justify.done", { key: data?.entity.key ?? "" }));
    onDone();
  }

  const verdict = card.currencyDiffers
    ? t("linking.justify.card.otherCurrency")
    : card.documentAmount === null
      ? t("linking.justify.card.noReading")
      : card.equal
        ? t("linking.justify.card.equal")
        : t("linking.justify.card.off", { delta: formatMoney(card.delta ?? "0", row.currency) });
  const dayText =
    card.days === null
      ? null
      : card.days === 0
        ? t("linking.justify.card.sameDay")
        : t("linking.justify.card.days", { days: card.days });

  return (
    <div className="flex flex-col gap-3" data-testid="justify-card">
      {/* the two sides */}
      <div className="grid gap-1 rounded-lg border px-3 py-2 text-sm tabular-nums">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="w-20 shrink-0 text-xs text-muted-foreground">
            {t("linking.justify.card.document")}
          </span>
          {documentId ? (
            <>
              <span>
                {card.documentAmount
                  ? formatMoney(card.documentAmount, card.documentCurrency)
                  : "—"}
              </span>
              <span>{card.documentDate ?? "—"}</span>
              <span className="truncate">{card.vendorName ?? "—"}</span>
              {card.vatNumber && <Tag>{card.vatNumber}</Tag>}
              {card.invoiceNumber && <Tag>{card.invoiceNumber}</Tag>}
            </>
          ) : (
            <span className="text-muted-foreground">{t("linking.justify.card.lostTitle")}</span>
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="w-20 shrink-0 text-xs text-muted-foreground">
            {t("linking.justify.card.row")}
          </span>
          <span>{formatMoney(row.amount, row.currency, { signed: true })}</span>
          <span>{row.bookingDate}</span>
          <span className="truncate">{row.description}</span>
        </div>
        {documentId && (
          <div className="text-xs text-muted-foreground" data-testid="justify-verdict">
            {verdict}
            {dayText ? ` · ${dayText}` : ""}
          </div>
        )}
        {note && <div className="text-xs text-muted-foreground">{note}</div>}
      </div>

      <KindToggle kind={kind} onKind={onKind} />

      {(card.vendorName || card.vatNumber) && (
        <PartnerMatchCard
          vendor={{
            name: card.vendorName,
            vatNumber: card.vatNumber,
            address: reading.vendorAddress ?? null,
          }}
          selectedId={partnerId === NONE ? "" : partnerId}
          onUseMatch={pickPartner}
          onCreated={(p) => {
            setExtraPartners((prev) => [{ id: p.id, name: p.name, defaultBasCode: null }, ...prev]);
            pickPartner(p.id);
          }}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${ids}-partner`} label={t("linking.justify.field.partner")}>
          <Select value={partnerId} onValueChange={(v) => pickPartner(v ?? NONE)}>
            <SelectTrigger id={`${ids}-partner`} className="w-full" data-testid="justify-partner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("linking.justify.field.noPartner")}</SelectItem>
              {partners.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {remembered && (
            <p className="text-xs text-muted-foreground" data-testid="justify-remembered">
              {t("linking.justify.remembered", {
                name: remembered.name,
                count: String(remembered.count),
              })}
            </p>
          )}
        </Field>
        {kind === "supplier_invoice" ? (
          <Field id={`${ids}-number`} label={t("linking.justify.field.invoiceNumber")}>
            <Input
              id={`${ids}-number`}
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              data-testid="justify-invoice-number"
            />
          </Field>
        ) : (
          <Field id={`${ids}-description`} label={t("linking.justify.field.description")}>
            <Input
              id={`${ids}-description`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="justify-description"
            />
          </Field>
        )}
        <Field id={`${ids}-date`} label={t("linking.justify.field.date")}>
          <Input
            id={`${ids}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field id={`${ids}-amount`} label={t("linking.justify.field.amount")}>
            <Input
              id={`${ids}-amount`}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="justify-amount"
            />
          </Field>
          <Field id={`${ids}-currency`} label={t("linking.justify.field.currency")}>
            <Select value={currency} onValueChange={(v) => setCurrency(v ?? row.currency)}>
              <SelectTrigger id={`${ids}-currency`} className="w-full">
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
          </Field>
        </div>
        <Field id={`${ids}-vat`} label={t("linking.justify.field.vat")}>
          <Input
            id={`${ids}-vat`}
            inputMode="decimal"
            value={vat}
            onChange={(e) => setVat(e.target.value)}
          />
        </Field>
        <Field id={`${ids}-cat`} label={t("linking.justify.field.category")}>
          <Select value={basCode} onValueChange={(v) => setBasCode(v ?? NONE)}>
            <SelectTrigger id={`${ids}-cat`} className="w-full" data-testid="justify-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {options.categories.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id={`${ids}-group`} label={t("linking.justify.field.group")}>
          <Select value={groupId} onValueChange={(v) => setGroupId(v ?? NONE)}>
            <SelectTrigger id={`${ids}-group`} className="w-full" data-testid="justify-group">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {kind === "expense" && (
          <Field id={`${ids}-payer`} label={t("linking.justify.field.payer")}>
            <Input id={`${ids}-payer`} value={row.accountLabel} readOnly />
          </Field>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => void submit()}
          disabled={
            isPending ||
            groupId === NONE ||
            basCode === NONE ||
            (kind === "supplier_invoice" && partnerId === NONE)
          }
          data-testid="justify-create"
        >
          {t(`linking.justify.create.${kind}`)}
        </Button>
        {documentId && (
          <Button
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={<Link href={`/documents/${documentId}`} />}
          >
            {t("linking.justify.fix")}
          </Button>
        )}
        <span className="grow" />
        <Button size="sm" variant="ghost" onClick={onCancel} data-testid="justify-cancel">
          {t("linking.justify.cancel")}
        </Button>
      </div>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
