// Import preview (F128, review 2026-10-31 §6.1): the file read against its account before anything is written —
// the parse and the dedup plan the import itself uses (`parseForAccount`), the rules in dry run on the new rows,
// the balance chain with the new rows in, and, for an incoming row, the open issued invoice whose number is in its
// text (linking's scorer — read at call time: `banking.actions → linking → linkables → banking` is the load cycle,
// lessons F113 build). Nothing is written, nothing stored for the invoice found: after Import the row's
// *Suggestions* finds it again and a link is written on a click only (D60). MUST NOT import from next/*.
import { Prisma } from "@/generated/prisma/client";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { settlementTolerance } from "@/kernel/money/settlement";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import { type BalanceRow, balanceChain } from "./completeness";
import type { ParsedRow } from "./csv-parser";
import { iso } from "./dto";
import { parseForAccount } from "./import";
import { DEFAULT_RULES, firstHit, orderRules, type RuleLike, ruleTarget } from "./rules";
import type {
  ImportPreview,
  ImportPreviewInvoice,
  ImportPreviewRow,
  ImportPreviewRuleHit,
  ImportPreviewVerdict,
} from "./types";

const Decimal = Prisma.Decimal;

/** A rule as the dry run reads it: the matching fields plus what it would write. */
type PreviewRule = RuleLike & {
  name: string;
  basCode: string | null;
  partnerId: string | null;
  noDocumentNeeded: boolean;
  /** the partner's name when the rule is not in the database yet (the defaults of a first import) */
  partnerName?: string | null;
};

/** The *Will be* word — one place (the DTO's doc says what each means). */
export function previewVerdict(row: {
  duplicate: boolean;
  invoice: ImportPreviewInvoice | null;
  rule: ImportPreviewRuleHit | null;
}): ImportPreviewVerdict {
  if (row.duplicate) return "duplicate";
  if (row.invoice) return "invoice";
  if (row.rule?.noDocumentNeeded) return "no_proof";
  if (row.rule) return "category";
  return "new";
}

export async function previewImport(
  tx: TransactionClient,
  caller: CallerIdentity,
  input: { bankAccountId: string; fileName: string; bytes: Buffer },
): Promise<ServiceResult<ImportPreview>> {
  if (!can(caller, "create", "bank_transaction")) {
    return {
      error: { code: "FORBIDDEN", message: "Not allowed to import bank rows", retryable: false },
    };
  }
  // the parse, the currency check, the dedup plan, the rates — exactly the import's refusals (F109), before any write
  const parsed = await parseForAccount(tx, input);
  if (parsed.error) return { error: parsed.error };
  const { account, label, rows, fresh, duplicates, periodFrom, periodTo } = parsed.data;
  const freshIndexes = new Set(fresh.map((r) => r.rowIndex));

  // the rules in dry run on the new rows — the same first hit the import's `applyToTransactions` writes; a tenant
  // without a rule yet gets the two defaults the first import creates (they name the bank, F129)
  const rules = await previewRules(tx, account.bankFormat.bankName);
  const ordered = orderRules(rules);
  const hits = new Map<number, ImportPreviewRuleHit>();
  const ruleFacts = await ruleHitFacts(tx, rules);
  for (const r of fresh) {
    const hit = firstHit(
      ordered,
      ruleTarget({ ...r, id: String(r.rowIndex), bankAccountId: account.id }).text,
    );
    if (!hit) continue;
    const facts = ruleFacts.get(hit.id);
    hits.set(r.rowIndex, {
      ruleName: hit.name,
      noDocumentNeeded: hit.noDocumentNeeded,
      basCode: facts?.basCode ?? null,
      basLabel: facts?.basLabel ?? null,
      partnerId: hit.partnerId,
      partnerName: facts?.partnerName ?? hit.partnerName ?? null,
    });
  }

  // my invoice found: the open issued invoices whose number is a token of an incoming row's text
  const invoices = await invoicesFound(tx, account.currency, fresh);

  // the balance chain over the account with the new rows in (F115): how far it would be proven after Import
  const existing = await tx.bankTransaction.findMany({
    where: { bankAccountId: account.id },
    select: { bookingDate: true, amount: true, balance: true, rowIndex: true },
  });
  const chainRows: BalanceRow[] = [
    ...existing.map((t) => ({
      bookingDate: iso(t.bookingDate) as string,
      amount: t.amount,
      balance: t.balance,
      rowIndex: t.rowIndex,
    })),
    ...fresh.map((r) => ({
      bookingDate: r.date,
      amount: r.amount,
      balance: r.balance,
      rowIndex: r.rowIndex,
    })),
  ];
  const chain = balanceChain(chainRows);

  const previewRows: ImportPreviewRow[] = rows.map((r) => {
    const duplicate = !freshIndexes.has(r.rowIndex);
    const rule = duplicate ? null : (hits.get(r.rowIndex) ?? null);
    const invoice = duplicate ? null : (invoices.get(r.rowIndex) ?? null);
    return {
      rowIndex: r.rowIndex,
      date: r.date,
      amount: r.amount.toFixed(2),
      currency: r.currency,
      counterparty: r.description,
      reference: r.reference,
      duplicate,
      rule,
      invoice,
      willBe: previewVerdict({ duplicate, invoice, rule }),
    };
  });

  return {
    data: {
      bankAccountId: account.id,
      accountLabel: label,
      currency: account.currency,
      fileName: input.fileName.trim(),
      rows: previewRows,
      recordCount: rows.length,
      duplicateCount: duplicates,
      willImport: fresh.length,
      ruleHits: hits.size,
      invoicesFound: invoices.size,
      periodFrom,
      periodTo,
      completeTo: chain.completeTo,
      balanceGaps: chain.gaps,
    },
  };
}

