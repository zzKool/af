"use client";

// The document viewer for other modules (F131, the reading dialog): `document-preview` (react-pdf) loaded on the
// client only — pdfjs touches `DOMMatrix` at import time, so the preview itself is never on `ui.ts`; this wrapper
// is, and loads it the way the review page does (`next/dynamic`, `ssr: false`). Zoom, rotate and the pages are the
// preview's own. F186: given the reading, the page carries its boxes (`readingMarks`), the active field lit; `bare`
// shows the page as paper (the board *Documents*).
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { readingMarks } from "@/modules/documents/reading-marks";

const DocumentPreview = dynamic(() => import("@/modules/documents/components/document-preview"), {
  ssr: false,
  loading: () => <div className="h-full min-h-48 animate-pulse rounded-lg bg-muted" />,
});

/** what the boxes are read from: the OCR's own reading (its fields, its model, its pages) */
export type ViewerReading = Parameters<typeof readingMarks>[0];

export function DocumentViewer({
  fileUrl,
  mimeType,
  reading = null,
  active = null,
  bare = false,
}: {
  fileUrl: string;
  mimeType: string;
  reading?: ViewerReading | null;
  active?: string | null;
  bare?: boolean;
}) {
  const marks = useMemo(() => (reading ? readingMarks(reading) : null), [reading]);
  return (
    <DocumentPreview
      fileUrl={fileUrl}
      mimeType={mimeType}
      marks={marks}
      active={active}
      bare={bare}
    />
  );
}
