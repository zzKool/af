"use client";

// *What it read* (F185, the board *Documents*; F186 the reading dialog): one row per field the reading found — the
// label, the value in bold, the confidence on the right and a thin bar under it in its band's colour (sure in the
// reading colour, to check amber, low red; the owner's word is sure). Hovering, focusing or clicking a row makes it
// the active field: its box stands out on the page (`MarksOverlay`), and the host keeps it until another one is
// picked. A field to check opens in place with its question and one-click answers (`checkAsk`: an ambiguous date →
// the two dates, a total that is not net + VAT → both, else *is it right?*), and any value can be corrected in
// place. The host decides what an answer does: the inbox writes a correction on the document, the reading dialog
// keeps it for the entity. Presentational; no server import.
import { Check, Pencil } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/kernel/i18n/locale-provider";
import { useT } from "@/kernel/i18n/use-t";
import { confidenceLabel } from "@/kernel/ocr/confidence";
import { monthName } from "@/kernel/ui/data-table/filters/date-filter";
import { cn } from "@/lib/utils";
import type { InboxFacts } from "@/modules/documents/queries";
import type { MarkedKey } from "@/modules/documents/reading-marks";

export type { MarkedKey };

import { type CheckAsk, checkAsk } from "@/modules/documents/to-check";

/**
 * The question a value asks (F186, for a host outside the module — the reading dialog): the to-check rule on a field
 * read at `confidence`, printed as `content`, the values as edited in `facts`.
 */
export function askFor(
  key: MarkedKey,
  confidence: number | null,
  content: string | null,
  facts: InboxFacts,
): CheckAsk | null {
  return checkAsk({ key, confidence, content, box: null }, facts);
}

export type ReadField = {
  key: string;
  label: string;
  /** the value as shown (formatted money, a date, a name) */
  value: ReactNode;
  /** what the inline edit starts from (`yyyy-mm-dd`, `1250.00`, the text) */
  raw: string;
  input: "text" | "date" | "amount";
  confidence: number | null;
  /** DI's high band, or the owner's word */
  sure: boolean;
  /** the owner corrected or confirmed it */
  corrected?: boolean;
  /** the question it asks while not sure; null = nothing to ask */
  ask: CheckAsk | null;
  /** form mode (F186): the value's input's test id */
  testId?: string;
  /** form mode: shown, never typed (a value derived from the others) */
  readOnly?: boolean;
  /** form mode: a control after the value (the total's currency) */
  suffix?: ReactNode;
};

/** the bar and the figure by DI's band: sure in the reading colour, to check amber, low red */
const BAND = {
  high: { bar: "bg-read", text: "text-read" },
  medium: { bar: "bg-state-attention", text: "text-state-attention" },
  low: { bar: "bg-destructive", text: "text-destructive" },
} as const;

/** `2026-08-07` → `Aug 7` in the UI language */
function shortDay(iso: string, lang: string): string {
  return `${monthName(iso.slice(0, 7), lang)} ${Number(iso.slice(8, 10))}`;
}

export function WhatItRead({
  fields,
  active,
  onActive,
  onAnswer,
  canWrite,
  busy = false,
  formatAmount = (v) => v,
  testId = "what-it-read",
  footer,
  mode = "answer",
}: {
  fields: ReadField[];
  active: string | null;
  onActive: (key: string) => void;
  /** an answer or an edit: the field's new raw value (`yyyy-mm-dd`, `1250.00`, text) */
  onAnswer?: (key: string, raw: string) => void;
  canWrite: boolean;
  busy?: boolean;
  /** an amount chip's words (`1 250.00 SEK`) */
  formatAmount?: (raw: string) => string;
  testId?: string;
  footer?: ReactNode;
  /**
   * `answer` (the desk): the values read, a question for a field to check, a correction on a click; `form` (the
   * reading dialog, F186): every value is its own quiet input — what the entity will take, nothing written on the
   * document; only the questions a reading can answer (a date's order, a total) are asked
   */
  mode?: "answer" | "form";
}) {
  const t = useT();
  const sure = fields.filter((f) => f.sure).length;
  return (
    <section className="flex flex-col gap-1.5" data-testid={testId}>
      <div className="flex items-center px-1 pt-0.5 pb-1.5">
        <h2 className="text-[13px] font-semibold">{t("documents.read.title")}</h2>
        <span className="ml-auto text-xs text-muted-foreground" data-public>
          {t("documents.read.count", { sure, check: fields.length - sure })}
        </span>
      </div>
      {fields.map((f) => (
        <FieldRow
          key={f.key}
          field={f}
          on={active === f.key}
          onActive={() => onActive(f.key)}
          onAnswer={canWrite && onAnswer ? (raw) => onAnswer(f.key, raw) : undefined}
          busy={busy}
          formatAmount={formatAmount}
          form={mode === "form"}
        />
      ))}
      {footer}
    </section>
  );
}

