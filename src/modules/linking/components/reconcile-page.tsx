"use client";

// Reconcile — the match stage (F139, specs/linking/reconcile.md; the board *Reconcile*, D77): the month's rows to
// justify on the left, grouped (Ready · To check · Needs a document · Who is this?) with *Accept N*, and *Done today*
// with *Undo*; the row in focus on the stage — the bank row and its candidate side by side with the lines between
// them, the partner and the category sure / proposed / asked, the bank's FX cost, *when you accept* — or, with no
// candidate, the row's own panel. The keyboard: J / K move, Enter accepts, Shift + Enter accepts all ready, Ctrl + Z
// undoes the last of today. Everything is derived on the server (`reconcileData`); the page holds the focus.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractError } from "@/kernel/errors/extract-error";
import { formatMonth } from "@/kernel/i18n/format-date";
import { useT, useUiLanguage } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { cn } from "@/lib/utils";
import type { CategoryOption, PartnerOption } from "@/modules/banking/ui";
import { TransactionDetailView } from "@/modules/banking/ui";
import {
  acceptMatchAction,
  bulkApplyHighAction,
  removeLinkAction,
} from "@/modules/linking/linking.actions";
import {
  RECONCILE_GROUPS,
  type ReconcileData,
  type ReconcileGroup,
  type ReconcileRow,
  type StageField,
  stageFields,
} from "@/modules/linking/reconcile-pure";
import type { Suggestion } from "@/modules/linking/types";
import { BasPicker } from "@/modules/settings/ui";
import { ConfidenceLabel } from "./confidence-label";
import { EntityLabel } from "./entity-label";
import type { JustifyOptions } from "./justify-panel";
import { useReasonLabel } from "./suggestions-section";

const CARD = "pulse-card";
const EYEBROW = "text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase";
const NONE = "__none__";

/** the row's amount with its sign: the facts carry |amount| and the direction */
function signed(r: ReconcileRow): string {
  return r.inbox.row.direction === "incoming" ? r.inbox.row.amount : `-${r.inbox.row.amount}`;
}

function who(r: ReconcileRow): string {
  return r.inbox.list.partnerName ?? r.inbox.list.counterpartyKey ?? r.inbox.list.description;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const el = target;
  return (
    ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ||
    el.isContentEditable ||
    !!el.closest("[role=dialog]") ||
    !!el.closest("[role=listbox]")
  );
}

export function ReconcileMonthNav({ data }: { data: ReconcileData }) {
  const t = useT();
  const lang = useUiLanguage();
  const link = (month: string | null, aria: string, text: (m: string) => string) =>
    month ? (
      <Link
        href={`/banking/reconcile?month=${month}`}
        aria-label={aria}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        {text(formatMonth(month, lang, "short"))}
      </Link>
    ) : null;
  const total = data.progress.justified + data.progress.toJustify;
  const pct = total > 0 ? Math.floor((data.progress.justified / total) * 100) : 100;
  return (
    <div className="flex items-center gap-3" data-testid="reconcile-month-nav">
      <span className="hidden w-40 sm:block" aria-hidden>
        <span className="flex h-1.5 overflow-hidden rounded-full bg-surface-2">
          <i className="block bg-state-done" style={{ width: `${pct}%` }} />
        </span>
      </span>
      {link(data.previous, t("reconcile.previous"), (m) => `‹ ${m}`)}
      {link(data.next, t("reconcile.next"), (m) => `${m} ›`)}
    </div>
  );
}

