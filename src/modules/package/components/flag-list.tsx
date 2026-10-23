"use client";

// The flags of a period on screen (FR-004, the month-end checklist), grouped by kind like notes.md. notes.md and
// the Flags sheet print `key` + `detail` as they are (byte-identical, F71); the screen shows the D40 way: a
// business key as a code chip, a bank line as its account and date, the figure through `formatMoney`.
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { CodeChip } from "@/kernel/ui/tags";
import type { FlagKind, PackageFlag } from "@/modules/package/types";

/** notes.md's order of the sections */
const FLAG_ORDER: FlagKind[] = [
  "missing_document",
  "unlinked_row",
  "delta",
  "unpaid_invoice",
  "document_not_ready",
];

export function FlagLine({ flag }: { flag: PackageFlag }) {
  const t = useT();
  const figure =
    flag.amount !== undefined && flag.currency
      ? formatMoney(flag.amount, flag.currency, { signed: flag.kind === "unlinked_row" })
      : null;
  const subject =
    flag.entity === "bank_transaction" && flag.account && flag.date ? (
      <span className="shrink-0 whitespace-nowrap tabular-nums">
        {flag.account} {flag.date}
      </span>
    ) : (
      <CodeChip className="shrink-0">{flag.key}</CodeChip>
    );
  // what follows the subject: the open amount (delta, unpaid invoice), else the row's amount and its text,
  // else the detail; a document not rendered yet says nothing more than its section's title
  const rest =
    flag.kind === "delta" || flag.kind === "unpaid_invoice"
      ? figure && t("package.flag.open", { amount: figure })
      : flag.kind === "document_not_ready"
        ? null
        : figure
          ? `${figure} · ${flag.detail}`
          : flag.detail;
  return (
    <li
      className="flex min-w-0 items-center gap-1.5 text-[13px]"
      title={`${flag.key} — ${flag.detail}`}
      data-amount={flag.amount}
    >
      {subject}
      {rest && <span className="truncate text-muted-foreground">{rest}</span>}
    </li>
  );
}

export function FlagList({ flags }: { flags: PackageFlag[] }) {
  const t = useT();
  if (flags.length === 0)
    return (
      <p className="text-[13px]" data-testid="package-flag-list">
        {t("package.preview.noFlags")}
      </p>
    );
  return (
    <div className="flex flex-col gap-2" data-testid="package-flag-list">
      {FLAG_ORDER.filter((k) => flags.some((f) => f.kind === k)).map((kind) => (
        <div key={kind}>
          <div className="text-xs font-semibold">{t(`package.flag.${kind}`)}</div>
          <ul className="flex flex-col gap-1 pt-1">
            {flags
              .filter((f) => f.kind === kind)
              .map((f) => (
                <FlagLine key={`${f.entity}:${f.id}:${f.kind}`} flag={f} />
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