function FieldRow({
  field: f,
  on,
  onActive,
  onAnswer,
  busy,
  formatAmount,
  form = false,
}: {
  field: ReadField;
  on: boolean;
  onActive: () => void;
  onAnswer?: (raw: string) => void;
  busy: boolean;
  formatAmount: (raw: string) => string;
  form?: boolean;
}) {
  const t = useT();
  const lang = useLocale().effectiveLocale ?? "en";
  const [editing, setEditing] = useState(false);
  const band = confidenceLabel(f.confidence);
  const look = f.corrected ? BAND.high : band ? BAND[band] : null;
  const pct = typeof f.confidence === "number" ? Math.round(f.confidence * 100) : null;
  const edit = () => {
    onActive();
    setEditing(true);
  };
  const ask = !f.sure && !(form && f.ask?.kind === "confirm") ? f.ask : null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the hover joins the row to its box on the page — the row's button carries focus and click
    <div
      className={cn(
        "group/field flex flex-col gap-[5px] rounded-[10px] border border-transparent px-2.5 py-[9px]",
        on
          ? "border-subtle bg-foreground/[0.04]"
          : "hover:border-subtle hover:bg-foreground/[0.04]",
      )}
      onMouseEnter={onActive}
      data-mark={f.key}
      data-active={on ? "true" : undefined}
      data-sure={f.sure ? "true" : undefined}
      data-testid="read-field"
    >
      {form ? (
        <div className="flex min-w-0 items-center gap-2">
          <label
            htmlFor={`read-${f.key}`}
            className="w-[92px] shrink-0 truncate text-[11.5px] text-muted-foreground"
          >
            {f.label}
          </label>
          <FormValue field={f} onActive={onActive} onAnswer={onAnswer} />
          {f.suffix}
          <ConfidenceFigure field={f} pct={pct} look={look} />
        </div>
      ) : (
        <div className="flex min-w-0 items-baseline gap-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-baseline gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded-sm"
            onFocus={onActive}
            onClick={onActive}
            onDoubleClick={onAnswer ? edit : undefined}
          >
            <span className="w-[92px] shrink-0 truncate text-[11.5px] text-muted-foreground">
              {f.label}
            </span>
            {!editing && (
              <span className="min-w-0 flex-1 truncate font-medium tabular-nums">{f.value}</span>
            )}
          </button>
          {editing && onAnswer && (
            <InlineEdit
              field={f}
              onDone={(raw) => {
                setEditing(false);
                if (raw !== null && raw !== f.raw) onAnswer(raw);
              }}
            />
          )}
          {onAnswer && !editing && (
            <button
              type="button"
              className="shrink-0 rounded-sm text-muted-foreground opacity-0 outline-none group-hover/field:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={edit}
              aria-label={t("documents.read.correct", { field: f.label })}
              title={t("documents.read.correct", { field: f.label })}
              data-testid="read-field-edit"
            >
              <Pencil className="size-3" aria-hidden />
            </button>
          )}
          <ConfidenceFigure field={f} pct={pct} look={look} />
        </div>
      )}
      <div className="h-[3px] overflow-hidden rounded-full bg-subtle" aria-hidden>
        <div
          className={cn("h-full rounded-full", look?.bar ?? "bg-transparent")}
          style={{ width: f.corrected ? "100%" : `${pct ?? 0}%` }}
        />
      </div>
      {ask && (
        <AskLine
          ask={ask}
          field={f}
          lang={lang}
          onAnswer={onAnswer}
          onEdit={edit}
          busy={busy}
          formatAmount={formatAmount}
        />
      )}
    </div>
  );
}

/** The confidence on the right: the % in its band's colour, a check for the owner's word, a dash for none. */
function ConfidenceFigure({
  field: f,
  pct,
  look,
}: {
  field: ReadField;
  pct: number | null;
  look: { text: string } | null;
}) {
  const t = useT();
  return (
    <span
      className={cn("shrink-0 font-mono text-[11px]", look?.text ?? "text-muted-foreground")}
      data-public
      title={f.corrected ? t("documents.read.checked") : undefined}
      data-testid="read-field-confidence"
    >
      {f.corrected ? (
        <Check className="inline size-3" aria-label={t("documents.read.checked")} />
      ) : pct !== null ? (
        `${pct}%`
      ) : (
        "—"
      )}
    </span>
  );
}

