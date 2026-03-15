"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { SIGNED_URL_REFRESH_MS } from "@/lib/constants";
import { refreshSignedUrlAction } from "@/server/actions/documents";

// MUST NOT import from @/server/* (except type imports from actions)

// LOCAL worker — NOT CDN (enterprise reliability)
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type DocumentPreviewProps = {
  signedUrl: string;
  mimeType: string;
  documentId: string;
};

export default function DocumentPreview({ signedUrl, mimeType, documentId }: DocumentPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState(signedUrl);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const pdfDocRef = useRef<{ destroy: () => void } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isPdf = mimeType === "application/pdf";

  // Signed URL auto-refresh at 80% TTL
  useEffect(() => {
    const interval = setInterval(async () => {
      const result = await refreshSignedUrlAction({ documentId });
      if (result?.data?.data?.signedUrl) {
        setPreviewUrl(result.data.data.signedUrl);
      }
    }, SIGNED_URL_REFRESH_MS);
    return () => clearInterval(interval);
  }, [documentId]);

  // Cleanup PDF on unmount
  useEffect(() => {
    return () => {
      pdfDocRef.current?.destroy();
    };
  }, []);

  const onDocumentLoadSuccess = useCallback((pdf: { numPages: number; destroy: () => void }) => {
    setNumPages(pdf.numPages);
    setLoading(false);
    pdfDocRef.current = pdf;
  }, []);

  const onDocumentLoadError = useCallback(() => {
    setError(true);
    setLoading(false);
  }, []);

  const handleRetry = useCallback(() => {
    setError(false);
    setLoading(true);
    setPreviewUrl(`${signedUrl}&retry=${Date.now()}`);
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

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 rounded-lg border bg-muted/50 p-8">
        <p className="text-muted-foreground">Unable to load preview</p>
        <Button variant="outline" size="sm" onClick={handleRetry}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col"
      role="application"
      aria-label="Document preview"
    >
      {/* Controls */}
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <Button variant="outline" size="sm" onClick={handleRotate} title="Rotate">
          &#x21bb; Rotate
        </Button>
        <Button variant="outline" size="sm" onClick={handleZoomOut} title="Zoom out">
          &minus;
        </Button>
        <Button variant="outline" size="sm" onClick={handleZoomIn} title="Zoom in">
          +
        </Button>
        <Button variant="outline" size="sm" onClick={handleFitWidth} title="Fit width">
          Fit
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
            <span>
              Page {currentPage}/{numPages}
            </span>
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
      <div className="flex-1 overflow-auto p-4">
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
          >
            <Page pageNumber={currentPage} scale={zoom} rotate={rotation} loading={null} />
          </Document>
        ) : (
          // biome-ignore lint/performance/noImgElement: signed Azure blob URLs with rotation/zoom — next/image not compatible
          <img
            src={previewUrl}
            alt="Document preview"
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
