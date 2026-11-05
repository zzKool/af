"use client";

// Justify from the bank row (F97, specs/justify/spec.md; F131 review 2026-10-31 §6.3): one panel, five ways out —
// drop the proof (the paper question *Invoice / Receipt* (D75) → upload → OCR → the READING DIALOG → *Confirm &
// link*), pick what exists (the Suggestions below it, *Use it* on an inbox proof → the dialog), no proof needed
// (the reasons, the partner line), the receipt lost (the dialog without a paper). Rendered by the banking panel and
// the inbox's right pane for an open outgoing row; the keyboard bumps `proofKey` / `noProofKey` / `lostKey`
// (p · n · x). The F97 compare card, *Create as* and *Fix the reading →* retired with the dialog (review §7).
import { useAction } from "next-safe-action/hooks";
import { type ChangeEvent, type DragEvent, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { DetailsSection } from "@/kernel/ui/details-section";
import { createRuleFromTransactionAction } from "@/modules/banking/ui";
import {
  classifyDocumentAction,
  getDocumentForReviewAction,
  uploadDocumentAction,
} from "@/modules/documents/ui";
import { isSystemRole } from "@/modules/partners/ui";
import type { BasOption } from "@/modules/settings/ui";
import {
  DEFAULT_PAPER,
  NO_PROOF_REASONS,
  NO_PROOF_REASONS_INCOMING,
  type NoProofReason,
  PAPERS,
  type Paper,
  type ProposedPartner,
  paperOfPrefixType,
  prefixTypeOfPaper,
  proposedPartnerRole,
  type Reading,
  type RowForJustify,
} from "../justify-rules";
import {
  counterpartyMemoryAction,
  noProofNeededAction,
  suggestionsForTransactionAction,
} from "../linking.actions";
import type { ProposalDto, Suggestion } from "../types";
import { ConfidenceLabel } from "./confidence-label";
import { type ReadDocument, ReadingDialog } from "./reading-dialog";

/** A partner as the panel's pickers know it: F129 adds its types and the role a seeded one plays; F131 its VAT number. */
export type JustifyPartner = {
  id: string;
  name: string;
  defaultBasCode: string | null;
  types?: string[];
  systemRole?: string | null;
  /** the vendor check compares the paper's VAT number with the picked partner's (F130) */
  vatNumber?: string | null;
};

/** A group as the dialog proposes it (F131, review §5.2): its kind and, for a trip, its first and last day. */
export type JustifyGroup = {
  id: string;
  label: string;
  number?: number;
  description?: string;
  kind?: "trip" | "batch";
  departure?: string | null;
  return?: string | null;
};

/** The option lists the dialog needs — loaded by the page (`justifyOptions`), plain data. */
export type JustifyOptions = {
  groups: JustifyGroup[];
  /** the expense categories (a short code each — the keys need one) */
  categories: BasOption[];
  /** the active partners */
  partners: JustifyPartner[];
  /** per partner, the accounts used before (F125 PR 2) */
  basHistory?: Record<string, { code: string; count: number }[]>;
  /** F129: the roles whose partner exists but was deactivated — the reasons' line says so instead of proposing */
  inactiveRoles?: string[];
};

const NONE = "__none__";
/** the word for a reason's proposed partner (F129) */
const ROLE_KEYS = {
  bank: "linking.justify.role.bank",
  tax_agency_se: "linking.justify.role.tax_agency_se",
  tax_agency_ch: "linking.justify.role.tax_agency_ch",
  owner: "linking.justify.role.owner",
  client: "linking.justify.role.client",
} as const;
const OCR_POLL_MS = 2000;
const OCR_WAIT_MS = 60_000;
const READ_STATES = new Set(["extracted", "reviewed", "ocr_failed"]);

/** The dialog's inputs once the reading is there (or the receipt is lost) — `readKey` remounts the form on a new reading. */
type CardPhase = {
  kind: "card";
  documentId: string | null;
  document: ReadDocument | null;
  reading: Reading;
  note: string | null;
  readKey: number;
};
type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  /** the OCR wait; `previous` keeps the dialog open while the paper is read again with the other model (D75) */
  | { kind: "reading"; documentId: string; startedAt: number; previous?: CardPhase }
  | CardPhase;

export function JustifyPanel({
  row,
  canWrite,
  options,
  proposals = [],
  onDone,
  onProofRead,
  proofKey = 0,
  noProofKey = 0,
  lostKey = 0,
}: {
  row: RowForJustify;
  canWrite: boolean;
  options: JustifyOptions | null;
  /** the row's current proposals (F98): a HIGH one pre-fills the card's category / supplier */
  proposals?: ProposalDto[];
  /** the row is justified (or flagged): the host reloads and moves on */
  onDone?: () => void;
  /** a proof was read for this row (the card is up): the host may refresh its suggestions */
  onProofRead?: () => void;
  proofKey?: number;
  noProofKey?: number;
  lostKey?: number;
}) {
  const t = useT();
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const [reasonsOpen, setReasonsOpen] = useState(false);
  /** the *no proof* reason picked — the partner line follows it (F129 US3) */
  const [reason, setReason] = useState<NoProofReason | null>(null);
  /** the paper question (D75): asked on every drop, *Invoice* by default — it picks the reading model */
  const [paper, setPaper] = useState<Paper>(DEFAULT_PAPER);
  const { executeAsync: upload } = useAction(uploadDocumentAction);
  const { executeAsync: readDocument } = useAction(getDocumentForReviewAction);
  const { executeAsync: classify } = useAction(classifyDocumentAction);
  const { executeAsync: noProof, isPending: flagging } = useAction(noProofNeededAction);
  const { executeAsync: createRule } = useAction(createRuleFromTransactionAction);

  const incoming = Number(row.amount) > 0;

  // T008: a proof already in the inbox — the documents that score for this row, offered before any upload.
  // A document uploaded from this row but not turned into anything yet comes back here after a reload.
  const { executeAsync: loadSuggestions } = useAction(suggestionsForTransactionAction);
  const [inboxProofs, setInboxProofs] = useState<Suggestion[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per row and per host refresh (proofKey is a signal)
  useEffect(() => {
    if (incoming || !canWrite) return;
    let live = true;
    void loadSuggestions({ bankTransactionId: row.id }).then((r) => {
      const d = r?.data && "data" in r.data ? r.data.data : undefined;
      if (!live || !d) return;
      setInboxProofs(d.suggestions.filter((s) => s.candidate.type === "document").slice(0, 3));
    });
    return () => {
      live = false;
    };
  }, [row.id, phase.kind === "idle"]);

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
      setPhase({
        kind: "card",
        documentId: null,
        document: null,
        reading: {},
        note: null,
        readKey: lostKey,
      });
  }, [lostKey]);

  // the OCR wait: poll the review read until the document is read (or the OCR failed), 60 s at most — then the dialog
  useEffect(() => {
    if (phase.kind !== "reading") return;
    const { documentId, startedAt, previous } = phase;
    const readKey = (previous?.readKey ?? 0) + 1;
    let live = true;
    const tick = async () => {
      const r = await readDocument({ documentId });
      const d = r?.data && "data" in r.data ? r.data.data : undefined;
      if (!live) return;
      if (d && READ_STATES.has(d.status)) {
        const reading = d.status === "ocr_failed" ? {} : d.resolvedData;
        // a document uploaded before (*Use it*, a duplicate) carries its own type — the paper radio says it
        setPaper(paperOfPrefixType(d.prefixType));
        setPhase({
          kind: "card",
          documentId,
          document: {
            fileUrl: d.fileUrl,
            mimeType: d.mimeType,
            prefixType: d.prefixType,
            fields: d.extractedData?.fields,
            modelUsed: d.extractedData?.modelUsed,
          },
          reading,
          note: d.status === "ocr_failed" ? t("linking.reading.readFailed") : null,
          readKey,
        });
        onProofRead?.();
        return;
      }
      if (Date.now() - startedAt > OCR_WAIT_MS) {
        setPhase({
          kind: "card",
          documentId,
          document: d
            ? {
                fileUrl: d.fileUrl,
                mimeType: d.mimeType,
                prefixType: d.prefixType,
                fields: undefined,
                modelUsed: undefined,
              }
            : null,
          reading: {},
          note: t("linking.justify.readTimeout"),
          readKey,
        });
        return;
      }
      timer = setTimeout(tick, OCR_POLL_MS);
    };
    let timer = setTimeout(tick, 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [phase, readDocument, t, onProofRead]);

  async function takeFile(file: File) {
    setPhase({ kind: "uploading" });
    const formData = new FormData();
    formData.append("file", file);
    // D75: the paper picks the model — Invoice → prebuilt-invoice, Receipt → prebuilt-receipt (kernel/ocr)
    formData.append("prefixType", prefixTypeOfPaper(paper));
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

  /** D75 in the dialog: the other paper → the document's type changes and the other model reads it again */
  async function switchPaper(current: CardPhase, next: Paper) {
    if (!current.documentId) return;
    setPaper(next);
    const r = await classify({
      documentId: current.documentId,
      documentType: prefixTypeOfPaper(next),
    });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      setPaper(paper);
      return;
    }
    setPhase({
      kind: "reading",
      documentId: current.documentId,
      startedAt: Date.now(),
      previous: current,
    });
  }

  /** the reason and the partner the statement names → the flag, the account and the partner on the row (D73 (b)) */
  async function flag(picked: NoProofReason, partnerId: string) {
    const r = await noProof({ transactionId: row.id, reason: picked, partnerId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    setReasonsOpen(false);
    setReason(null);
    const data = r?.data && "data" in r.data ? r.data.data : undefined;
    toast.success(t("linking.justify.noProofDone"));
    if (data?.proposeRule) {
      // the learned rule carries the partner: `createRuleFromTransaction` copies the row's facts
      toast(t("linking.justify.proposeRule", { counterparty: row.counterpartyKey }), {
        action: {
          label: t("linking.justify.proposeRuleAction"),
          onClick: () => {
            void createRule({
              transactionId: row.id,
              noDocumentNeeded: true,
              partnerId,
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

  const reasons = incoming ? NO_PROOF_REASONS_INCOMING : NO_PROOF_REASONS;
  const reasonButtons = reasonsOpen ? (
    <div className="flex flex-wrap gap-1" data-testid="justify-reasons">
      {reasons.map((candidate) => (
        <Button
          key={candidate}
          size="sm"
          variant={reason === candidate ? "secondary" : "outline"}
          disabled={flagging}
          onClick={() => setReason(candidate)}
          data-testid={`justify-reason-${candidate}`}
        >
          {t(`linking.justify.reason.${candidate}`)}
        </Button>
      ))}
    </div>
  ) : (
    <Button
      size="sm"
      variant="outline"
      onClick={() => setReasonsOpen(true)}
      data-testid="justify-no-proof"
    >
      {t("linking.justify.noProof")}
    </Button>
  );
  const partnerLine =
    reason && options ? (
      <NoProofPartnerLine
        key={reason}
        row={row}
        reason={reason}
        options={options}
        pending={flagging}
        onDone={(partnerId) => void flag(reason, partnerId)}
        onCancel={() => {
          setReason(null);
          setReasonsOpen(false);
        }}
      />
    ) : reason ? (
      <p className="text-sm text-muted-foreground">{t("linking.justify.needsOptions")}</p>
    ) : null;

  // the dialog: on the reading (and while the paper is read again), on *Use it*, on *Receipt lost*
  const dialogPhase: CardPhase | null =
    phase.kind === "card" ? phase : phase.kind === "reading" ? (phase.previous ?? null) : null;
  const dialog =
    dialogPhase && options ? (
      <ReadingDialog
        key={dialogPhase.readKey}
        row={row}
        documentId={dialogPhase.documentId}
        document={dialogPhase.document}
        reading={dialogPhase.reading}
        note={dialogPhase.note}
        paper={paper}
        onPaper={(p) => void switchPaper(dialogPhase, p)}
        rereading={phase.kind === "reading"}
        options={options}
        proposals={proposals}
        onCancel={() => setPhase({ kind: "idle" })}
        onDone={() => {
          setPhase({ kind: "idle" });
          onDone?.();
        }}
      />
    ) : null;

  return (
    <DetailsSection title={t("linking.justify.title")}>
      {dialog}
      {incoming ? (
        <div className="flex flex-col gap-3" data-testid="justify-panel">
          <p className="text-sm text-muted-foreground">{t("linking.justify.incoming")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="grow" />
            {reasonButtons}
          </div>
          {partnerLine}
        </div>
      ) : phase.kind === "card" && !options ? (
        <p className="text-sm text-muted-foreground">{t("linking.justify.needsOptions")}</p>
      ) : (
        <div className="flex flex-col gap-3" data-testid="justify-panel">
          {inboxProofs.length > 0 && phase.kind === "idle" && (
            <div
              className="rounded-lg border bg-muted/40 px-3 py-2 text-sm"
              data-testid="justify-inbox-proofs"
            >
              <div className="mb-1 text-xs font-medium">{t("linking.justify.inboxProofs")}</div>
              <ul className="flex flex-col gap-1">
                {inboxProofs.map((s) => (
                  <li key={s.candidate.id} className="flex items-center gap-2">
                    <ConfidenceLabel confidence={s.confidence} />
                    <span className="min-w-0 flex-1 truncate">{s.candidate.label}</span>
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {s.candidate.date}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setPhase({
                          kind: "reading",
                          documentId: s.candidate.id,
                          startedAt: Date.now(),
                        })
                      }
                      data-testid="justify-use-proof"
                    >
                      {t("linking.justify.useProof")}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
            <PaperQuestion paper={paper} onPaper={setPaper} />
            <span className="grow" />
            {reasonButtons}
            {!reasonsOpen && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setPhase({
                    kind: "card",
                    documentId: null,
                    document: null,
                    reading: {},
                    note: null,
                    readKey: Date.now(),
                  })
                }
                data-testid="justify-lost"
              >
                {t("linking.justify.lost")}
              </Button>
            )}
          </div>
          {partnerLine}
        </div>
      )}
    </DetailsSection>
  );
}

/**
 * The partner line after a *no proof* reason (F129 US3, D73 (b)): the reason proposes a partner by type — the bank,
 * the tax agency of the account's currency, the owner as employee — marked as a proposal; *client paid* and *other*
 * start from the counterparty memory (*remembered*) or empty. *Done* waits for a partner: the statement is the
 * proof, the partner says of what. A required pick never comes from list order (lessons, F124).
 */
function NoProofPartnerLine({
  row,
  reason,
  options,
  pending,
  onDone,
  onCancel,
}: {
  row: RowForJustify;
  reason: NoProofReason;
  options: JustifyOptions;
  pending: boolean;
  onDone: (partnerId: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const ids = useId();
  const proposal: ProposedPartner = proposedPartnerRole(reason, row.currency);
  const roleWord = (r: Exclude<ProposedPartner, null>) => t(ROLE_KEYS[r]);
  // a system partner's role → the partner holding it (active); the client and *other* have none by type
  const systemRole = isSystemRole(proposal) ? proposal : null;
  const byRole = systemRole ? options.partners.find((p) => p.systemRole === systemRole) : undefined;
  const roleInactive = !!systemRole && (options.inactiveRoles ?? []).includes(systemRole);
  const [partnerId, setPartnerId] = useState<string>(byRole?.id ?? NONE);
  const [remembered, setRemembered] = useState<{ id: string; name: string; count: number } | null>(
    null,
  );
  const { executeAsync: loadMemory } = useAction(counterpartyMemoryAction);
  // the memory proposes when the reason has no partner by type (client paid, other) or the role's partner is missing
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per row and reason — the proposal must not override a later pick
  useEffect(() => {
    if (byRole) return;
    let live = true;
    void loadMemory({ bankTransactionId: row.id }).then((r) => {
      const result = r?.data;
      const list = result && "data" in result ? result.data : [];
      const top = list.find((m) => options.partners.some((p) => p.id === m.partnerId));
      if (!live || !top) return;
      setRemembered({ id: top.partnerId, name: top.name, count: top.count });
      setPartnerId((current) => (current === NONE ? top.partnerId : current));
    });
    return () => {
      live = false;
    };
  }, [row.id, reason]);

  const picked = options.partners.find((p) => p.id === partnerId);
  const hint =
    partnerId !== NONE && byRole && partnerId === byRole.id
      ? t("linking.justify.partnerLine.proposed", {
          name: byRole.name,
          role: roleWord(systemRole as Exclude<ProposedPartner, null>),
        })
      : partnerId !== NONE && remembered && partnerId === remembered.id
        ? t("linking.justify.partnerLine.remembered", {
            name: remembered.name,
            count: String(remembered.count),
          })
        : roleInactive && partnerId === NONE
          ? t("linking.justify.partnerLine.inactive", {
              role: roleWord(systemRole as Exclude<ProposedPartner, null>),
            })
          : partnerId === NONE
            ? t("linking.justify.partnerLine.empty")
            : null;

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border px-3 py-2 text-sm"
      data-testid="justify-partner-line"
    >
      <div className="text-xs font-medium">
        {t("linking.justify.partnerLine.title", { reason: t(`linking.justify.reason.${reason}`) })}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor={`${ids}-np-partner`} className="mb-1 block text-xs font-medium">
            {t("linking.justify.partnerLine.label")}
          </label>
          <Select value={partnerId} onValueChange={(v) => setPartnerId(v ?? NONE)}>
            <SelectTrigger
              id={`${ids}-np-partner`}
              className="w-full"
              data-testid="justify-no-proof-partner"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("linking.justify.field.noPartner")}</SelectItem>
              {options.partners.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hint && (
            <p className="mt-1 text-xs text-muted-foreground" data-testid="justify-partner-hint">
              {hint}
            </p>
          )}
        </div>
        <div className="flex items-end gap-2">
          <Button
            size="sm"
            disabled={pending || partnerId === NONE || !picked}
            onClick={() => onDone(partnerId)}
            data-testid="justify-no-proof-done"
          >
            {t("linking.justify.partnerLine.done")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            data-testid="justify-no-proof-cancel"
          >
            {t("linking.justify.cancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The paper question (D75, O5): *(•) Invoice ( ) Receipt* before DI runs — the paper picks the reading model. */
function PaperQuestion({ paper, onPaper }: { paper: Paper; onPaper: (p: Paper) => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{t("linking.justify.paper")}</span>
        <div className="flex gap-1" role="radiogroup" aria-label={t("linking.justify.paper")}>
          {PAPERS.map((p) => (
            <Button
              key={p}
              size="sm"
              variant={paper === p ? "secondary" : "ghost"}
              role="radio"
              aria-checked={paper === p}
              onClick={() => onPaper(p)}
              data-testid={`justify-paper-${p}`}
            >
              {t(`linking.justify.paper.${p}`)}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("linking.justify.paperHint")}</p>
    </div>
  );
}
