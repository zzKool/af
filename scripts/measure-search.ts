// Times the global search (F93) on the volume tenant — per module and the whole palette call, as the app role
// (RLS on). Run `scripts/seed-volume.ts` first.
//   DATABASE_URL=postgresql://af_app:app@localhost:5433/af_test npx tsx scripts/measure-search.ts
import { searchAll } from "@/app/(app)/search";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { searchBankTransactionHits } from "@/modules/banking";
import { searchDocumentHits } from "@/modules/documents";
import { searchExpenseHits, searchSettlementHits } from "@/modules/expenses";
import { searchInvoiceHits } from "@/modules/invoices";
import { searchPartnerHits } from "@/modules/partners";
import { searchSupplierInvoiceHits } from "@/modules/supplier-invoices";

const TENANT = "00000000-0000-4000-8000-00000000f093";
const caller: CallerIdentity = {
  userId: "00000000-0000-4000-8000-0000000f0930",
  tenantId: TENANT,
  role: "owner",
  source: "cli",
};
const QUERIES = [
  "P007",
  "P00723-INV-014",
  "SI212-Acc-03",
  "9160",
  "Ex220-Tr-05",
  "spotify",
  "1 250",
  "ST23-001",
  "exp_2023",
  "zzz-nothing",
];
const RUNS = 20;

const MODULES = {
  partners: searchPartnerHits,
  invoices: searchInvoiceHits,
  supplierInvoices: searchSupplierInvoiceHits,
  expenses: searchExpenseHits,
  settlements: searchSettlementHits,
  documents: searchDocumentHits,
  banking: searchBankTransactionHits,
} as const;

function stats(ms: number[]) {
  const s = [...ms].sort((a, b) => a - b);
  return {
    median: s[Math.floor(s.length / 2)],
    p95: s[Math.floor(s.length * 0.95) - 1] ?? s[s.length - 1],
  };
}

async function time(fn: () => Promise<unknown>): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await fn();
    out.push(performance.now() - start);
  }
  return out;
}

async function main() {
  const rows: string[] = ["query | module | median ms | p95 ms | hits"];
  for (const q of QUERIES) {
    for (const [name, search] of Object.entries(MODULES)) {
      let hits = 0;
      const ms = await time(async () => {
        const r = await withTenantTransaction(prisma, TENANT, (tx) => search(tx, caller, q));
        hits = r.data?.hits.length ?? 0;
      });
      const { median, p95 } = stats(ms);
      rows.push(`${q} | ${name} | ${median.toFixed(1)} | ${p95.toFixed(1)} | ${hits}`);
    }
    const ms = await time(() =>
      withTenantTransaction(prisma, TENANT, (tx) => searchAll(tx, caller, q)),
    );
    const { median, p95 } = stats(ms);
    rows.push(`${q} | **palette** | ${median.toFixed(1)} | ${p95.toFixed(1)} | —`);
  }
  console.log(rows.join("\n"));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
