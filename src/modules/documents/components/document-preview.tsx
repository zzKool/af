"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import { SIGNED_URL_REFRESH_MS } from "@/kernel/nav/constants";
import { refreshSignedUrlAction } from "@/modules/documents/documents.actions";

// MUST NOT import server code (except type imports from actions)

// LOCAL worker — NOT CDN (enterprise reliability)
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

/** Route cross-origin Azurite URLs through our same-origin proxy to avoid CORS. */
function proxyIfLocal(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
      return `/api/blob-proxy?url=${encodeURIComponent(url)}`;
    }
  } catch {
    // not a valid URL — return as-is
  }
  return url;
}

type DocumentPreviewProps = {
  signedUrl: string;
  mimeType: string;
  documentId: string;
};

export default function DocumentPreview({ signedUrl, mimeType, documentId }: DocumentPreviewProps) {
  const t = useT();
  const [previewUrl, setPreviewUrl] = useState(proxyIfLocal(signedUrl));
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const isPdf = mimeType === "application/pdf";

  // Signed URL auto-refresh at 80% TTL
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const result = await refreshSignedUrlAction({ documentId });
        if (result?.data?.data?.signedUrl) {
          setPreviewUrl(proxyIfLocal(result.data.data.signedUrl));
        }
      } catch {
        // Signed URL refresh failure is non-fatal — current URL stays active
      }
    }, SIGNED_URL_REFRESH_MS);
    return () => clearInterval(interval);
  }, [documentId]);

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
    const proxied = proxyIfLocal(signedUrl);
    const sep = proxied.includes("?") ? "&" : "?";
    setPreviewUrl(`${proxied}${sep}retry=${Date.now()}`);
  }, [signedUrl]);

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
      <div className="flex-1 overflow-auto p-4" tabIndex={0}>
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
            <Page
              pageNumber={currentPage}
              scale={zoom}
              rotate={rotation}
              loading={null}
              suspense={false}
            />
          </Document>
        ) : (
          // biome-ignore lint/performance/noImgElement: signed Azure blob URLs with rotation/zoom — next/image not compatible
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
        )}
      </div>
    </div>
  );
}
