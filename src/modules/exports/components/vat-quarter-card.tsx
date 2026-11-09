"use client";

// The Swiss VAT quarter on the Close page (F155, the Pulse-Close board): where the quarter stands (collect →
// prepare → declared → paid, derived from today and the declaration's dates), the due day, the figures the return
// carries so far in CHF, and the way into the full return (`/exports`).
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { cn } from "@/lib/utils";
import type { VatQuarterView as Card, VatQuarterStep } from "@/modules/exports/types";

const STEPS: readonly VatQuarterStep[] = ["collect", "prepare", "declared", "paid"];
const CHF = "CHF";

const quarterOf = (period: string) => {
  const m = /^CH (\d{4})\/Q([1-4])$/.exec(period);
  return { year: m?.[1] ?? "", quarter: m?.[2] ?? "" };
};

const nextDay = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export function VatQuarterCard({ card }: { card: Card | null }) {
  const t = useT();
  if (!card) {
    return (
      <section
        className="pulse-card flex flex-col gap-3 p-5"
        aria-label={t("exports.card.label")}
        data-testid="close-vat"
      >
        <p className="text-[13px]">{t("exports.card.none")}</p>
        <p className="text-xs text-muted-foreground">{t("exports.card.moms")}</p>
        <Link
          href="/settings/vat-registrations"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
        >
          {t("exports.card.settings")}
        </Link>
      </section>
    );
  }
  const { year, quarter } = quarterOf(card.period);
  const at = STEPS.indexOf(card.step);
  const href = `/exports?period=${encodeURIComponent(card.period)}&registration=${card.registrationId}`;
  const stepSub: Record<VatQuarterStep, string> = {
    collect: t("exports.card.until", { date: card.to }),
    prepare: t("exports.card.from", { date: nextDay(card.to) }),
    declared: "",
    paid: "",
  };
  const credit = Number(card.credit) > 0;
  const prev = card.previous ? quarterOf(card.previous.period) : null;

  return (
    <section
      className="pulse-card flex min-w-0 flex-col gap-4 p-5"
      aria-label={t("exports.card.label")}
      data-testid="close-vat"
      data-period={card.period}
      data-step={card.step}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{t("exports.card.title", { quarter, year })}</h2>
        {card.step !== "paid" && (
          <span className="rounded-full bg-tag px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
            {t("exports.card.due", { date: card.due })}
          </span>
        )}
      </div>

      <ol className="grid grid-cols-4 gap-2" aria-label={t("exports.card.label")}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            className="flex flex-col gap-1 text-xs"
            aria-current={i === at ? "step" : undefined}
          >
            <span
              className={
                i < at
                  ? "h-[3px] rounded-full bg-foreground"
                  : i === at
                    ? "h-[3px] rounded-full bg-primary"
                    : "h-[3px] rounded-full bg-border"
              }
            />
            <span className={i === at ? "font-medium" : "text-muted-foreground"}>
              {t(`exports.card.step.${s}`)}
              {stepSub[s] && (
                <span className="block text-muted-foreground tabular-nums">{stepSub[s]}</span>
              )}
            </span>
          </li>
        ))}
      </ol>

      <p className="text-[13px] text-muted-foreground">
        {t(`exports.card.lead.${card.step}`, { vat: card.vatNumber, to: card.to, due: card.due })}
      </p>

      <dl className="flex flex-col text-[13px]" data-testid="close-vat-figures">
        <Figure label={t("exports.card.turnover")} amount={card.turnover} />
        <div className="flex justify-between gap-3 border-b border-subtle py-1.5 pl-3 text-xs text-muted-foreground">
          <span>{card.months.map((m) => m.month).join(" · ")}</span>
          <span className="tabular-nums">
            {card.months.map((m) => formatMoney(m.turnover, CHF, { bare: true })).join(" · ")}
          </span>
        </div>
        <Figure label={t("exports.card.taxDue")} amount={card.taxDue} />
        <Figure label={t("exports.card.deductible")} amount={card.deductible} negative />
        <Figure
          label={credit ? t("exports.card.credit") : t("exports.card.payable")}
          amount={credit ? card.credit : card.payable}
          strong
        />
      </dl>

      <p className="rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
        {t("exports.card.moms")}
      </p>

      <div className="mt-auto flex flex-col gap-2">
        <div className="flex flex-wrap justify-end gap-2">
          {card.invoices > 0 && (
            <Link href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("exports.card.invoices", { n: card.invoices })}
            </Link>
          )}
          <Link href={href} className={buttonVariants({ size: "sm" })} data-testid="close-vat-open">
            {t("exports.card.open")}
          </Link>
        </div>
        {card.previous?.declaredAt && prev && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {card.previous.paidAt
              ? t("exports.card.previous", {
                  quarter: prev.quarter,
                  declared: card.previous.declaredAt.slice(0, 10),
                  paid: card.previous.paidAt.slice(0, 10),
                  amount: formatMoney(card.previous.amount, CHF),
                })
              : t("exports.card.previousUnpaid", {
                  quarter: prev.quarter,
                  declared: card.previous.declaredAt.slice(0, 10),
                  amount: formatMoney(card.previous.amount, CHF),
                })}
          </p>
        )}
      </div>
    </section>
  );
}

function Figure({
  label,
  amount,
  negative,
  strong,
}: {
  label: string;
  amount: string;
  negative?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={
        strong
          ? "flex justify-between gap-3 py-2 text-[15px] font-semibold"
          : "flex justify-between gap-3 border-b border-subtle py-1.5"
      }
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">
        {negative && Number(amount) !== 0 ? "− " : ""}
        {formatMoney(amount, CHF)}
      </dd>
    </div>
  );
}
