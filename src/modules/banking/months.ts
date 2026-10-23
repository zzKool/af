// The Months panel's read model (F69, ui-conventions *Page anatomy* 4–5): per month, how many bank rows are
// justified and how many still need proof; per account × month, proven / open / not imported; the banner's month.
// Read only — bank rows, their journal entry's flag, the links touching them (through linking's index), the
// imports' periods and which packages are built (through package's index). No table, nothing stored.
import { Prisma } from "@/generated/prisma/browser";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as journal from "@/modules/journal";
import type { LinkDto } from "@/modules/linking";
import * as linking from "@/modules/linking";
import * as accountantPackage from "@/modules/package";
import { accountLabel } from "./bank-accounts";
import { deriveTransactionState } from "./queries";
import type {
  BankAccountRole,
  BankMonthCell,
  BankMonthCellState,
  BankMonthsOverview,
  TransactionState,
} from "./types";

const D = Prisma.Decimal;

/** Months the panel shows at least (a year back from today's month). */
export const MONTHS_WINDOW = 12;

/** `2026-07` + 2 → `2026-09`; negative steps go back. */
export function addMonths(month: string, step: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const n = y * 12 + (m - 1) + step;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
}

/** Every month from `from` to `to` inclusive, oldest first. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** A row still needs proof when nothing (or not enough) justifies it — the two states the workbench shows as open. */
export function needsProof(state: TransactionState): boolean {
  return state === "open" || state === "partial";
}

// --- pure assembly ---

export type MonthsInput = {
  months: readonly string[];
  accounts: readonly { id: string; label: string; role: BankAccountRole; currency: string }[];
  /** each bank row of the window: its account, booking month and derived state */
  rows: readonly { bankAccountId: string; month: string; state: TransactionState }[];
  /** per account, the months an import covers (its period_from → period_to) */
  covered: ReadonlyMap<string, ReadonlySet<string>>;
  /** months whose monthly package is built */
  built: ReadonlySet<string>;
  /** today's month — the banner never talks about the month still running */
  thisMonth: string;
};

export function assembleMonths(input: MonthsInput): BankMonthsOverview {
  const key = (account: string, month: string) => `${account}|${month}`;
  const perCell = new Map<string, { rows: number; toJustify: number }>();
  for (const r of input.rows) {
    const k = key(r.bankAccountId, r.month);
    const c = perCell.get(k) ?? { rows: 0, toJustify: 0 };
    c.rows += 1;
    if (needsProof(r.state)) c.toJustify += 1;
    perCell.set(k, c);
  }

  const cells: BankMonthCell[] = [];
  for (const a of input.accounts) {
    for (const month of input.months) {
      const c = perCell.get(key(a.id, month)) ?? { rows: 0, toJustify: 0 };
      const imported = c.rows > 0 || (input.covered.get(a.id)?.has(month) ?? false);
      const state: BankMonthCellState = !imported
        ? "not_imported"
        : c.toJustify > 0
          ? "open"
          : "proven";
      cells.push({ bankAccountId: a.id, month, state, rows: c.rows, toJustify: c.toJustify });
    }
  }

  const months = input.months.map((month) => {
    const inMonth = cells.filter((c) => c.month === month);
    const rows = inMonth.reduce((s, c) => s + c.rows, 0);
    const toJustify = inMonth.reduce((s, c) => s + c.toJustify, 0);
    return { month, justified: rows - toJustify, toJustify, built: input.built.has(month) };
  });

  // the newest closed month with bank rows whose package is not built yet
  const pending = [...months]
    .reverse()
    .find((m) => m.month < input.thisMonth && !m.built && m.justified + m.toJustify > 0);

  return {
    from: input.months[0] ?? input.thisMonth,
    to: input.months[input.months.length - 1] ?? input.thisMonth,
    months,
    accounts: input.accounts.map((a) => ({ ...a })),
    cells,
    banner: pending ? { month: pending.month, withoutProof: pending.toJustify } : null,
  };
}

