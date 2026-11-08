"use client";

// Phone — snap a receipt (F142, Pulse phase 6c; the board *Phone*): 1 · take the photo (the phone's camera, or a
// file) — it goes up untyped (D78) and is read by the receipt model; 2 · check what was read — from, date, amount,
// the trip the date falls in, the category — and one tap says who paid; 3 · saved: the expense's key, what the
// company owes in total, the receipts still missing, *Snap the next one*. Big targets, one column, no rail.
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { CURRENCIES } from "@/kernel/nav/constants";
import { cn } from "@/lib/utils";
import { getDocumentForReviewAction, uploadDocumentAction } from "@/modules/documents/ui";
import { createExpenseAction, phoneSummaryAction } from "@/modules/expenses/expenses.actions";
import { proposeGroupForDate } from "@/modules/expenses/group-proposal";
import type { PhoneSummary } from "@/modules/expenses/phone";
import type { CategoryOption, GroupOption, SourceOption } from "@/modules/expenses/types";

const CARD = "rounded-2xl border border-subtle bg-surface p-5 shadow-card";
/** how long the page waits for the reading before it lets the owner type it */
const READ_TIMEOUT_MS = 45_000;
const POLL_MS = 1200;

type Step =
  | { kind: "snap" }
  | { kind: "reading"; documentId: string; startedAt: number }
  | { kind: "check"; documentId: string; seconds: number | null }
  | { kind: "saved"; key: string };

type Draft = {
  from: string;
  date: string;
  amount: string;
  currency: string;
  groupId: string;
  basCode: string;
};

const today = () => new Date().toISOString().slice(0, 10);

