"use client";

// The docked details panel of a period (D40): what the package would say if built now — its flags, the
// documents that go in, notes.md — and the built versions. The title row carries one primary: *Build* /
// *Rebuild* (owner); *Download* the latest version beside it.
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { extractError } from "@/kernel/errors/extract-error";
import { useLocale } from "@/kernel/i18n/locale-provider";
import { uiLanguage } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { DetailsSection } from "@/kernel/ui/details-section";
import { StateLabel } from "@/kernel/ui/state-label";
import { CodeChip } from "@/kernel/ui/tags";
import { packagePreviewAction } from "@/modules/package/package.actions";
import { periodLabel } from "@/modules/package/period";
import type { LivePreview } from "@/modules/package/queries";
import {
  BUILD_STATUS_FAMILY,
  isRunning,
  PERIOD_STATE_FAMILY,
  periodState,
} from "@/modules/package/state-family";
import { FlagList } from "./flag-list";
import type { OverviewRow } from "./package-workbench";

export function PackagePanel({
  row,
  canBuild,
  building,
  onBuild,
  onDownload,
  onClose,
}: {
  row: OverviewRow | null;
  canBuild: boolean;
  /** a build request is on its way */
  building: boolean;
  onBuild: (period: string) => void;
  onDownload: (documentId: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent data-testid="package-preview">
        {row && (
          <PeriodDetails
            key={row.period}
            row={row}
            canBuild={canBuild}
            building={building}
            onBuild={onBuild}
            onDownload={onDownload}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function PeriodDetails({
  row,
  canBuild,
  building,
  onBuild,
  onDownload,
}: {
  row: OverviewRow;
  canBuild: boolean;
  building: boolean;
  onBuild: (period: string) => void;
  onDownload: (documentId: string) => void;
}) {
  const t = useT();
  const { effectiveLocale: locale } = useLocale();
  const lang = uiLanguage(locale ?? null);
  const [preview, setPreview] = useState<LivePreview | null>(null);
  const { executeAsync: loadPreview } = useAction(packagePreviewAction);

  // the preview of the period, collected on request (one per panel: the panel is keyed by the period)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await loadPreview({ period: row.period });
      if (cancelled) return;
      const error = extractError(r);
      if (error) {
        toast.error(error);
        return;
      }
      const d = r?.data && "data" in r.data ? r.data.data : undefined;
      if (d) setPreview(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [row.period, loadPreview]);

  const state = periodState(row);
  const latest = row.builds[0] ?? null;
  const lastBuilt = row.builds.find((b) => b.status === "built" && b.documentId) ?? null;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex flex-wrap items-center gap-2">
          {t("package.preview.title", { period: periodLabel(row.period, lang) })}
        </SheetTitle>
        <SheetDescription>
          <StateLabel family={PERIOD_STATE_FAMILY[state]} state={t(`package.state.${state}`)} />
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-wrap items-center gap-2">
        {lastBuilt?.documentId && (
          <Button
            size="sm"
            variant="outline"
            title={lastBuilt.businessKey}
            onClick={() => onDownload(lastBuilt.documentId as string)}
            data-testid="package-download"
          >
            {t("package.downloadVersion", { version: lastBuilt.version })}
          </Button>
        )}
        {canBuild && (
          <Button
            size="sm"
            disabled={building || (latest !== null && isRunning(latest))}
            onClick={() => onBuild(row.period)}
            data-testid="package-build"
          >
            {lastBuilt ? t("package.rebuild") : t("package.build")}
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {preview === null ? (
          <p className="py-2 text-[13px] text-muted-foreground">{t("package.preview.loading")}</p>
        ) : (
          <>
            <DetailsSection title={t("package.preview.flags", { count: preview.flags.length })}>
              <FlagList flags={preview.flags} />
            </DetailsSection>
            <DetailsSection title={t("package.preview.files", { count: preview.files.length })}>
              <ul className="max-h-48 overflow-auto font-mono text-xs">
                {preview.files.map((f) => (
                  <li key={f} className="truncate" title={f}>
                    {f}
                  </li>
                ))}
                {preview.files.length === 0 && <li className="text-muted-foreground">—</li>}
              </ul>
            </DetailsSection>
            <DetailsSection title={t("package.preview.notes")} defaultOpen={false}>
              <pre
                className="max-h-96 overflow-auto rounded-md border border-subtle px-3 py-2 text-xs whitespace-pre-wrap"
                data-testid="package-notes"
              >
                {preview.notes}
              </pre>
            </DetailsSection>
          </>
        )}
        <DetailsSection title={t("package.preview.builds")}>
          {row.builds.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{t("package.noBuild")}</p>
          ) : (
            <ul className="flex flex-col">
              {row.builds.map((b) => (
                <li
                  key={b.id}
                  className="flex flex-col gap-1 border-b border-subtle py-1.5 last:border-b-0"
                  data-testid="package-version"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <StateLabel
                      family={BUILD_STATUS_FAMILY[b.status]}
                      state={t(`package.status.${b.status}`)}
                    />
                    <CodeChip className="min-w-0 truncate">{b.businessKey}</CodeChip>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                    {b.builtAt && <span>{b.builtAt.slice(0, 16).replace("T", " ")}</span>}
                    {b.status === "built" && (
                      <span>{t("package.version.flags", { flags: b.flags })}</span>
                    )}
                    {b.status === "failed" && b.error && (
                      <span className="truncate text-destructive" title={b.error}>
                        {b.error}
                      </span>
                    )}
                    {b.documentId && (
                      <Button
                        size="sm"
                        variant="link"
                        className="ml-auto"
                        onClick={() => onDownload(b.documentId as string)}
                        data-testid="package-version-download"
                      >
                        {t("package.download")}
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DetailsSection>
      </div>
    </>
  );
}
