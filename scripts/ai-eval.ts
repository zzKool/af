// The proposals' eval (F98 PR 2, specs/ai US5 / FR-010): replays the rows the owner categorised by hand through
// stage 1 and the model, and prints how often each agrees with him — counts, rates and BAS codes only, never a
// row, a name or an amount (D51). Read only. Run where the app runs, with its env (DATABASE_URL, AI_*):
//   npx tsx scripts/ai-eval.ts [--since 2026-01] [--limit 300] [--model <name>] [--tenant <id>]
// `--model` overrides AI_MODEL for this run (compare two models on the same rows). Exits 1 when the model is
// unreachable, so a wrong AI_BASE_URL is not read as "the model is bad".
import { aiStatus, createAiService } from "@/kernel/ai/ai";
import { tenantOwners } from "@/kernel/auth/users";
import { prisma } from "@/kernel/db/client";
import { formatEval, runEval } from "@/modules/linking/proposals/eval";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function sinceOf(v: string | undefined): string {
  if (!v) {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}$/.test(v)) return `${v}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  throw new Error(`--since: expected yyyy-mm or yyyy-mm-dd, got "${v}"`);
}

async function main() {
  const model = arg("model");
  if (model) process.env.AI_MODEL = model;
  const status = await aiStatus();
  if (status.state === "unreachable") {
    console.error(`The model endpoint is unreachable (${status.detail}) — check AI_BASE_URL.`);
    process.exitCode = 1;
    return;
  }
  if (status.state === "off") console.warn(`AI is off (${status.reason}) — stage 1 only.`);
  const owners = await tenantOwners(prisma);
  const tenant = arg("tenant");
  const owner = tenant ? owners.find((o) => o.tenantId === tenant) : owners[0];
  if (!owner) throw new Error(tenant ? `no tenant ${tenant}` : "no tenant");
  const since = sinceOf(arg("since"));
  const limit = arg("limit") ? Number(arg("limit")) : undefined;
  const started = Date.now();
  const report = await runEval(owner, createAiService(), { since, limit });
  const label = status.state === "ok" ? status.model : status.state;
  console.log(
    `eval since ${since} · model ${label} · ${((Date.now() - started) / 1000).toFixed(0)} s\n`,
  );
  console.log(formatEval(report));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
