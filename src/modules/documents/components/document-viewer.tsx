"use client";

// The document viewer for other modules (F131, the reading dialog): `document-preview` (react-pdf) loaded on the
// client only — pdfjs touches `DOMMatrix` at import time, so the preview itself is never on `ui.ts`; this wrapper
// is, and loads it the way the review page does (`next/dynamic`, `ssr: false`). Zoom, rotate and the pages are the
// preview's own.
import dynamic from "next/dynamic";

const DocumentPreview = dynamic(() => import("@/modules/documents/components/document-preview"), {
  ssr: false,
  loading: () => <div className="h-full min-h-48 animate-pulse rounded-lg bg-muted" />,
});

export function DocumentViewer({ fileUrl, mimeType }: { fileUrl: string; mimeType: string }) {
  return <DocumentPreview fileUrl={fileUrl} mimeType={mimeType} />;
}