/**
 * The active rules; a tenant without any gets `DEFAULT_RULES` as they would be made by the first import
 * (`ensureDefaultRules`): the bank's partner when it exists already, else the format's bank name — the import
 * creates it under that name (`ensureSystemPartners`).
 */
async function previewRules(tx: TransactionClient, bankName: string): Promise<PreviewRule[]> {
  const active = await tx.categorisationRule.findMany({ where: { isActive: true } });
  if (active.length > 0) return active;
  const bank = await partners.systemPartner(tx, "bank");
  const epoch = new Date(0);
  return DEFAULT_RULES.map(({ partnerRole, ...r }, i) => ({
    id: `default-${i}`,
    name: r.name,
    matchType: r.matchType,
    matchPattern: r.matchPattern,
    matchField: r.matchField ?? "counterparty_key",
    priority: r.priority ?? 0,
    createdAt: epoch,
    isActive: true,
    basCode: r.basCode ?? null,
    partnerId: partnerRole === "bank" ? (bank?.id ?? null) : null,
    partnerName: partnerRole === "bank" ? (bank?.name ?? (bankName.trim() || "Bank")) : null,
    noDocumentNeeded: r.noDocumentNeeded ?? false,
  }));
}

/**
 * What each rule's hit would show: the category it sets — the rule's, else its partner's default (what
 * `applyToTransactions` writes) — with settings' label, and the partner's name.
 */
async function ruleHitFacts(
  tx: TransactionClient,
  rules: readonly PreviewRule[],
): Promise<
  Map<string, { basCode: string | null; basLabel: string | null; partnerName: string | null }>
> {
  const partnerIds = [...new Set(rules.map((r) => r.partnerId).filter((p): p is string => !!p))];
  const partnerById = new Map<string, { name: string; defaultBasCode: string | null }>();
  for (const id of partnerIds) {
    const p = await partners.getPartner(tx, id);
    if (p.data)
      partnerById.set(id, {
        name: p.data.name,
        defaultBasCode: p.data.defaultBasCategoryCode ?? null,
      });
  }
  const codeOf = (r: PreviewRule) =>
    r.basCode ?? (r.partnerId ? (partnerById.get(r.partnerId)?.defaultBasCode ?? null) : null);
  const codes = rules.map(codeOf).filter((c): c is string => !!c);
  const labels = await settings.basLabels(tx, codes);
  return new Map(
    rules.map((r) => {
      const basCode = codeOf(r);
      // a code the tenant's BAS set does not know is not written by the import either (`ensureDefaultRules`)
      const basLabel = basCode ? (labels.get(basCode) ?? null) : null;
      return [
        r.id,
        {
          basCode: basLabel ? basCode : null,
          basLabel,
          partnerName: r.partnerId ? (partnerById.get(r.partnerId)?.name ?? null) : null,
        },
      ];
    }),
  );
}

