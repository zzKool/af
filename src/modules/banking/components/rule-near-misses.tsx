"use client";

// The rules page's *Needs a look* (F116 PR C1, specs/linking/one-engine.md US6): rows whose text matched a rule
// but whose account, direction or amount did not — left uncategorised — and rows a rule with a rhythm categorised
// off it. Read only: each row opens the workbench panel; the rule is edited in the table below.
import Link from "next/link";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { DetailsSection } from "@/kernel/ui/details-section";
import type { RuleNearMiss } from "@/modules/banking/types";

export function RuleNearMisses({ misses }: { misses: RuleNearMiss[] }) {
  const t = useT();
  if (misses.length === 0) return null;
  return (
    <DetailsSection title={t("banking.rules.nearMiss.title", { count: misses.length })}>
      <ul
        className="flex flex-col divide-y divide-subtle text-[13px]"
        data-testid="rule-near-misses"
      >
        {misses.map((m) => (
          <li
            key={`${m.transactionId}-${m.reason}`}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5"
            data-testid="rule-near-miss"
          >
            <span className="tabular-nums text-muted-foreground">{m.bookingDate}</span>
            <Link
              href={`/banking?open=${m.transactionId}`}
              className="min-w-0 flex-1 truncate text-primary hover:underline"
            >
              {m.description}
            </Link>
            <span className="tabular-nums">
              {formatMoney(m.amount, m.currency, { signed: true })}
            </span>
            <span className="text-muted-foreground">
              {t(`banking.rules.nearMiss.${m.reason}`, {
                rule: m.ruleName,
                expected: m.expected ?? "",
              })}
            </span>
          </li>
        ))}
      </ul>
    </DetailsSection>
  );
}
