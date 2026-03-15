"use client";

import Link from "next/link";
import { FormattedDate } from "@/components/domain/formatted-date";
import { Badge } from "@/components/ui/badge";
import type { DocumentReviewData } from "@/server/actions/documents";

const QUALITY_CONFIG: Record<string, { label: string; className: string }> = {
  high: {
    label: "Review extracted data",
    className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  low: {
    label: "Low Confidence — Manual Review Recommended",
    className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  },
  none: {
    label: "Manual Entry Required",
    className: "bg-muted text-muted-foreground",
  },
};

const STATUS_COLORS: Record<string, string> = {
  uploaded: "bg-muted text-muted-foreground",
  processing: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  extracted: "bg-muted text-muted-foreground",
  ocr_failed: "bg-destructive/10 text-destructive",
  linked: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

export function DocumentReviewHeader({ data }: { data: DocumentReviewData }) {
  const qualityInfo = data.quality ? QUALITY_CONFIG[data.quality] : null;
  const fileSizeKb = Math.round(data.fileSize / 1024);

  return (
    <div className="space-y-2">
      <Link href="/documents" className="text-sm text-muted-foreground hover:text-foreground">
        &larr; Back to Documents
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold font-mono">{data.businessKey}</h1>
        <Badge
          variant="outline"
          className={STATUS_COLORS[data.status] ?? "bg-muted text-muted-foreground"}
        >
          {data.status}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <span>{data.fileName}</span>
        <span>{fileSizeKb} KB</span>
        <span>
          Uploaded <FormattedDate date={data.createdAt} />
        </span>
      </div>

      {/* Quality indicator — owner only */}
      {!data.readOnly && qualityInfo && (
        <div aria-live="polite">
          <Badge variant="outline" className={qualityInfo.className}>
            {data.quality === "high" && "● "}
            {data.quality === "low" && "▲ "}
            {data.quality === "none" && "○ "}
            {qualityInfo.label}
          </Badge>
        </div>
      )}

      {/* Review status */}
      <div className="text-sm text-muted-foreground">
        {data.reviewedAt ? (
          <span>
            Reviewed <FormattedDate date={data.reviewedAt} />
          </span>
        ) : (
          <span>Awaiting review</span>
        )}
      </div>
    </div>
  );
}
