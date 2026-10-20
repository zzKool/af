"use client";

// Settings → Traktamente (specs/traktamente US4): year tabs, the rows, add / edit a country, copy last year,
// paste Skatteverket's CSV with a preview.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatCurrency } from "@/kernel/money/format-currency";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  copyRatesFromYearAction,
  deleteRateAction,
  pasteSkatteverketCsvAction,
  upsertRateAction,
} from "@/modules/traktamente/traktamente.actions";
import type { NormalbeloppDto } from "@/modules/traktamente/types";

export type RateRowView = Omit<NormalbeloppDto, "createdAt" | "updatedAt">;

type Draft = {
  year: number;
  countryCode: string;
  countryNameSv: string;
  countryNameEn: string;
  dayAmount: string;
  nightAmount: string;
  mealBreakfast: string;
  mealLunch: string;
  mealDinner: string;
  mealAll: string;
};

const empty = (year: number): Draft => ({
  year,
  countryCode: "",
  countryNameSv: "",
  countryNameEn: "",
  dayAmount: "",
  nightAmount: "",
  mealBreakfast: "",
  mealLunch: "",
  mealDinner: "",
  mealAll: "",
});

function RateDialog({
  open,
  onOpenChange,
  initial,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: Draft;
  editing: boolean;
}) {
  const t = useT();
  const ids = useId();
  const router = useRouter();
  const [d, setD] = useState<Draft>(initial);
  const { executeAsync, isPending } = useAction(upsertRateAction);
  // re-seed when (re)opened with another row
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setD(initial);
  }
  const field = (
    key: keyof Draft,
    label: string,
    extra: Partial<React.ComponentProps<typeof Input>> = {},
  ) => (
    <div key={key}>
      <label htmlFor={`${ids}-${key}`} className="mb-1 block text-xs font-medium">
        {label}
      </label>
      <Input
        id={`${ids}-${key}`}
        value={String(d[key])}
        onChange={(e) =>
          setD((x) => ({ ...x, [key]: key === "year" ? Number(e.target.value) : e.target.value }))
        }
        {...extra}
      />
    </div>
  );
  async function submit() {
    const r = await executeAsync({
      year: d.year,
      countryCode: d.countryCode.trim().toUpperCase(),
      countryNameSv: d.countryNameSv.trim(),
      countryNameEn: d.countryNameEn.trim() || null,
      dayAmount: d.dayAmount.trim(),
      nightAmount: d.nightAmount.trim() || null,
      mealBreakfast: d.mealBreakfast.trim() || null,
      mealLunch: d.mealLunch.trim() || null,
      mealDinner: d.mealDinner.trim() || null,
      mealAll: d.mealAll.trim() || null,
      rateSource: "manual",
    });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("traktamente.saved"));
    onOpenChange(false);
    router.refresh();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="rate-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? `${d.countryCode} ${d.year}` : t("traktamente.add")}</DialogTitle>
          <DialogDescription>{t("traktamente.col.day")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {field("year", t("traktamente.form.year"), { type: "number", disabled: editing })}
          {field("countryCode", t("traktamente.form.code"), {
            maxLength: 2,
            disabled: editing,
            "data-testid": "rate-code",
          } as Partial<React.ComponentProps<typeof Input>>)}
          {field("countryNameSv", t("traktamente.form.nameSv"), { required: true })}
          {field("countryNameEn", t("traktamente.form.nameEn"))}
          {field("dayAmount", t("traktamente.form.day"), {
            inputMode: "decimal",
            required: true,
            "data-testid": "rate-day",
          } as Partial<React.ComponentProps<typeof Input>>)}
          {field("nightAmount", t("traktamente.form.night"), { inputMode: "decimal" })}
          {field("mealBreakfast", t("traktamente.form.breakfast"), { inputMode: "decimal" })}
          {field("mealLunch", t("traktamente.form.lunch"), { inputMode: "decimal" })}
          {field("mealDinner", t("traktamente.form.dinner"), { inputMode: "decimal" })}
          {field("mealAll", t("traktamente.form.all"), { inputMode: "decimal" })}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isPending} data-testid="save-rate">
              {t("traktamente.form.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasteDialog({
  open,
  onOpenChange,
  year,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  year: number;
}) {
  const t = useT();
  const ids = useId();
  const router = useRouter();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ rows: number; skipped: number } | null>(null);
  const { executeAsync, isPending } = useAction(pasteSkatteverketCsvAction);
  async function run(dryRun: boolean) {
    const r = await executeAsync({ text, year, dryRun });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    if (!d) return;
    if (dryRun) {
      setPreview({ rows: d.rows.length, skipped: d.skipped.length });
      return;
    }
    toast.success(t("traktamente.paste.done", { created: d.created, updated: d.updated }));
    setText("");
    setPreview(null);
    onOpenChange(false);
    router.refresh();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="paste-dialog">
        <DialogHeader>
          <DialogTitle>{t("traktamente.paste")}</DialogTitle>
          <DialogDescription>{t("traktamente.paste.description")}</DialogDescription>
        </DialogHeader>
        <label htmlFor={`${ids}-text`} className="sr-only">
          {t("traktamente.paste")}
        </label>
        <textarea
          id={`${ids}-text`}
          className="min-h-40 w-full rounded-md border bg-background p-2 font-mono text-xs"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
          placeholder={"2026;Schweiz;CH;1402"}
          data-testid="paste-text"
        />
        {preview && (
          <p className="text-sm" data-testid="paste-preview">
            {preview.rows} rows · {t("traktamente.paste.skipped", { count: preview.skipped })}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => void run(true)}
            disabled={isPending || !text.trim()}
            data-testid="paste-preview-button"
          >
            {t("traktamente.paste.preview")}
          </Button>
          <Button
            onClick={() => void run(false)}
            disabled={isPending || !preview || preview.rows === 0}
            data-testid="paste-apply"
          >
            {t("traktamente.paste.apply", { count: preview?.rows ?? 0 })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RateTable({
  years,
  year,
  rows,
}: {
  years: number[];
  year: number;
  rows: RateRowView[];
}) {
  const t = useT();
  const router = useRouter();
  const [dialog, setDialog] = useState<{ draft: Draft; editing: boolean } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const { executeAsync: copy, isPending: copying } = useAction(copyRatesFromYearAction);
  const { executeAsync: remove } = useAction(deleteRateAction);
  const deleteDialog = useConfirmDialog({
    title: t("traktamente.delete"),
    variant: "destructive",
    confirmLabel: t("common.delete"),
  });
  const previous = years.filter((y) => y < year).sort((a, b) => b - a)[0];
  const allYears = [...new Set([...years, year, new Date().getFullYear()])].sort((a, b) => b - a);

  async function copyFrom(from: number) {
    const r = await copy({ fromYear: from, toYear: year });
    const error = extractError(r);
    if (error) return toast.error(error);
    const d = r?.data?.data;
    toast.success(t("traktamente.copied", { copied: d?.copied ?? 0, skipped: d?.skipped ?? 0 }));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3" data-testid="rate-table">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="tablist" aria-label={t("traktamente.year")}>
          {allYears.map((y) => (
            <Button
              key={y}
              size="sm"
              variant={y === year ? "default" : "outline"}
              onClick={() => router.push(`/settings/traktamente?year=${y}`)}
              role="tab"
              aria-selected={y === year}
            >
              {y}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          {previous !== undefined && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copyFrom(previous)}
              disabled={copying}
              data-testid="copy-year"
            >
              {t("traktamente.copyFrom", { year: previous })}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPasteOpen(true)}
            data-testid="open-paste"
          >
            {t("traktamente.paste")}
          </Button>
          <Button
            size="sm"
            onClick={() => setDialog({ draft: empty(year), editing: false })}
            data-testid="add-rate"
          >
            {t("traktamente.add")}
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("traktamente.noYears")}</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("traktamente.col.country")}</TableHead>
                <TableHead className="w-16">{t("traktamente.col.code")}</TableHead>
                <TableHead className="w-40 text-right">{t("traktamente.col.day")}</TableHead>
                <TableHead className="w-28 text-right">{t("traktamente.col.night")}</TableHead>
                <TableHead className="w-44">{t("traktamente.col.meals")}</TableHead>
                <TableHead className="w-36">{t("traktamente.col.source")}</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} data-testid="rate-row">
                  <TableCell>
                    {r.countryNameSv}
                    {r.countryNameEn ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({r.countryNameEn})
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.countryCode}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(r.dayAmount, "SEK")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.nightAmount ? formatCurrency(r.nightAmount, "SEK") : "½"}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-muted-foreground">
                    {r.mealAll
                      ? `${r.mealBreakfast} / ${r.mealLunch} / ${r.mealDinner} · ${r.mealAll}`
                      : "15 / 35 / 35 %"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.rateSource}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDialog({
                          editing: true,
                          draft: {
                            year: r.year,
                            countryCode: r.countryCode,
                            countryNameSv: r.countryNameSv,
                            countryNameEn: r.countryNameEn ?? "",
                            dayAmount: r.dayAmount,
                            nightAmount: r.nightAmount ?? "",
                            mealBreakfast: r.mealBreakfast ?? "",
                            mealLunch: r.mealLunch ?? "",
                            mealDinner: r.mealDinner ?? "",
                            mealAll: r.mealAll ?? "",
                          },
                        })
                      }
                    >
                      {t("common.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        deleteDialog.confirm(
                          async () => {
                            const res = await remove({ id: r.id });
                            const error = extractError(res);
                            if (error) throw new Error(error);
                            toast.success(t("traktamente.deleted"));
                            router.refresh();
                          },
                          { description: `${r.countryNameSv} ${r.year}` },
                        )
                      }
                    >
                      {t("common.delete")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {dialog && (
        <RateDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          initial={dialog.draft}
          editing={dialog.editing}
        />
      )}
      <PasteDialog open={pasteOpen} onOpenChange={setPasteOpen} year={year} />
      <ConfirmDialog {...deleteDialog.dialogProps} />
    </div>
  );
}
