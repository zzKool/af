// The proposals' eval (F98 PR 2, specs/ai US5 / FR-010): the rows the owner categorised by hand, replayed through
// stage 1 and the model as if he had not — how often each source agrees with him, per confidence family and per
// BAS code, and how long the model takes. Read only. Prints counts and codes, **never a row, a name or an amount**
// (D51): it runs on the box, on real data, and its output may be pasted into a chat.
import type { AiService } from "@/kernel/ai/types";
import { withJobContext } from "@/kernel/jobs/context";
import * as banking from "@/modules/banking";
import * as settings from "@/modules/settings";
import type { ProposalFamily } from "../types";
import { familyOf, isShown, MODEL_MAX_CONFIDENCE } from "./policy";
import {
  BAS_PROPOSAL_TASK,
  BAS_PROPOSAL_VERSION,
  basProposalSchema,
  basProposalSystem,
  basProposalUser,
  type PromptAccount,
  toPromptAccounts,
} from "./prompts/bas-proposal";
import { stage1 } from "./stage1";

/** One replayed row: the truth and what each step proposed (no text, no amount). */
export type EvalOutcome = {
  truth: string;
  stage1: { source: string; code: string; confidence: number } | null;
  model:
    | { code: string; confidence: number; ms: number }
    | { error: "unavailable" | "timeout" | "invalid_output" }
    | null;
};

type Tally = { n: number; agree: number };
export type EvalReport = {
  rows: number;
  /** the proposal the owner would have seen (stage 1, else the model when shown) */
  shown: Tally;
  none: number;
  bySource: ({ source: string } & Tally)[];
  byFamily: ({ family: ProposalFamily } & Tally)[];
  byCode: ({ code: string } & Tally)[];
  model: { asked: number; failed: number; p50Ms: number | null; p95Ms: number | null };
};

function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null;
}

const bump = <K>(m: Map<K, Tally>, k: K, agree: boolean) => {
  const t = m.get(k) ?? { n: 0, agree: 0 };
  t.n++;
  if (agree) t.agree++;
  m.set(k, t);
};

/** The outcomes → the report. Pure. */
export function summariseEval(outcomes: readonly EvalOutcome[]): EvalReport {
  const bySource = new Map<string, Tally>();
  const byFamily = new Map<ProposalFamily, Tally>();
  const byCode = new Map<string, Tally>();
  const shown: Tally = { n: 0, agree: 0 };
  const ms: number[] = [];
  let asked = 0;
  let failed = 0;
  let none = 0;
  for (const o of outcomes) {
    let pick: { source: string; code: string; confidence: number } | null = o.stage1;
    if (o.model) {
      asked++;
      if ("error" in o.model) failed++;
      else {
        ms.push(o.model.ms);
        bump(bySource, "model", o.model.code === o.truth);
        if (!pick) pick = { source: "model", ...o.model };
      }
    }
    if (o.stage1) bump(bySource, o.stage1.source, o.stage1.code === o.truth);
    if (!pick || !isShown(pick.confidence)) {
      none++;
      bump(byCode, o.truth, false);
      continue;
    }
    const agree = pick.code === o.truth;
    shown.n++;
    if (agree) shown.agree++;
    bump(byFamily, familyOf(pick.confidence), agree);
    bump(byCode, o.truth, agree);
  }
  ms.sort((a, b) => a - b);
  const list = <K extends string>(m: Map<K, Tally>, key: string) =>
    [...m.entries()]
      .map(([k, t]) => ({ [key]: k, ...t }))
      .sort((a, b) =>
        String(a[key as keyof typeof a]).localeCompare(String(b[key as keyof typeof b])),
      );
  return {
    rows: outcomes.length,
    shown,
    none,
    bySource: list(bySource, "source") as EvalReport["bySource"],
    byFamily: list(byFamily, "family") as EvalReport["byFamily"],
    byCode: list(byCode, "code") as EvalReport["byCode"],
    model: { asked, failed, p50Ms: quantile(ms, 0.5), p95Ms: quantile(ms, 0.95) },
  };
}

/**
 * Replays one tenant's hand-categorised rows since a day. Stage 1 inside one read transaction; the model, for the
 * rows stage 1 leaves open, outside it — each row with examples that never include itself.
 */
export async function runEval(
  owner: { tenantId: string; userId: string },
  ai: AiService,
  opts: { since: string; limit?: number },
): Promise<EvalReport> {
  const { replay, accounts, pool } = await withJobContext(
    owner.tenantId,
    owner.userId,
    async (tx) => {
      const options = await settings.basPickerOptions(tx);
      const accounts: PromptAccount[] = toPromptAccounts(options);
      return {
        replay: await banking.proposalReplayInputs(tx, opts),
        accounts,
        pool: await banking.confirmedExampleRows(tx),
      };
    },
  );
  const schema = accounts.length ? basProposalSchema(accounts.map((a) => a.code)) : null;
  const outcomes: EvalOutcome[] = [];
  for (const { input, truth } of replay) {
    const bas = stage1(input).find((d) => d.kind === "bas");
    const outcome: EvalOutcome = {
      truth,
      stage1:
        bas && bas.kind === "bas"
          ? { source: bas.source, code: bas.payload.basCode, confidence: bas.confidence }
          : null,
      model: null,
    };
    if (!outcome.stage1 && schema && ai.kind !== "off") {
      const res = await ai.complete({
        task: BAS_PROPOSAL_TASK,
        promptVersion: BAS_PROPOSAL_VERSION,
        messages: [
          {
            role: "system",
            content: basProposalSystem(accounts, banking.pickExamples(pool, 8, input.row.id)),
          },
          { role: "user", content: basProposalUser(input.row) },
        ],
        schema,
      });
      outcome.model = res.ok
        ? {
            code: res.data.basCode,
            confidence: Math.min(res.data.confidence, MODEL_MAX_CONFIDENCE),
            ms: res.durationMs,
          }
        : { error: res.error };
    }
    outcomes.push(outcome);
  }
  return summariseEval(outcomes);
}

/** The report as plain text — counts, rates and BAS codes only. */
export function formatEval(r: EvalReport): string {
  const pct = (t: Tally) => (t.n ? `${Math.round((100 * t.agree) / t.n)} %` : "—");
  const line = (label: string, t: Tally) =>
    `  ${label.padEnd(18)} ${String(t.agree).padStart(5)} / ${String(t.n).padEnd(5)} ${pct(t)}`;
  const out = [
    `rows replayed: ${r.rows} · a proposal shown: ${r.shown.n} (agrees ${pct(r.shown)}) · nothing shown: ${r.none}`,
    "",
    "by source (agrees / proposed):",
    ...r.bySource.map((s) => line(s.source, s)),
    "",
    "by confidence family (what the owner would have seen):",
    ...r.byFamily.map((f) => line(f.family, f)),
    "",
    `model: asked ${r.model.asked}, failed ${r.model.failed}, p50 ${r.model.p50Ms === null ? "—" : `${(r.model.p50Ms / 1000).toFixed(1)} s`}, p95 ${r.model.p95Ms === null ? "—" : `${(r.model.p95Ms / 1000).toFixed(1)} s`}`,
    "",
    "by BAS code (the owner's code: agrees / rows):",
    ...r.byCode.map((c) => line(c.code, c)),
  ];
  return out.join("\n");
}