/**
 * Per incoming new row, the open issued invoice whose number is a token of the row's text — the scorer's
 * reference claim, read through linking at call time (the load cycle, lessons F113 build): the candidates
 * come from the invoice linkable (its own `references` lookup), what is still open on them from linking's
 * allocation sums, the pair's confidence from `scoreMatch` on the parsed row's facts — the same facts the row's
 * linkable gives once imported, so *Suggestions* finds the same invoice after Import. The simplest honest claim:
 * the number is in the text, the invoice is open, in the row's currency; two numbers in one text name the
 * better-ranked one. Nothing is stored (D60: a link on a click only).
 */
async function invoicesFound(
  tx: TransactionClient,
  currency: string,
  fresh: readonly ParsedRow[],
): Promise<Map<number, ImportPreviewInvoice>> {
  const out = new Map<number, ImportPreviewInvoice>();
  const incoming = fresh.filter((r) => r.amount.gt(0));
  if (incoming.length === 0) return out;
  const linking = await import("@/modules/linking");
  const invoiceLinkable = linking.getLinkable("invoice");
  if (!invoiceLinkable?.candidates) return out;

  const texts = (r: ParsedRow) =>
    [r.name, r.message, r.additionalDetails, r.sender, r.recipient, r.description].map(
      (s) => s ?? "",
    );
  const tokensByRow = new Map(
    incoming.map((r) => [
      r.rowIndex,
      new Set(linking.referenceTokens(texts(r)).map((t) => t.toUpperCase())),
    ]),
  );
  const references = [...new Set([...tokensByRow.values()].flatMap((s) => [...s]))];
  if (references.length === 0) return out;
  const dates = incoming.map((r) => r.date).sort();
  const candidates = await invoiceLinkable.candidates(
    tx,
    linking.candidateQuery(
      "incoming",
      dates[0] as string,
      dates[dates.length - 1] as string,
      references,
      [],
      linking.CANDIDATES_PER_TYPE,
    ),
  );
  // open = the total minus what the links already allocate onto it (linking's read); settled ones are no candidates
  const unique = [...new Map(candidates.map((c) => [c.id, c])).values()].filter(
    (c) => c.reference && c.currency === currency && c.direction === "incoming",
  );
  const allocated = await linking.allocatedSums(
    tx,
    "invoice",
    unique.map((c) => c.id),
  );
  const open = unique
    .map((c) => {
      const remaining = new Decimal(c.amount).minus(allocated.get(c.id) ?? "0");
      return { ...c, remaining: remaining.lt(0) ? "0.00" : remaining.toFixed(2) };
    })
    .filter((c) => new Decimal(c.remaining).gt(settlementTolerance(c.amount)));
  if (open.length === 0) return out;

  for (const r of incoming) {
    const tokens = tokensByRow.get(r.rowIndex);
    if (!tokens || tokens.size === 0) continue;
    const named = open.filter((c) => tokens.has((c.reference as string).toUpperCase()));
    if (named.length === 0) continue;
    const row = {
      amount: r.amount.toFixed(2),
      currency: r.currency,
      amountBase: null,
      date: r.date,
      texts: texts(r),
    };
    const scored = named
      .map((c) => {
        const m = linking.scoreMatch(row, c);
        return m ? { ...m, candidate: c } : null;
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
    const best = linking.rank(scored)[0];
    if (!best) continue;
    out.set(r.rowIndex, {
      invoiceId: best.candidate.id,
      number: best.candidate.reference as string,
      partnerName: best.candidate.partnerName,
      confidence: best.confidence,
    });
  }
  return out;
}
