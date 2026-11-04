"use client";

// The rules page's *Needs a look* (F116 PR C1, specs/linking/one-engine.md US6): rows whose text matched a rule
// but whose account, direction or amount did not — left uncategorised — and rows a rule with a rhythm categorised
// off it; since F129 (D73) also a rule that sets *no proof* without a partner — its rows stay to justify — with
// *Edit rule*. Read only otherwise: each row opens the workbench panel.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { DetailsSection } from "@/kernel/ui/details-section";
import type { RuleNearMiss } from "@/modules/banking/types";
import type { CategoryOption, PartnerOption } from "./categorise-form";
import { type RuleAccountOption, RuleDialog, type RuleEditable } from "./rule-dialog";

export function RuleNearMisses({
  misses,
  rules = [],
  categories = [],
  partners = [],
  accounts = [],
  canWrite = false,
}: {
  misses: RuleNearMiss[];
  /** the tenant's rules, for *Edit rule* on a `no_partner` entry */
  rules?: RuleEditable[];
  categories?: CategoryOption[];
  partners?: PartnerOption[];
  accounts?: RuleAccountOption[];
  canWrite?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState<RuleEditable | null>(null);
  if (misses.length === 0) return null;
  return (
    <DetailsSection title={t("banking.rules.nearMiss.title", { count: misses.length })}>
      <ul
        className="flex flex-col divide-y divide-subtle text-[13px]"
        data-testid="rule-near-misses"
      >
        {misses.map((m) =>
          m.reason === "no_partner" ? (
            <li
              key={`${m.ruleId}-${m.reason}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5"
              data-testid="rule-near-miss"
              data-reason="no_partner"
            >
              <span className="min-w-0 flex-1 truncate">{m.ruleName}</span>
              <span className="text-muted-foreground">
                {t("banking.rules.nearMiss.no_partner", { rows: String(m.rows ?? 0) })}
              </span>
              {canWrite && (
                <Button
                  size="sm"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => setEditing(rules.find((r) => r.id === m.ruleId) ?? null)}
                  disabled={!rules.some((r) => r.id === m.ruleId)}
                  data-testid="rule-near-miss-edit"
                >
                  {t("banking.rules.nearMiss.editRule")}
                </Button>
              )}
            </li>
          ) : (
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
                {m.amount && m.currency ? formatMoney(m.amount, m.currency, { signed: true }) : ""}
              </span>
              <span className="text-muted-foreground">
                {t(`banking.rules.nearMiss.${m.reason}`, {
                  rule: m.ruleName,
                  expected: m.expected ?? "",
                })}
              </span>
            </li>
          ),
        )}
      </ul>
      {canWrite && (
        <RuleDialog
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
          rule={editing}
          categories={categories}
          partners={partners}
          accounts={accounts}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </DetailsSection>
  );
}