export function ReconcilePage({
  data,
  partners,
  categories,
  justifyOptions,
  canWrite,
  initialRowId,
}: {
  data: ReconcileData;
  partners: PartnerOption[];
  categories: CategoryOption[];
  justifyOptions: JustifyOptions | null;
  canWrite: boolean;
  initialRowId: string | null;
}) {
  const t = useT();
  const lang = useUiLanguage();
  const router = useRouter();
  const month = formatMonth(data.month, lang);

  // the queue in its groups' order — the order J / K walk
  const ordered = useMemo(
    () => RECONCILE_GROUPS.flatMap((g) => data.rows.filter((r) => r.group === g)),
    [data.rows],
  );
  const [focusId, setFocusId] = useState<string | null>(
    initialRowId && ordered.some((r) => r.id === initialRowId)
      ? initialRowId
      : (ordered[0]?.id ?? null),
  );
  // the list shrinks as rows get justified — keep the focus on a row that is there
  useEffect(() => {
    if (!focusId || !ordered.some((r) => r.id === focusId)) setFocusId(ordered[0]?.id ?? null);
  }, [ordered, focusId]);
  const focus = ordered.find((r) => r.id === focusId) ?? null;
  const index = focus ? ordered.indexOf(focus) : -1;

  const move = useCallback(
    (step: number) => {
      const next = ordered[Math.min(ordered.length - 1, Math.max(0, index + step))];
      if (next) setFocusId(next.id);
    },
    [ordered, index],
  );

  const { executeAsync: bulk, isPending: bulking } = useAction(bulkApplyHighAction);
  const { executeAsync: remove } = useAction(removeLinkAction);
  const ready = ordered.filter((r) => r.group === "ready");

  const acceptAll = useCallback(async () => {
    if (!canWrite || ready.length === 0) return;
    const r = await bulk({ bankTransactionIds: ready.map((x) => x.id) });
    const error = extractError(r);
    if (error) return void toast.error(error);
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    toast.success(
      t("reconcile.acceptAll.done", {
        applied: d?.applied.length ?? 0,
        skipped: (d?.skipped.length ?? 0) + (d?.failed.length ?? 0),
      }),
    );
    router.refresh();
  }, [bulk, canWrite, ready, router, t]);

  const undo = useCallback(
    async (linkId: string) => {
      const r = await remove({ id: linkId });
      const error = extractError(r);
      if (error) return void toast.error(error);
      toast.success(t("reconcile.done.undone"));
      router.refresh();
    },
    [remove, router, t],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        const last = data.done[0];
        if (last && canWrite) {
          e.preventDefault();
          void undo(last.linkId);
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        void acceptAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [acceptAll, canWrite, data.done, move, undo]);

  const nextAfter = (id: string) => {
    const i = ordered.findIndex((r) => r.id === id);
    return ordered[i + 1]?.id ?? ordered[i - 1]?.id ?? null;
  };

  return (
    <div
      className="grid items-start gap-[18px] lg:grid-cols-[20rem_minmax(0,1fr)]"
      data-testid="reconcile-page"
      data-month={data.month}
    >
      <aside className="flex flex-col gap-[18px]" aria-label={t("reconcile.queue")}>
        <section className={cn(CARD, "flex flex-col gap-3 p-4")} data-testid="reconcile-queue">
          {ordered.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("reconcile.empty", { month })}</p>
          )}
          {RECONCILE_GROUPS.map((g) => {
            const rows = ordered.filter((r) => r.group === g);
            if (rows.length === 0) return null;
            return (
              <QueueGroup
                key={g}
                group={g}
                rows={rows}
                focusId={focusId}
                onFocus={setFocusId}
                action={
                  g === "ready" && canWrite ? (
                    <Button
                      size="sm"
                      onClick={() => void acceptAll()}
                      disabled={bulking}
                      data-testid="reconcile-accept-all"
                    >
                      {t("reconcile.acceptAll", { count: rows.length })}
                    </Button>
                  ) : null
                }
              />
            );
          })}
        </section>
        <section className={cn(CARD, "flex flex-col gap-2 p-4")} data-testid="reconcile-done">
          <h2 className="flex items-baseline gap-2 text-sm font-semibold">
            {t("reconcile.done.title")}
            <span className="text-xs font-normal text-muted-foreground">· {data.done.length}</span>
          </h2>
          {data.done.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("reconcile.done.none")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {data.done.map((d) => (
                <li
                  key={d.linkId}
                  className="flex items-center gap-2 text-xs"
                  data-testid="reconcile-done-item"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{d.rowLabel}</span>
                    <span className="text-muted-foreground"> → {d.targetLabel}</span>
                  </span>
                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={() => void undo(d.linkId)}
                    >
                      {t("reconcile.done.undo")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="px-1 text-[11px] text-muted-foreground">{t("reconcile.keys")}</p>
      </aside>

      <section className={cn(CARD, "min-w-0 p-5")} data-testid="reconcile-stage">
        {focus ? (
          <Stage
            key={focus.id}
            row={focus}
            rows={data.rows}
            month={month}
            progress={data.progress}
            partners={partners}
            categories={categories}
            justifyOptions={justifyOptions}
            canWrite={canWrite}
            onAccepted={() => {
              setFocusId(nextAfter(focus.id));
              router.refresh();
            }}
            onSkip={() => move(1)}
            onChanged={() => router.refresh()}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t("reconcile.empty", { month })}</p>
        )}
      </section>
    </div>
  );
}

function QueueGroup({
  group,
  rows,
  focusId,
  onFocus,
  action,
}: {
  group: ReconcileGroup;
  rows: ReconcileRow[];
  focusId: string | null;
  onFocus: (id: string) => void;
  action: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1" data-testid="reconcile-group" data-group={group}>
      <div className="flex items-center gap-2 px-1">
        <span className="text-[13px] font-semibold">{t(`reconcile.group.${group}`)}</span>
        <span className="text-xs text-muted-foreground">
          · {rows.length} · {t(`reconcile.group.${group}.sub`)}
        </span>
        <span className="ml-auto">{action}</span>
      </div>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onFocus(r.id)}
              aria-current={r.id === focusId ? "true" : undefined}
              data-testid="reconcile-row"
              data-row-id={r.id}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover",
                r.id === focusId && "bg-surface-2 ring-1 ring-border",
              )}
            >
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-muted-foreground"
                aria-hidden
              >
                {group === "who" ? "?" : (who(r).trim()[0] ?? "·").toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{who(r)}</span>
                <span className="block font-mono text-[11px] text-muted-foreground tabular-nums">
                  {formatMoney(signed(r), r.inbox.row.currency)} · {r.inbox.list.bookingDate}
                </span>
              </span>
              {r.twins.length > 0 && (
                <span className="text-[11px] text-state-attention" aria-hidden>
                  ×2
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FieldValue({ field, name, testId }: { field: StageField; name: string; testId: string }) {
  const t = useT();
  return (
    <div
      className="flex flex-wrap items-baseline gap-2"
      data-testid={testId}
      data-state={field.state}
    >
      <span className="text-sm font-semibold">{name}</span>
      {field.from && (
        <span className="text-xs text-muted-foreground">
          {t(`reconcile.field.from.${field.from}`)}
        </span>
      )}
    </div>
  );
}

function Stage({
  row,
  rows,
  month,
  progress,
  partners,
  categories,
  justifyOptions,
  canWrite,
  onAccepted,
  onSkip,
  onChanged,
}: {
  row: ReconcileRow;
  rows: ReconcileRow[];
  month: string;
  progress: { justified: number; toJustify: number };
  partners: PartnerOption[];
  categories: CategoryOption[];
  justifyOptions: JustifyOptions | null;
  canWrite: boolean;
  onAccepted: () => void;
  onSkip: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const reasonLabel = useReasonLabel();
  const [pick, setPick] = useState(0);
  const [byHand, setByHand] = useState(row.inbox.suggestions.length === 0);
  const s: Suggestion | null = row.inbox.suggestions[pick] ?? null;
  const fields = useMemo(() => stageFields(row.inbox, s), [row.inbox, s]);
  const [partnerId, setPartnerId] = useState<string | null>(fields.partner.value);
  const [basCode, setBasCode] = useState<string | null>(fields.category.value);
  useEffect(() => {
    setPartnerId(fields.partner.value);
    setBasCode(fields.category.value);
  }, [fields]);
  const { executeAsync: accept, isPending } = useAction(acceptMatchAction);

  const partnerName = (id: string | null) =>
    (id &&
      (partners.find((p) => p.id === id)?.name ??
        (fields.partner.value === id ? fields.partner.label : null))) ||
    null;
  const categoryName = (code: string | null) => {
    if (!code) return null;
    const c = categories.find((x) => x.code === code);
    return c ? c.label : code;
  };
  const needsPartner = !partnerId;
  const twin = rows.find((r) => row.twins.includes(r.id));
  const total = progress.justified + progress.toJustify;

  const doAccept = useCallback(async () => {
    if (!s || !canWrite || needsPartner || isPending) return;
    const r = await accept({
      bankTransactionId: row.id,
      to: { type: s.candidate.type, id: s.candidate.id },
      ...(fields.partner.state !== "sure" && partnerId ? { partnerId } : {}),
      ...(fields.category.state !== "sure" && basCode ? { basCode } : {}),
    });
    const error = extractError(r);
    if (error) return void toast.error(error);
    toast.success(t("reconcile.accepted"));
    onAccepted();
  }, [
    accept,
    basCode,
    canWrite,
    fields,
    isPending,
    needsPartner,
    onAccepted,
    partnerId,
    row.id,
    s,
    t,
  ]);

  useEffect(() => {
    if (byHand) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Enter") {
        e.preventDefault();
        void doAccept();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [byHand, doAccept]);

  const twinHint = twin && (
    <p
      className="rounded-xl border border-state-attention/30 bg-state-attention/6 px-3 py-2 text-[12.5px]"
      data-testid="reconcile-twin"
    >
      {t("reconcile.twin")}
    </p>
  );

  if (byHand || !s) {
    return (
      <div className="flex flex-col gap-3" data-testid="reconcile-by-hand">
        {twinHint}
        {!s && <p className="text-sm text-muted-foreground">{t("reconcile.noCandidate")}</p>}
        {s && (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setByHand(false)}
          >
            ← {t("reconcile.backToMatch")}
          </Button>
        )}
        <TransactionDetailView
          transactionId={row.id}
          categories={categories}
          partners={partners}
          justifyOptions={justifyOptions}
          canWrite={canWrite}
          onChanged={onChanged}
          header={(title, description) => (
            <div>
              <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">{title}</h2>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          )}
        />
        <div className="flex gap-2">
          <Button variant="outline" onClick={onSkip}>
            {t("reconcile.skip")}
          </Button>
        </div>
      </div>
    );
  }

  const c = s.candidate;
  const others = row.inbox.suggestions.length - 1;

  return (
    <div className="flex flex-col gap-4" data-testid="reconcile-match" data-row-id={row.id}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{t("reconcile.stage.match")}</h2>
        <ConfidenceLabel confidence={s.confidence} testId="reconcile-confidence" />
        <span className="text-xs text-muted-foreground">
          {t("reconcile.stage.reasons", { count: s.reasons.length })}
        </span>
      </div>
      {twinHint}

      {/* the bank row ← the lines → the candidate */}
      <div className="grid items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div
          className="flex flex-col gap-1.5 rounded-xl border border-subtle bg-surface-2 p-4"
          data-testid="reconcile-side-row"
        >
          <span className={EYEBROW}>{t("reconcile.stage.row")}</span>
          <span className="text-[15px] font-semibold">
            {row.inbox.list.counterpartyKey || row.inbox.list.description}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("reconcile.stage.booked")} {row.inbox.list.bookingDate} · {row.inbox.accountLabel}
          </span>
          <span className="font-mono text-lg font-medium tabular-nums">
            {formatMoney(signed(row), row.inbox.row.currency)}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {row.inbox.list.description}
          </span>
        </div>
        <ul
          className="flex flex-row flex-wrap items-center justify-center gap-1.5 md:flex-col"
          aria-label={t("reconcile.stage.why")}
          data-testid="reconcile-lines"
        >
          {s.reasons.map((r) => (
            <li key={r} className="flex items-center gap-1.5">
              <span className="hidden h-px w-4 bg-border md:block" aria-hidden />
              <span className="rounded-full bg-state-done/10 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-state-done">
                {reasonLabel(r)}
              </span>
              <span className="hidden h-px w-4 bg-border md:block" aria-hidden />
            </li>
          ))}
        </ul>
        <div
          className="flex flex-col gap-1.5 rounded-xl border border-subtle bg-surface-2 p-4"
          data-testid="reconcile-side-candidate"
        >
          <span className={EYEBROW}>{t("reconcile.stage.candidate")}</span>
          <EntityLabel type={c.type} label={c.label} className="text-[15px] font-semibold" />
          <span className="text-xs text-muted-foreground">
            {c.date}
            {c.partnerName ? ` · ${c.partnerName}` : ""}
            {c.reference ? ` · ${c.reference}` : ""}
          </span>
          <span className="font-mono text-lg font-medium tabular-nums">
            {c.currency ? formatMoney(c.amount, c.currency) : c.amount}
          </span>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{t("reconcile.stage.why")} · </span>
        {s.reasons.map(reasonLabel).join(" · ")}
      </p>

      {/* the two fields — a fact when sure, prefilled and marked when proposed, asked when unknown */}
      <div className="grid gap-3 md:grid-cols-2">
        <div
          className="flex flex-col gap-1.5 rounded-xl border border-subtle p-3"
          data-testid="reconcile-partner"
        >
          <span className={EYEBROW}>{t("reconcile.field.partner")}</span>
          {fields.partner.state === "sure" ? (
            <FieldValue
              field={fields.partner}
              name={partnerName(partnerId) ?? "—"}
              testId="reconcile-partner-value"
            />
          ) : (
            <>
              <Select
                value={partnerId ?? NONE}
                onValueChange={(v) => setPartnerId(!v || v === NONE ? null : v)}
                disabled={!canWrite}
              >
                <SelectTrigger
                  className={cn(
                    "w-full",
                    fields.partner.state === "proposed" && "border-dashed border-action",
                  )}
                  data-state-field={fields.partner.state}
                  aria-label={t("reconcile.field.partner")}
                >
                  <SelectValue>
                    {partnerName(partnerId) ?? t("reconcile.field.ask.partner")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {partners.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                {fields.partner.state === "proposed" && fields.partner.from
                  ? t(`reconcile.field.from.${fields.partner.from}`)
                  : t("reconcile.field.ask.partner")}
              </span>
            </>
          )}
        </div>
        <div
          className="flex flex-col gap-1.5 rounded-xl border border-subtle p-3"
          data-testid="reconcile-category"
        >
          <span className={EYEBROW}>{t("reconcile.field.category")}</span>
          {fields.category.state === "sure" ? (
            <FieldValue
              field={fields.category}
              name={`${basCode ?? ""} ${categoryName(basCode) ?? ""}`.trim() || "—"}
              testId="reconcile-category-value"
            />
          ) : (
            <>
              <BasPicker
                options={categories}
                value={basCode ?? ""}
                onChange={(code) => setBasCode(code || null)}
                direction={row.inbox.row.direction === "incoming" ? "income" : "cost"}
                allowNone
                proposed={fields.category.state === "proposed"}
                disabled={!canWrite}
                data-testid="reconcile-category-picker"
              />
              <span className="text-xs text-muted-foreground">
                {fields.category.state === "proposed" && fields.category.from
                  ? `${t(`reconcile.field.from.${fields.category.from}`)}${
                      fields.category.confidence !== null
                        ? ` · ${t("reconcile.field.confidence", { percent: Math.round(fields.category.confidence * 100) })}`
                        : ""
                    }`
                  : t("reconcile.field.ask.category")}
              </span>
            </>
          )}
        </div>
      </div>

      {row.fx && c === row.inbox.top?.candidate && (
        <div
          className="flex flex-col gap-2 rounded-xl border border-subtle p-3"
          data-testid="reconcile-fx"
        >
          <span className={EYEBROW}>{t("reconcile.fx.title")}</span>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">{t("reconcile.fx.original")}</dt>
              <dd className="font-mono tabular-nums">
                {formatMoney(row.fx.original, row.fx.originalCurrency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("reconcile.fx.ecb", { date: row.fx.rateDate })}
              </dt>
              <dd className="font-mono tabular-nums">
                {row.fx.ecbRate} · {formatMoney(row.fx.ecbAmount, row.fx.rowCurrency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("reconcile.fx.bank")}</dt>
              <dd className="font-mono tabular-nums">
                {row.fx.bankRate} · {formatMoney(row.fx.charged, row.fx.rowCurrency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("reconcile.fx.cost")}</dt>
              <dd className="font-mono font-semibold tabular-nums">
                {formatMoney(row.fx.cost, row.fx.rowCurrency)} · {row.fx.costPercent} %
              </dd>
            </div>
          </dl>
          <span className="text-xs text-muted-foreground">{t("reconcile.fx.note")}</span>
        </div>
      )}

      <div
        className="flex flex-col gap-1 rounded-xl bg-surface-2 p-3"
        data-testid="reconcile-preview"
      >
        <span className={EYEBROW}>{t("reconcile.preview.title")}</span>
        <ul className="flex flex-col gap-0.5 text-[13px]">
          <li>
            ✓ {t("reconcile.preview.link", { label: c.label })}
            {s.allocation && c.currency
              ? ` · ${t("reconcile.preview.allocation", { amount: formatMoney(s.allocation, c.currency) })}`
              : ""}
          </li>
          {partnerId && (
            <li>✓ {t("reconcile.preview.partner", { name: partnerName(partnerId) ?? "" })}</li>
          )}
          {basCode && (
            <li>
              ✓{" "}
              {t("reconcile.preview.category", {
                code: `${basCode} ${categoryName(basCode) ?? ""}`.trim(),
              })}
            </li>
          )}
          {needsPartner ? (
            <li className="text-state-attention">! {t("reconcile.preview.needsPartner")}</li>
          ) : (
            <li>
              ✓{" "}
              {t("reconcile.preview.state", {
                done: progress.justified + 1,
                total,
                month,
              })}
            </li>
          )}
        </ul>
      </div>

      {others > 0 && (
        <details className="text-sm" data-testid="reconcile-others">
          <summary className="cursor-pointer text-muted-foreground">
            {t("reconcile.stage.others", { count: others })}
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {row.inbox.suggestions.map((o, i) =>
              i === pick ? null : (
                <li
                  key={`${o.candidate.type}:${o.candidate.id}`}
                  className="flex items-center gap-2"
                >
                  <ConfidenceLabel confidence={o.confidence} />
                  <EntityLabel
                    type={o.candidate.type}
                    label={o.candidate.label}
                    className="min-w-0 flex-1 truncate"
                  />
                  <Button variant="outline" size="sm" onClick={() => setPick(i)}>
                    {t("reconcile.stage.pick")}
                  </Button>
                </li>
              ),
            )}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-3">
        {canWrite && (
          <Button
            onClick={() => void doAccept()}
            disabled={needsPartner || isPending}
            data-testid="reconcile-accept"
          >
            {t("reconcile.accept")} <kbd className="ml-1 text-[10px] opacity-70">Enter</kbd>
          </Button>
        )}
        <Button variant="outline" onClick={() => setByHand(true)}>
          {t("reconcile.byHand")}
        </Button>
        <Button variant="ghost" className="ml-auto" onClick={onSkip}>
          {t("reconcile.skip")} <kbd className="ml-1 text-[10px] opacity-70">J</kbd>
        </Button>
      </div>
    </div>
  );
}