/** Form mode (F186): the value as a quiet input — bold like the board's value, a border only on hover and focus. */
function FormValue({
  field: f,
  onActive,
  onAnswer,
}: {
  field: ReadField;
  onActive: () => void;
  onAnswer?: (raw: string) => void;
}) {
  const quiet =
    "h-7 min-w-0 flex-1 rounded-md border-transparent bg-transparent px-1.5 font-medium shadow-none hover:border-border focus-visible:border-primary";
  const common = {
    id: `read-${f.key}`,
    onFocus: onActive,
    readOnly: f.readOnly || !onAnswer,
    tabIndex: f.readOnly ? -1 : undefined,
    "data-testid": f.testId,
  };
  if (f.input === "date" && !f.readOnly)
    return (
      <DateInput
        {...common}
        className={cn(quiet, "pr-7")}
        value={f.raw}
        onChange={(e) => onAnswer?.(e.target.value)}
      />
    );
  return (
    <Input
      {...common}
      className={cn(quiet, "text-[13px] tabular-nums")}
      inputMode={f.input === "amount" ? "decimal" : undefined}
      value={f.raw}
      onChange={(e) => onAnswer?.(e.target.value)}
    />
  );
}

/** The question of a field to check and its one-click answers (the first is the reading's own value). */
function AskLine({
  ask,
  field: f,
  lang,
  onAnswer,
  onEdit,
  busy,
  formatAmount,
}: {
  ask: CheckAsk;
  field: ReadField;
  lang: string;
  onAnswer?: (raw: string) => void;
  onEdit: () => void;
  busy: boolean;
  formatAmount: (raw: string) => string;
}) {
  const t = useT();
  let question: string;
  let answers: { raw: string; label: string }[];
  if (ask.kind === "dateOrder") {
    question = t("documents.read.ask.dateOrder", {
      printed: ask.printed,
      a: shortDay(ask.options[0], lang),
      b: shortDay(ask.options[1], lang),
    });
    answers = ask.options.map((o) => ({ raw: o, label: o }));
  } else if (ask.kind === "total") {
    question = t("documents.read.ask.total");
    answers = ask.options.map((o) => ({ raw: o, label: formatAmount(o) }));
  } else {
    question =
      typeof f.confidence === "number"
        ? t("documents.read.ask.confirm", { pct: Math.round(f.confidence * 100) })
        : t("documents.read.ask.confirmUnknown");
    answers = [{ raw: f.raw, label: t("documents.read.ask.yes") }];
  }
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 text-xs text-state-attention"
      data-testid="read-field-ask"
      data-ask={ask.kind}
    >
      <span>{question}</span>
      {onAnswer &&
        answers.map((a, i) => (
          <Button
            key={a.raw + a.label}
            size="xs"
            variant={i === 0 ? "default" : "outline"}
            className="h-7 rounded-lg px-2.5 tabular-nums"
            disabled={busy}
            onClick={() => onAnswer(a.raw)}
            data-testid="read-field-answer"
          >
            {a.label}
          </Button>
        ))}
      {onAnswer && ask.kind === "confirm" && (
        <Button
          size="xs"
          variant="outline"
          className="h-7 rounded-lg px-2.5"
          disabled={busy}
          onClick={onEdit}
          data-testid="read-field-change"
        >
          {t("documents.read.ask.change")}
        </Button>
      )}
    </div>
  );
}

/** The value corrected in place: Enter keeps it, Escape (or leaving the field) drops it. */
function InlineEdit({
  field: f,
  onDone,
}: {
  field: ReadField;
  onDone: (raw: string | null) => void;
}) {
  const t = useT();
  const [value, setValue] = useState(f.raw);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const keys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onDone(value.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onDone(null);
    }
  };
  if (f.input === "date")
    return (
      <DateInput
        autoFocus
        className="h-7 flex-1"
        value={value}
        onChange={(e) => onDone(e.target.value)}
        onKeyDown={keys}
        onBlur={() => onDone(null)}
        aria-label={f.label}
        data-testid="read-field-input"
      />
    );
  return (
    <Input
      ref={ref}
      className="h-7 flex-1 text-[13px]"
      inputMode={f.input === "amount" ? "decimal" : undefined}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={keys}
      onBlur={() => onDone(null)}
      aria-label={f.label}
      placeholder={t("documents.read.editHint")}
      data-testid="read-field-input"
    />
  );
}
