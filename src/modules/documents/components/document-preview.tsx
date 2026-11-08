"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import { confidenceLabel } from "@/kernel/ocr/confidence";
import { cn } from "@/lib/utils";
import type { ReadingMarks } from "@/modules/documents/reading-marks";

// MUST NOT import server code (except type imports from actions)

// LOCAL worker — NOT CDN (enterprise reliability)
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type DocumentPreviewProps = {
  /** the authenticated route `/api/documents/{id}/file` (F106) — same origin, the session cookie goes with it; nothing to refresh */
  fileUrl: string;
  mimeType: string;
  /** F141: what the reading found and where — a box per field on its page; the active one stands out */
  marks?: ReadingMarks | null;
  active?: string | null;
};

/**
 * The boxes of one page over the rendered page (F141): an SVG in the page's own unit (DI's inches for a PDF, pixels
 * for an image), stretched over the page — the polygons need no conversion. Sure fields green, the rest amber, the
 * hovered one in the action colour. Decorative: *What it read* is the accessible list.
 */
export function MarksOverlay({
  marks,
  page,
  active = null,
}: {
  marks: ReadingMarks;
  page: number;
  active?: string | null;
}) {
  const size = marks.pages.find((p) => p.page === page);
  const boxes = marks.marks.filter((m) => m.box?.page === page);
  if (!size || boxes.length === 0) return null;
  return (
    <svg
      viewBox={`0 0 ${size.width} ${size.height}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 size-full"
      aria-hidden
      data-testid="preview-marks"
    >
      {boxes.map((m) => {
        const sure = confidenceLabel(m.confidence) === "high";
        return (
          <polygon
            key={m.key}
            data-mark={m.key}
            data-active={m.key === active ? "true" : undefined}
            points={(m.box?.polygon ?? []).join(" ")}
            vectorEffect="non-scaling-stroke"
            strokeWidth={m.key === active ? 2.5 : 1.5}
            className={cn(
              m.key === active
                ? "fill-action/15 stroke-action"
                : sure
                  ? "fill-state-done/10 stroke-state-done"
                  : "fill-state-attention/12 stroke-state-attention",
            )}
          />
        );
      })}
    </svg>
  );
}

export default function DocumentPreview({
  fileUrl,
  mimeType,
  marks = null,
  active = null,
}: DocumentPreviewProps) {
  const t = useT();
  const [previewUrl, setPreviewUrl] = useState(fileUrl);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  // the page fits the area's width (zoom 1 = fit): a narrow pane never crops the page — or its boxes (F141)
  const areaRef = useRef<HTMLDivElement>(null);
  const [areaWidth, setAreaWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = areaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setAreaWidth(Math.max(200, Math.floor(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isPdf = mimeType === "application/pdf";

  // <Document> destroys its own loading task on unmount (react-pdf ≥ 11 has no destroy on the proxy)
  const onDocumentLoadSuccess = useCallback((pdf: { numPages: number }) => {
    setNumPages(pdf.numPages);
    setLoading(false);
  }, []);

  const onDocumentLoadError = useCallback(() => {
    setError(true);
    setLoading(false);
  }, []);

  const handleRetry = useCallback(() => {
    setError(false);
    setLoading(true);
    const sep = fileUrl.includes("?") ? "&" : "?";
    setPreviewUrl(`${fileUrl}${sep}retry=${Date.now()}`);
  }, [fileUrl]);

  const handleRotate = useCallback(() => {
    setRotation((prev) => (prev + 90) % 360);
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + 0.25, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev - 0.25, 0.5));
  }, []);

  const handleFitWidth = useCallback(() => {
    setZoom(1);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isPdf) return;
      if (e.key === "ArrowLeft" && currentPage > 1) {
        setCurrentPage((p) => p - 1);
      } else if (e.key === "ArrowRight" && currentPage < numPages) {
        setCurrentPage((p) => p + 1);
      }
    },
    [isPdf, currentPage, numPages],
  );

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 rounded-lg border bg-muted/50 p-8">
        <p className="text-muted-foreground">{t("documents.preview.failed")}</p>
        <Button variant="outline" size="sm" onClick={handleRetry}>
          {t("documents.preview.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: document viewer needs focus for keyboard page navigation
      tabIndex={0}
      role="document"
      aria-label={t("documents.preview.label")}
      onKeyDown={handleKeyDown}
    >
      {/* Controls */}
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRotate}
          title={t("documents.preview.rotate")}
        >
          &#x21bb; {t("documents.preview.rotate")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleZoomOut}
          title={t("documents.preview.zoomOut")}
        >
          &minus;
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleZoomIn}
          title={t("documents.preview.zoomIn")}
        >
          +
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleFitWidth}
          title={t("documents.preview.fitWidth")}
        >
          {t("documents.preview.fit")}
        </Button>
        {isPdf && numPages > 0 && (
          <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => p - 1)}
            >
              &lt;
            </Button>
            <span>{t("documents.preview.page", { page: currentPage, pages: numPages })}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= numPages}
              onClick={() => setCurrentPage((p) => p + 1)}
            >
              &gt;
            </Button>
          </div>
        )}
      </div>

      {/* Preview area */}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard (axe scrollable-region-focusable) */}
      <div ref={areaRef} className="flex-1 overflow-auto p-4" tabIndex={0}>
        {loading && (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
          </div>
        )}

        {isPdf ? (
          <Document
            file={previewUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={null}
            // react-pdf 11 suspends by default; this page shows its own spinner from the callbacks
            suspense={false}
          >
            <div className="relative mx-auto w-fit">
              <Page
                pageNumber={currentPage}
                {...(areaWidth ? { width: areaWidth * zoom } : { scale: zoom })}
                rotate={rotation}
                loading={null}
                suspense={false}
              />
              {marks && rotation === 0 && !loading && (
                <MarksOverlay marks={marks} page={currentPage} active={active} />
              )}
            </div>
          </Document>
        ) : (
          <div className="relative mx-auto w-fit">
            {/* biome-ignore lint/performance/noImgElement: signed Azure blob URLs with rotation/zoom — next/image not compatible */}
            <img
              src={previewUrl}
              alt={t("documents.preview.label")}
              onLoad={() => setLoading(false)}
              onError={() => setError(true)}
              className="mx-auto max-w-full transition-transform"
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
                transformOrigin: "center center",
              }}
            />
            {marks && rotation === 0 && zoom === 1 && !loading && (
              <MarksOverlay marks={marks} page={1} active={active} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
