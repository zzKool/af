// Pre-selecting the account from a Nordea export's filename (v1 `detectBankAccount`, R43/R53). A hint for the
// import dialog — never a creation: `PLUSGIROKONTO FTG 123 45 67-8 - 2026-07-31 09.12.01.csv` → `123 45 67-8`;
// `SPARKONTO FÖRETAG 1234 56 78901 - …` → `1234 56 78901`. The SEK and CHF main accounts share one Plusgiro
// number, so the first data row's currency picks between them.

export type AccountHint = { accountNumber: string | null; kind: "plusgiro" | "savings" | null };

export function detectAccountFromFilename(fileName: string): AccountHint {
  const base = fileName.replace(/^.*[\\/]/, "");
  // the number sits before " - <timestamp>"; the timestamp itself would extend a greedy match
  const head = base.split(/\s+-\s+/)[0] ?? base;
  const m = head.match(/(\d+[\s-]+\d+[\s-]+\d+[\s-]*\d*)/);
  const accountNumber = m ? m[1].replace(/\s+/g, " ").trim() : null;
  const upper = base.toUpperCase();
  const kind = upper.includes("PLUSGIRO")
    ? "plusgiro"
    : upper.includes("SPARKONTO")
      ? "savings"
      : null;
  return { accountNumber, kind };
}

export type AccountCandidate = { id: string; accountNumber: string; currency: string };

/** The account whose number matches the hint and whose currency matches the file's first row, else null. */
export function pickAccount<T extends AccountCandidate>(
  accounts: readonly T[],
  hint: AccountHint,
  firstRowCurrency: string | null,
): T | null {
  if (!hint.accountNumber) return null;
  const norm = (s: string) => s.replace(/[\s-]+/g, "");
  const byNumber = accounts.filter((a) => norm(a.accountNumber) === norm(hint.accountNumber ?? ""));
  if (byNumber.length === 0) return null;
  if (byNumber.length === 1) return byNumber[0];
  const cur = firstRowCurrency?.toUpperCase() ?? null;
  return byNumber.find((a) => a.currency.toUpperCase() === cur) ?? null;
}
