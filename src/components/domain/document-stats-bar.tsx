"use client";

import { AlertCircle, Eye, FileText } from "lucide-react";
import type { DocumentFilters } from "@/server/actions/documents";

// MUST NOT import from @/server/services/*

interface DocumentStats {
  totalCount: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  unreviewed: number;
}

interface DocumentStatsBarProps {
  stats: DocumentStats | null;
  onFilterApply: (filters: Partial<DocumentFilters>) => void;
}

export function DocumentStatsBar({ stats, onFilterApply }: DocumentStatsBarProps) {
  if (!stats || stats.totalCount === 0) return null;

  const ocrFailed = stats.byStatus?.ocr_failed ?? 0;

  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {/* Total documents */}
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 hover:bg-accent transition-colors cursor-pointer"
        onClick={() => onFilterApply({ status: undefined, search: undefined })}
        title="Show all documents"
      >
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{stats.totalCount}</span>
        <span className="text-muted-foreground">documents</span>
      </button>

      {/* Needs review */}
      {stats.unreviewed > 0 && (
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md border bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800 px-3 py-1.5 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition-colors cursor-pointer"
          onClick={() => onFilterApply({ status: ["extracted"] })}
          title="Filter: needs review"
        >
          <Eye className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" />
          <span className="font-medium text-yellow-800 dark:text-yellow-300">
            {stats.unreviewed}
          </span>
          <span className="text-yellow-700 dark:text-yellow-400">need review</span>
        </button>
      )}

      {/* OCR failed */}
      {ocrFailed > 0 && (
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md border bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800 px-3 py-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors cursor-pointer"
          onClick={() => onFilterApply({ status: ["ocr_failed"] })}
          title="Filter: OCR failed"
        >
          <AlertCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
          <span className="font-medium text-red-800 dark:text-red-300">{ocrFailed}</span>
          <span className="text-red-700 dark:text-red-400">OCR failed</span>
        </button>
      )}
    </div>
  );
}