export function PhoneCapture({
  groups,
  categories,
  sources,
  base,
  initialSummary,
}: {
  groups: GroupOption[];
  categories: CategoryOption[];
  sources: SourceOption[];
  base: string;
  initialSummary: PhoneSummary;
}) {
  const t = useT();
  const [step, setStep] = useState<Step>({ kind: "snap" });
  const [draft, setDraft] = useState<Draft>({
    from: "",
    date: today(),
    amount: "",
    currency: base,
    groupId: "",
    basCode: "",
  });
  const [summary, setSummary] = useState(initialSummary);
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const { executeAsync: upload, isPending: uploading } = useAction(uploadDocumentAction);
  const { executeAsync: read } = useAction(getDocumentForReviewAction);
  const { executeAsync: create, isPending: saving } = useAction(createExpenseAction);
  const { executeAsync: refreshSummary } = useAction(phoneSummaryAction);

  const groupOptions = useMemo(
    () => groups.map((g) => ({ ...g, name: `${g.number} ${g.description}` })),
    [groups],
  );
  const proposal = useMemo(
    () => (draft.date ? proposeGroupForDate(draft.date, groupOptions) : null),
    [draft.date, groupOptions],
  );
  // the trip the date falls in proposes the group, until the owner picks one
  useEffect(() => {
    if (proposal?.groupId && !draft.groupId)
      setDraft((d) => ({ ...d, groupId: proposal.groupId ?? "" }));
  }, [proposal, draft.groupId]);
  const proposedGroup = groups.find((g) => g.id === proposal?.groupId) ?? null;

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("prefixType", "document");
      const r = await upload(fd);
      const error = extractError(r);
      if (error) return void toast.error(error);
      const d = r?.data && "data" in r.data ? r.data.data : undefined;
      const id = d?.kind === "stored" ? d.id : d?.kind === "duplicate" ? d.existing.id : null;
      if (!id) return;
      if (d?.kind === "duplicate") toast.info(t("phone.duplicate"));
      setStep({ kind: "reading", documentId: id, startedAt: Date.now() });
    },
    [t, upload],
  );

  // 2 · wait for the reading (the OCR job runs after the upload's commit), then fill the draft from it
  useEffect(() => {
    if (step.kind !== "reading") return;
    let stopped = false;
    const tick = async () => {
      const r = await read({ documentId: step.documentId });
      if (stopped) return;
      const doc = r?.data && "data" in r.data ? r.data.data : undefined;
      const done = doc && (doc.status === "extracted" || doc.status === "ocr_failed");
      if (done || Date.now() - step.startedAt > READ_TIMEOUT_MS) {
        const v = doc?.resolvedData ?? {};
        setDraft((d) => ({
          ...d,
          from: v.merchantName ?? v.vendorName ?? "",
          date: v.transactionDate ?? v.invoiceDate ?? d.date,
          amount: typeof v.invoiceTotal === "number" ? v.invoiceTotal.toFixed(2) : "",
          currency:
            v.currency && (CURRENCIES as readonly string[]).includes(v.currency.toUpperCase())
              ? v.currency.toUpperCase()
              : d.currency,
          groupId: "",
        }));
        setStep({
          kind: "check",
          documentId: step.documentId,
          seconds: done ? Math.max(1, Math.round((Date.now() - step.startedAt) / 100) / 10) : null,
        });
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };
    let timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [step, read]);

  const ready = !!(
    draft.from &&
    draft.date &&
    Number(draft.amount) > 0 &&
    draft.groupId &&
    draft.basCode
  );

  const save = async (source: SourceOption) => {
    if (step.kind !== "check" || !ready) return;
    const r = await create({
      groupId: draft.groupId,
      date: draft.date,
      description: draft.from,
      basCode: draft.basCode,
      amount: Number(draft.amount).toFixed(2),
      currency: draft.currency as (typeof CURRENCIES)[number],
      paidFromAccountId: source.id,
      documentId: step.documentId,
    });
    const error = extractError(r);
    if (error) return void toast.error(error);
    const expense = r?.data && "data" in r.data ? r.data.data : undefined;
    const s = await refreshSummary({});
    const next = s?.data && "data" in s.data ? s.data.data : undefined;
    if (next) setSummary(next);
    setStep({ kind: "saved", key: expense?.key ?? "" });
  };

  const reset = () => {
    setDraft({ from: "", date: today(), amount: "", currency: base, groupId: "", basCode: "" });
    setStep({ kind: "snap" });
  };

  const privateFirst = [...sources].sort((a, b) =>
    a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "private" ? -1 : 1,
  );

  return (
    <div
      className="mx-auto flex w-full max-w-md flex-col gap-4"
      data-testid="phone-capture"
      data-step={step.kind}
    >
      {step.kind === "snap" && (
        <section className={cn(CARD, "flex flex-col items-center gap-4 py-10 text-center")}>
          <p className="text-sm text-muted-foreground">{t("phone.snap.hint")}</p>
          <label
            className={cn(
              buttonVariants({ size: "lg" }),
              "h-14 w-full cursor-pointer text-base",
              uploading && "pointer-events-none opacity-60",
            )}
          >
            {uploading ? t("phone.snap.uploading") : t("phone.snap.camera")}
            <input
              ref={camera}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              data-testid="phone-camera"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
          <label className={cn(buttonVariants({ variant: "outline" }), "w-full cursor-pointer")}>
            {t("phone.snap.files")}
            <input
              ref={files}
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              data-testid="phone-file"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
        </section>
      )}

      {step.kind === "reading" && (
        <section
          className={cn(CARD, "flex flex-col items-center gap-3 py-10 text-center")}
          data-testid="phone-reading"
        >
          <div
            className="size-8 animate-spin rounded-full border-4 border-surface-2 border-t-action"
            aria-hidden
          />
          <p className="text-sm">{t("phone.reading")}</p>
        </section>
      )}

      {step.kind === "check" && (
        <section className={cn(CARD, "flex flex-col gap-3")} data-testid="phone-check">
          <div>
            <h2 className="text-lg font-semibold">{t("phone.check.title")}</h2>
            <p className="text-xs text-muted-foreground">
              {step.seconds !== null
                ? t("phone.check.read", { seconds: step.seconds })
                : t("phone.check.notRead")}
            </p>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("phone.field.from")}
            <Input
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              className="h-11 text-base text-foreground"
              data-testid="phone-from"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("phone.field.date")}
              <Input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value, groupId: "" })}
                className="h-11 text-base text-foreground"
                data-testid="phone-date"
              />
            </label>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("phone.field.amount")}
              <div className="flex gap-1">
                <Input
                  inputMode="decimal"
                  value={draft.amount}
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value.replace(",", ".") })}
                  className="h-11 min-w-0 text-base text-foreground tabular-nums"
                  aria-label={t("phone.field.amount")}
                  data-testid="phone-amount"
                />
                <select
                  value={draft.currency}
                  onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
                  className="h-11 rounded-md border border-input bg-background px-2 text-base text-foreground"
                  aria-label={t("phone.field.currency")}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("phone.field.group")}
            <select
              value={draft.groupId}
              onChange={(e) => setDraft({ ...draft, groupId: e.target.value })}
              className="h-11 rounded-md border border-input bg-background px-2 text-base text-foreground"
              data-testid="phone-group"
            >
              <option value="">—</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.number} · {g.description}
                </option>
              ))}
            </select>
            {proposedGroup && proposal?.reason === "trip" && draft.groupId === proposedGroup.id && (
              <span className="text-state-done" data-testid="phone-trip">
                {t("phone.trip", { trip: proposedGroup.description, date: draft.date })}
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("phone.field.category")}
            <select
              value={draft.basCode}
              onChange={(e) => setDraft({ ...draft, basCode: e.target.value })}
              className="h-11 rounded-md border border-input bg-background px-2 text-base text-foreground"
              data-testid="phone-category"
            >
              <option value="">—</option>
              {categories
                // a receipt's account: the cost classes 4 – 7 with a short code (the expense key needs one)
                .filter((c) => c.alias && (c.classNum ?? 0) >= 4 && (c.classNum ?? 0) <= 7)
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
            </select>
          </label>

          <div className="mt-1 flex flex-col gap-2">
            <p className="text-sm font-semibold">{t("phone.whoPaid")}</p>
            {privateFirst.map((s) => (
              <Button
                key={s.id}
                size="lg"
                variant={s.kind === "private" ? "default" : "outline"}
                className="h-12 justify-between text-base"
                disabled={!ready || saving}
                onClick={() => void save(s)}
                data-testid="phone-paid"
                data-kind={s.kind}
              >
                <span>
                  {s.kind === "private" ? t("phone.paid.private") : t("phone.paid.company")}
                </span>
                <span className="text-xs opacity-80">{s.label}</span>
              </Button>
            ))}
            {!ready && <p className="text-xs text-muted-foreground">{t("phone.fillFirst")}</p>}
          </div>
        </section>
      )}

      {step.kind === "saved" && (
        <section className={cn(CARD, "flex flex-col gap-4")} data-testid="phone-saved">
          <div className="text-center">
            <p className="text-xs tracking-wider text-muted-foreground uppercase">
              {t("phone.saved.title")}
            </p>
            <p className="mt-1 font-mono text-xl font-semibold" data-testid="phone-saved-key">
              {step.key}
            </p>
          </div>
          <div className="rounded-xl bg-surface-2 p-4 text-center">
            <p className="text-xs text-muted-foreground">{t("phone.saved.owed")}</p>
            <p className="text-2xl font-semibold tabular-nums" data-testid="phone-owed">
              {formatMoney(summary.owed, base)}
            </p>
          </div>
          {summary.missing.length > 0 && (
            <div className="flex flex-col gap-1.5" data-testid="phone-missing">
              <p className="text-sm font-semibold">{t("phone.saved.missing")}</p>
              {summary.missing.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    {m.description} · {m.date}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                    {formatMoney(m.amount, m.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <Button size="lg" className="h-12 text-base" onClick={reset} data-testid="phone-next">
            {t("phone.saved.next")}
          </Button>
          <Link href="/dashboard" className={buttonVariants({ variant: "ghost" })}>
            {t("phone.saved.done")}
          </Link>
        </section>
      )}
    </div>
  );
}
