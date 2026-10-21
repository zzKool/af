"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { FormattedDate } from "@/kernel/i18n/formatted-date";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import type { DocumentReviewData } from "@/modules/documents/documents.actions";

const QUALITY_CONFIG: Record<string, { label: MessageKey; className: string }> = {
  high: {
    label: "documents.review.quality.high",
    className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  low: {
    label: "documents.review.quality.low",
    className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  },
  none: {
    label: "documents.review.quality.none",
    className: "bg-muted text-muted-foreground",
  },
};

const STATUS_KEYS = [
  "uploaded",
  "processing",
  "extracted",
  "ocr_failed",
  "linked",
  "generated",
] as const;
type DocumentStatusKey = (typeof STATUS_KEYS)[number];
const isKnownStatus = (s: string): s is DocumentStatusKey =>
  (STATUS_KEYS as readonly string[]).includes(s);

const STATUS_COLORS: Record<string, string> = {
  uploaded: "bg-muted text-muted-foreground",
  processing: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  extracted: "bg-muted text-muted-foreground",
  ocr_failed: "bg-destructive/10 text-destructive",
  linked: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

export function DocumentReviewHeader({ data }: { data: DocumentReviewData }) {
  const t = useT();
  const qualityInfo = data.quality ? QUALITY_CONFIG[data.quality] : null;
  const fileSizeKb = Math.round(data.fileSize / 1024);

  return (
    <div className="space-y-2">
      <Link href="/documents" className="text-sm text-muted-foreground hover:text-foreground">
        &larr; {t("documents.review.back")}
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold font-mono">{data.businessKey}</h1>
        <Badge
          variant="outline"
          className={STATUS_COLORS[data.status] ?? "bg-muted text-muted-foreground"}
        >
          {isKnownStatus(data.status) ? t(`documents.status.${data.status}`) : data.status}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <span>{data.fileName}</span>
        <span>{fileSizeKb} KB</span>
        <span>
          {t("documents.review.uploaded")} <FormattedDate date={data.createdAt} />
        </span>
      </div>

      {/* Quality indicator — owner only */}
      {!data.readOnly && qualityInfo && (
        <div aria-live="polite">
          <Badge variant="outline" className={qualityInfo.className}>
            {data.quality === "high" && "● "}
            {data.quality === "low" && "▲ "}
            {data.quality === "none" && "○ "}
            {t(qualityInfo.label)}
          </Badge>
        </div>
      )}

      {/* Review status */}
      <div className="text-sm text-muted-foreground">
        {data.reviewedAt ? (
          <span>
            {t("documents.review.reviewed")} <FormattedDate date={data.reviewedAt} />
          </span>
        ) : (
          <span>{t("documents.review.awaiting")}</span>
        )}
      </div>
    </div>
  );
}
