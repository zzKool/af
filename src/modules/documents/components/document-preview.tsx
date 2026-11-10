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
  /** F185: the fields the owner corrected — their boxes are sure */
  corrected?: readonly string[];
  /** F185, the board *Documents*: the page alone, as paper — no toolbar, fitted to the area, pages as chips under it */
  bare?: boolean;
};

/**
 * The boxes of one page over the rendered page (F141; F185 the board's look): a box per field, placed in percent of
 * the page from the field's polygon in the page's own unit (DI's inches for a PDF, pixels for an image) — so it
 * follows the page at any size. Sure fields in the reading colour, the rest amber, the active one (the field
 * hovered in *What it read*) ringed thicker and glowing. Decorative: *What it read* is the accessible list.
 */
export function MarksOverlay({
  marks,
  page,
  active = null,
  corrected = [],
}: {
  marks: ReadingMarks;
  page: number;
  active?: string | null;
  /** the fields the owner corrected — sure, whatever the reading said */
  corrected?: readonly string[];
}) {
  const size = marks.pages.find((p) => p.page === page);
  const boxes = marks.marks.filter((m) => m.box?.page === page);
  if (!size || boxes.length === 0 || !(size.width > 0) || !(size.height > 0)) return null;
  // a little air around the printed words, as the board draws them
  const padX = size.width * 0.006;
  const padY = size.height * 0.003;
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden data-testid="preview-marks">
      {boxes.map((m) => {
        const poly = m.box?.polygon ?? [];
        const xs = poly.filter((_, i) => i % 2 === 0);
        const ys = poly.filter((_, i) => i % 2 === 1);
        const x0 = Math.max(0, Math.min(...xs) - padX);
        const y0 = Math.max(0, Math.min(...ys) - padY);
        const x1 = Math.min(size.width, Math.max(...xs) + padX);
        const y1 = Math.min(size.height, Math.max(...ys) + padY);
        const sure = corrected.includes(m.key) || confidenceLabel(m.confidence) === "high";
        const on = m.key === active;
        return (
          <div
            key={m.key}
            data-mark={m.key}
            data-active={on ? "true" : undefined}
            data-sure={sure ? "true" : undefined}
            className={cn(
              "absolute rounded-[4px] transition-all duration-150",
              sure
                ? on
                  ? "bg-read/16 shadow-[0_0_0_2.5px_var(--read),0_0_22px_color-mix(in_oklab,var(--read)_60%,transparent)]"
                  : "bg-read/6 shadow-[0_0_0_1.5px_color-mix(in_oklab,var(--read)_55%,transparent)]"
                : on
                  ? "bg-state-attention/16 shadow-[0_0_0_2.5px_var(--state-attention),0_0_22px_color-mix(in_oklab,var(--state-attention)_60%,transparent)]"
                  : "bg-state-attention/10 shadow-[0_0_0_1.5px_color-mix(in_oklab,var(--state-attention)_80%,transparent)]",
            )}
            style={{
              left: `${(x0 / size.width) * 100}%`,
              top: `${(y0 / size.height) * 100}%`,
              width: `${((x1 - x0) / size.width) * 100}%`,
              height: `${((y1 - y0) / size.height) * 100}%`,
            }}
          />
        );
      })}
    </div>
  );
}

export default function DocumentPreview(props: DocumentPreviewProps) {
  return props.bare ? <PaperPreview {...props} /> : <ViewerPreview {...props} />;
}

/**
 * The page as paper (F185, the board *Documents*): fitted whole into its area — the width or the height, whichever
 * binds, from the page's own proportions —, the boxes over it, the pages as chips under it when there are several.
 * The review page keeps the full viewer (zoom, rotate).
 */
function PaperPreview({
  fileUrl,
  mimeType,
  marks = null,
  active = null,
  corrected = [],
}: DocumentPreviewProps) {
  const t = useT();
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const first = marks?.pages[0];
  const [aspect, setAspect] = useState(() =>
    first && first.width > 0 && first.height > 0 ? first.height / first.width : 11 / 8.5,
  );
  const [numPages, setNumPages] = useState(0);
  const [current, setCurrent] = useState(1);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState(fileUrl);
  useEffect(() => {
    const el = areaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry)
        setArea({
          w: Math.floor(entry.contentRect.width),
          h: Math.floor(entry.contentRect.height),
        });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const isPdf = mimeType === "application/pdf";
  const navH = numPages > 1 ? 34 : 0;
  const width = area ? Math.max(120, Math.floor(Math.min(area.w, (area.h - navH) / aspect))) : null;

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-muted-foreground">{t("documents.preview.failed")}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setError(false);
            setUrl(`${fileUrl}${fileUrl.includes("?") ? "&" : "?"}retry=${Date.now()}`);
          }}
        >
          {t("documents.preview.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div ref={areaRef} className="relative size-full" data-testid="paper-preview">
      {width && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
          <div
            className="relative shrink-0 overflow-hidden rounded-md bg-paper shadow-pop"
            style={{ width, height: Math.round(width * aspect) }}
            role="document"
            aria-label={t("documents.preview.label")}
          >
            {isPdf ? (
              <Document
                file={url}
                onLoadSuccess={(pdf: { numPages: number }) => setNumPages(pdf.numPages)}
                onLoadError={() => setError(true)}
                loading={null}
                suspense={false}
              >
                <Page
                  pageNumber={current}
                  width={width}
                  loading={null}
                  suspense={false}
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                  onLoadSuccess={(page: { originalWidth: number; originalHeight: number }) => {
                    if (page.originalWidth > 0) setAspect(page.originalHeight / page.originalWidth);
                    setLoaded(true);
                  }}
                />
              </Document>
            ) : (
              // biome-ignore lint/performance/noImgElement: the authenticated file route — next/image cannot fetch it
              <img
                src={url}
                alt={t("documents.preview.label")}
                className="size-full object-contain"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth > 0) setAspect(img.naturalHeight / img.naturalWidth);
                  setLoaded(true);
                }}
                onError={() => setError(true)}
              />
            )}
            {marks && loaded && (
              <MarksOverlay marks={marks} page={current} active={active} corrected={corrected} />
            )}
          </div>
          {numPages > 1 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground" data-public>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={current <= 1}
                onClick={() => setCurrent((p) => p - 1)}
                aria-label={t("documents.preview.previous")}
              >
                ‹
              </Button>
              <span>{t("documents.preview.page", { page: current, pages: numPages })}</span>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={current >= numPages}
                onClick={() => setCurrent((p) => p + 1)}
                aria-label={t("documents.preview.next")}
              >
                ›
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ViewerPreview({
  fileUrl,
  mimeType,
  marks = null,
  active = null,
  corrected = [],
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
                <MarksOverlay
                  marks={marks}
                  page={currentPage}
                  active={active}
                  corrected={corrected}
                />
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
              <MarksOverlay marks={marks} page={1} active={active} corrected={corrected} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