/** Σ allocations FROM each row and which rows sit in a transfer link — the same facts the workbench derives from. */
export function linkFactsOf(links: readonly LinkDto[]): {
  allocated: Map<string, string>;
  transfer: Set<string>;
} {
  const sums = new Map<string, InstanceType<typeof D>>();
  const transfer = new Set<string>();
  for (const l of links) {
    if (l.kind === "transfer") {
      if (l.from.type === "bank_transaction") transfer.add(l.from.id);
      if (l.to.type === "bank_transaction") transfer.add(l.to.id);
      continue;
    }
    if (
      l.from.type === "bank_transaction" &&
      l.allocatedAmount !== null &&
      linking.ALLOCATING_KINDS.includes(l.kind)
    ) {
      sums.set(l.from.id, (sums.get(l.from.id) ?? new D(0)).plus(l.allocatedAmount));
    }
  }
  const allocated = new Map<string, string>();
  for (const [id, sum] of sums) allocated.set(id, sum.toFixed(2));
  return { allocated, transfer };
}

// --- the read ---

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The panel from the first month an import covers (or has a row) to today's month — at least `MONTHS_WINDOW`
 * months, so a fresh start does not look odd. Every account, also those without rows yet; a month an import's
 * period covers counts as imported even when it had no row.
 */
export async function bankMonths(
  tx: TransactionClient,
  options: { today: string },
): Promise<BankMonthsOverview> {
  const thisMonth = options.today.slice(0, 7);
  const [accounts, imports, firstRow] = await Promise.all([
    tx.bankAccount.findMany({
      orderBy: [{ role: "asc" }, { currency: "asc" }, { accountAlias: "asc" }],
      select: { id: true, accountAlias: true, accountNumber: true, currency: true, role: true },
    }),
    tx.bankImport.findMany({
      where: { periodFrom: { not: null }, periodTo: { not: null } },
      select: { bankAccountId: true, periodFrom: true, periodTo: true },
    }),
    tx.bankTransaction.findFirst({
      orderBy: { bookingDate: "asc" },
      select: { bookingDate: true },
    }),
  ]);
  const firstMonths = [
    addMonths(thisMonth, -(MONTHS_WINDOW - 1)),
    ...imports.flatMap((i) => (i.periodFrom ? [iso(i.periodFrom).slice(0, 7)] : [])),
    ...(firstRow ? [iso(firstRow.bookingDate).slice(0, 7)] : []),
  ];
  const from = firstMonths.reduce((a, b) => (b < a ? b : a));
  const months = monthRange(from, thisMonth);
  const start = new Date(`${from}-01T00:00:00Z`);
  const endExclusive = new Date(`${addMonths(thisMonth, 1)}-01T00:00:00Z`);

  const [rows, built] = await Promise.all([
    tx.bankTransaction.findMany({
      where: { bookingDate: { gte: start, lt: endExclusive } },
      select: { id: true, bankAccountId: true, bookingDate: true, amount: true },
    }),
    accountantPackage.builtPeriods(tx, months),
  ]);

  const ids = rows.map((r) => r.id);
  const [entries, links] = await Promise.all([
    journal.entriesForSources(tx, "bank_transaction", ids),
    linking.linksTouching(tx, "bank_transaction", ids),
  ]);
  const facts = linkFactsOf(links);

  const covered = new Map<string, Set<string>>();
  for (const i of imports) {
    if (!i.periodFrom || !i.periodTo) continue;
    const set = covered.get(i.bankAccountId) ?? new Set<string>();
    for (const m of monthRange(iso(i.periodFrom).slice(0, 7), iso(i.periodTo).slice(0, 7)))
      set.add(m);
    covered.set(i.bankAccountId, set);
  }

  return assembleMonths({
    months,
    accounts: accounts.map((a) => ({
      id: a.id,
      label: accountLabel(a),
      role: a.role as BankAccountRole,
      currency: a.currency,
    })),
    rows: rows.map((r) => ({
      bankAccountId: r.bankAccountId,
      month: iso(r.bookingDate).slice(0, 7),
      state: deriveTransactionState({
        amount: r.amount.toFixed(2),
        allocated: facts.allocated.get(r.id) ?? "0.00",
        inTransfer: facts.transfer.has(r.id),
        noDocumentNeeded: entries.get(r.id)?.noDocumentNeeded ?? false,
      }),
    })),
    covered,
    built,
    thisMonth,
  });
}
