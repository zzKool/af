import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Base-currency guard — F85 (D46). F70 (the tenant's own base currency, D39) is parked: the base
 * stays SEK in code. So that F70 costs no more later than it does today, no file may add a
 * `BASE_CURRENCY` use or a `"SEK"` literal beyond the counts below.
 *
 * Scanned: `src/**` .ts/.tsx, without tests, `__fixtures__`, `kernel/test-utils` and comment lines.
 * Counted per file: `BASE_CURRENCY` (import or use) and the literal `"SEK"` / `'SEK'` / `` `SEK` ``.
 *
 * The list only shrinks. A file not listed, or a count above its entry, fails. A count below its
 * entry passes (parallel builders remove uses without touching this file); lower the entry when you
 * pass by, and delete it at zero. New code reads `CURRENCIES` (kernel/nav) for a currency list.
 *
 * Counted 2026-10-23: 46 BASE_CURRENCY + 63 "SEK" in 41 files. Lowered 2026-10-24: 45 + 63 in 41.
 */

// [BASE_CURRENCY, "SEK"]
const ALLOWED: Record<string, readonly [number, number]> = {
  // the definition: BASE_CURRENCY, CURRENCIES
  "src/kernel/nav/constants.ts": [1, 2],
  // country rules — stay (Swedish normalbelopp, the private Swedish payment source, the Nordea CSV)
  "src/modules/traktamente/components/per-diem-sheet.tsx": [0, 3],
  "src/modules/traktamente/components/rate-table.tsx": [0, 3],
  "src/modules/traktamente/components/trip-panel.tsx": [0, 1],
  "src/modules/expenses/payment-sources.ts": [0, 1],
  "src/modules/banking/csv-parser.ts": [0, 1],
  // F70's debt — goes when F70 is built (specs/base-currency on feat/settings-base-currency)
  "src/app/(app)/expenses/groups/[id]/page.tsx": [0, 2],
  "src/kernel/i18n/dictionaries/en.ts": [0, 1],
  "src/kernel/i18n/dictionaries/fr.ts": [0, 1],
  "src/kernel/i18n/dictionaries/sv.ts": [0, 1],
  "src/kernel/money/format-currency.ts": [0, 1],
  "src/kernel/ocr/ocr.ts": [0, 2],
  "src/modules/banking/components/transaction-panel.tsx": [0, 1],
  "src/modules/banking/transfer-pairs.ts": [7, 0],
  "src/modules/contracts/components/contract-list.tsx": [0, 1],
  "src/modules/contracts/contracts.ts": [0, 1],
  "src/modules/dashboard/overview.ts": [0, 7],
  "src/modules/expenses/components/expense-panel-payments.tsx": [0, 1],
  "src/modules/expenses/components/expense-panel.tsx": [0, 4],
  "src/modules/expenses/components/expense-table.tsx": [0, 6],
  "src/modules/expenses/components/groups-table.tsx": [0, 2],
  "src/modules/expenses/components/new-expense-dialog.tsx": [0, 1],
  "src/modules/expenses/components/settle-work.tsx": [0, 5],
  "src/modules/expenses/components/settlements-table.tsx": [0, 3],
  "src/modules/expenses/components/statement-sheet.tsx": [0, 2],
  "src/modules/expenses/expenses.ts": [10, 0],
  "src/modules/expenses/settlements.ts": [3, 0],
  "src/modules/invoices/drafts.ts": [3, 0],
  "src/modules/journal/components/journal-table.tsx": [0, 3],
  "src/modules/journal/components/manual-entry-dialog.tsx": [0, 2],
  "src/modules/journal/implicit-rate.ts": [4, 0],
  "src/modules/journal/journal.ts": [5, 0],
  "src/modules/partners/components/partner-detail-tabs.tsx": [3, 0],
  "src/modules/partners/partners.ts": [0, 1],
  "src/modules/settings/components/company-profile-form.tsx": [0, 1],
  "src/modules/settings/settings.actions.ts": [0, 1],
  "src/modules/supplier-invoices/components/new-supplier-invoice-dialog.tsx": [0, 1],
  "src/modules/supplier-invoices/components/supplier-invoice-table.tsx": [0, 1],
  "src/modules/supplier-invoices/create.ts": [2, 0],
  "src/modules/supplier-invoices/payments.ts": [2, 0],
  "src/modules/supplier-invoices/rate-base.ts": [5, 0],
};

const SKIP = /\.(test|spec)\.tsx?$|\/__fixtures__\/|^src\/kernel\/test-utils\/|^src\/generated\//;
const COMMENT = /^(\/\/|\*|\/\*)/;

function countBaseUses(content: string): [number, number] {
  let base = 0;
  let sek = 0;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (COMMENT.test(line)) continue;
    base += line.match(/\bBASE_CURRENCY\b/g)?.length ?? 0;
    sek += line.match(/(["'`])SEK\1/g)?.length ?? 0;
  }
  return [base, sek];
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .filter((f) => !SKIP.test(f));
}

describe("Base-currency guard (F85, D46)", () => {
  test("the counter sees imports, uses and every quote style, and skips comments", () => {
    const sample = [
      'import { BASE_CURRENCY, CURRENCIES } from "@/kernel/nav";',
      'const a = currency === BASE_CURRENCY ? "SEK" : `SEK`;',
      "const b = 'SEK'; const IN_BASE_CURRENCY = 1;",
      '// "SEK" and BASE_CURRENCY in a comment',
      ' * "SEK" in a doc comment',
      'const c = "EUR/SEK"; const d = "SEK account";',
    ].join("\n");
    expect(countBaseUses(sample)).toEqual([2, 3]);
  });

  test('no file adds a BASE_CURRENCY use or a base "SEK" literal', () => {
    const files = sourceFiles("src");
    expect(files.length, "Guard found no source files to scan").toBeGreaterThan(0);
    const over: string[] = [];
    for (const file of files) {
      const [base, sek] = countBaseUses(readFileSync(file, "utf-8"));
      if (base === 0 && sek === 0) continue;
      const [allowedBase, allowedSek] = ALLOWED[file] ?? [0, 0];
      if (base > allowedBase || sek > allowedSek) {
        over.push(
          `${file}: BASE_CURRENCY ${base} (allowed ${allowedBase}), "SEK" ${sek} (allowed ${allowedSek})`,
        );
      }
    }
    expect(
      over,
      "D46: the base stays SEK in code but no new code may hard-code it — use CURRENCIES for a currency list, keep a base read in the one place that already has it (docs/features.md F85)",
    ).toEqual([]);
  });

  test("every allow-list entry is a file that still exists", () => {
    for (const file of Object.keys(ALLOWED)) {
      expect(existsSync(file), `${file} is gone — remove it from ALLOWED`).toBe(true);
    }
  });
});
