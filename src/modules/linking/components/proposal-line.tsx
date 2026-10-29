"use client";

// The *Proposed* line above a bank row's category form (F98, specs/ai FR-009 + the owner's answers 2026-10-27):
// the proposed category / partner, its family (D40 state colours, the suggestions' words), the source as a word —
// *rule* · *partner default* · *remembered* · *proposed* — the reason, Accept (`a`), Reject (`r`), the
// alternatives as chips. Nothing here is saved until Accept: the categorise service writes, on the owner's key.
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { StateLabel } from "@/kernel/ui/state-label";
import { Tag } from "@/kernel/ui/tags";
import { confidenceFamily } from "../confidence-family";
import { familyOf } from "../proposals/policy";
import type { ProposalDto } from "../proposals/proposals";
import {
  acceptProposalsAction,
  getProposalsAction,
  rejectProposalAction,
} from "../proposals/proposals.actions";
import { ConfidenceLabel } from "./confidence-label";

export type ProposalOptions = {
  categories: { code: string; label: string }[];
  partners: { id: string; name: string }[];
};

export type AcceptedProposal = {
  basCode: string | null;
  partnerId: string | null;
  proposeRule: boolean;
};

/** The current proposals of one row, reloaded when `refreshKey` moves. */
export function useRowProposals(transactionId: string | null, refreshKey = 0) {
  const [proposals, setProposals] = useState<ProposalDto[]>([]);
  const { executeAsync } = useAction(getProposalsAction);
  const reload = useCallback(async () => {
    if (!transactionId) return setProposals([]);
    const r = await executeAsync({ transactionIds: [transactionId] });
    const data = r?.data && "data" in r.data ? r.data.data : undefined;
    setProposals((data?.[transactionId] as ProposalDto[] | undefined) ?? []);
  }, [executeAsync, transactionId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is the reload trigger
  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);
  return { proposals, reload };
}

const FAMILY_WORD = { high: "HIGH", medium: "MEDIUM", low: "LOW" } as const;

export function ProposalLine({
  transactionId,
  proposals,
  options,
  canWrite,
  onDecided,
  acceptKey = 0,
  rejectKey = 0,
}: {
  transactionId: string;
  proposals: ProposalDto[];
  options: ProposalOptions;
  canWrite: boolean;
  /** a decision was written — reload the row (and the list); `accepted` when it was an accept */
  onDecided: (accepted: AcceptedProposal | null) => void;
  /** the inbox's `a` / `r` */
  acceptKey?: number;
  rejectKey?: number;
}) {
  const t = useT();
  const { executeAsync: accept, isPending: accepting } = useAction(acceptProposalsAction);
  const { executeAsync: reject, isPending: rejecting } = useAction(rejectProposalAction);
  const busy = accepting || rejecting;

  const doAccept = useCallback(
    async (input: { proposalIds?: string[]; overrideBasCode?: string }) => {
      const r = await accept({ transactionId, ...input });
      const error = extractError(r);
      if (error) return toast.error(error);
      const d = r?.data && "data" in r.data ? r.data.data : undefined;
      toast.success(t("linking.proposals.accepted"));
      onDecided(
        d ? { basCode: d.basCode, partnerId: d.partnerId, proposeRule: d.proposeRule } : null,
      );
    },
    [accept, onDecided, t, transactionId],
  );

  const doReject = useCallback(
    async (ids: string[]) => {
      for (const proposalId of ids) {
        const r = await reject({ proposalId });
        const error = extractError(r);
        if (error) return toast.error(error);
      }
      toast.success(t("linking.proposals.rejected"));
      onDecided(null);
    },
    [onDecided, reject, t],
  );

  // the inbox's keys: `a` accepts every current proposal of the row, `r` rejects them
  const lastAccept = useRef(acceptKey);
  const lastReject = useRef(rejectKey);
  useEffect(() => {
    if (acceptKey === lastAccept.current) return;
    lastAccept.current = acceptKey;
    if (canWrite && proposals.length) void doAccept({});
  }, [acceptKey, canWrite, proposals.length, doAccept]);
  useEffect(() => {
    if (rejectKey === lastReject.current) return;
    lastReject.current = rejectKey;
    if (canWrite && proposals.length) void doReject(proposals.map((p) => p.id));
  }, [rejectKey, canWrite, proposals, doReject]);

  if (proposals.length === 0) return null;

  const categoryLabel = (code: string) =>
    options.categories.find((c) => c.code === code)?.label ?? code;
  const partnerName = (id: string) =>
    options.partners.find((p) => p.id === id)?.name ?? t("linking.proposals.unknownPartner");

  return (
    <div
      className="grid gap-2 rounded border border-dashed border-primary/60 p-2.5"
      data-testid="proposal-line"
    >
      {proposals.map((p) => (
        <div key={p.id} className="grid gap-1" data-testid={`proposal-${p.kind}`}>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-semibold">{t(`linking.proposals.kind.${p.kind}`)}</span>
            <span data-testid={`proposal-${p.kind}-value`}>
              {p.kind === "bas"
                ? categoryLabel(p.payload.basCode)
                : "partnerId" in p.payload
                  ? partnerName(p.payload.partnerId)
                  : p.payload.newPartner.name}
            </span>
            <ConfidenceLabel confidence={FAMILY_WORD[p.family]} />
            <Tag>{t(`linking.proposals.source.${p.source}`)}</Tag>
          </div>
          {p.reason && <p className="text-xs text-muted-foreground">{p.reason}</p>}
          {p.kind === "bas" && p.payload.alternatives.length > 0 && canWrite && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">{t("linking.proposals.alternatives")}</span>
              {p.payload.alternatives.map((a) => (
                <Button
                  key={a.basCode}
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  title={a.why}
                  disabled={busy}
                  onClick={() => void doAccept({ proposalIds: [p.id], overrideBasCode: a.basCode })}
                >
                  {categoryLabel(a.basCode)}
                </Button>
              ))}
            </div>
          )}
          {canWrite && proposals.length > 1 && (
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                disabled={busy}
                onClick={() => void doAccept({ proposalIds: [p.id] })}
                data-testid={`proposal-${p.kind}-accept`}
              >
                {t("linking.proposals.acceptThis")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                disabled={busy}
                onClick={() => void doReject([p.id])}
              >
                {t("linking.proposals.rejectThis")}
              </Button>
            </div>
          )}
        </div>
      ))}
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void doAccept({})}
            data-testid="proposal-accept"
          >
            {proposals.length > 1
              ? t("linking.proposals.acceptAll")
              : t("linking.proposals.accept")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void doReject(proposals.map((p) => p.id))}
            data-testid="proposal-reject"
          >
            {t("linking.proposals.reject")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The *Proposed* list cell (F98): the code in its family's colour — the list's one view of a proposal. */
export function ProposedCode({
  code,
  confidence,
  source,
}: {
  code: string;
  confidence: number;
  source?: string | null;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={source ?? undefined}
      data-testid="proposed-code"
    >
      <StateLabel family={confidenceFamily(FAMILY_WORD[familyOf(confidence)])} state={code} />
    </span>
  );
}
