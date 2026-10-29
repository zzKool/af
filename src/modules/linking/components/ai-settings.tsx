"use client";

// Settings → AI (F98, specs/ai FR-009 · docs/local-ai.md §8): the model endpoint's state (never a prompt, never an
// answer), what the proposals did in the last 30 / 90 days per source, and *Run now* — the nightly run, queued.
// No model picker, no thresholds: the box's env vars and `proposals/policy.ts` are the configuration.
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AiStatus } from "@/kernel/ai/types";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { DetailsGrid, DetailsSection } from "@/kernel/ui/details-section";
import { type StateFamily, StateLabel } from "@/kernel/ui/state-label";
import { CodeChip, Tag } from "@/kernel/ui/tags";
import type { ProposalStats } from "../proposals/proposals";
import { getAiOverviewAction, runProposalsNowAction } from "../proposals/proposals.actions";

const STATUS_FAMILY: Record<AiStatus["state"], StateFamily> = {
  ok: "done",
  mock: "progress",
  off: "neutral",
  unreachable: "attention",
};

const percent = (part: number, whole: number) =>
  whole === 0 ? "—" : `${Math.round((part / whole) * 100)} %`;

export function AiSettings({
  initial,
  canRun,
}: {
  initial: { status: AiStatus; last30: ProposalStats; last90: ProposalStats };
  canRun: boolean;
}) {
  const t = useT();
  const [data, setData] = useState(initial);
  const { executeAsync: runNow, isPending } = useAction(runProposalsNowAction);
  const { executeAsync: overview, isPending: refreshing } = useAction(getAiOverviewAction);

  async function refresh() {
    const r = await overview({});
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    if (d) setData(d);
  }

  async function onRun() {
    const r = await runNow({});
    const error = extractError(r);
    if (error) return toast.error(error);
    toast.success(t("settings.ai.queued"));
  }

  const s = data.status;
  const sources = [
    ...new Set([...data.last30.bySource, ...data.last90.bySource].map((b) => b.source)),
  ];

  return (
    <div className="flex max-w-none flex-col gap-4">
      <DetailsSection title={t("settings.ai.endpoint")}>
        <DetailsGrid
          rows={[
            [
              t("settings.ai.state"),
              <span key="state" data-testid="ai-state">
                <StateLabel
                  family={STATUS_FAMILY[s.state]}
                  state={t(`settings.ai.state.${s.state}`)}
                />
              </span>,
            ],
            [t("settings.ai.model"), "model" in s ? <CodeChip key="m">{s.model}</CodeChip> : null],
            [
              t("settings.ai.detail"),
              s.state === "off"
                ? s.reason
                : s.state === "unreachable"
                  ? s.detail
                  : s.state === "ok"
                    ? t("settings.ai.latency", { ms: s.latencyMs })
                    : t("settings.ai.mockDetail"),
            ],
            [
              t("settings.ai.lastRun"),
              data.last90.lastRunAt ? data.last90.lastRunAt.slice(0, 16).replace("T", " ") : null,
            ],
          ]}
        />
        <p className="mt-2 text-xs text-muted-foreground">{t("settings.ai.stage1Note")}</p>
      </DetailsSection>

      <DetailsSection title={t("settings.ai.acceptance")}>
        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="ai-stats-empty">
            {t("settings.ai.noProposals")}
          </p>
        ) : (
          <Table data-testid="ai-stats">
            <TableHeader>
              <TableRow>
                <TableHead>{t("settings.ai.source")}</TableHead>
                <TableHead className="text-right">{t("settings.ai.made30")}</TableHead>
                <TableHead className="text-right">{t("settings.ai.accepted30")}</TableHead>
                <TableHead className="text-right">{t("settings.ai.made90")}</TableHead>
                <TableHead className="text-right">{t("settings.ai.accepted90")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((src) => {
                const a = data.last30.bySource.find((b) => b.source === src) ?? {
                  made: 0,
                  accepted: 0,
                  rejected: 0,
                };
                const b = data.last90.bySource.find((x) => x.source === src) ?? {
                  made: 0,
                  accepted: 0,
                  rejected: 0,
                };
                return (
                  <TableRow key={src}>
                    <TableCell>
                      <Tag>{t(`linking.proposals.source.${src}`)}</Tag>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{a.made}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {percent(a.accepted, a.accepted + a.rejected)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.made}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {percent(b.accepted, b.accepted + b.rejected)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{t("settings.ai.acceptanceNote")}</p>
      </DetailsSection>

      <div className="flex flex-wrap gap-2">
        {canRun && (
          <Button
            size="sm"
            onClick={() => void onRun()}
            disabled={isPending}
            data-testid="ai-run-now"
          >
            {t("settings.ai.runNow")}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={refreshing}>
          {t("settings.ai.refresh")}
        </Button>
      </div>
    </div>
  );
}
