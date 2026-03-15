"use client";

import { useDocumentLibraryInvalidate } from "@/components/domain/document-library-client";
import { FileUploadZone } from "@/components/domain/file-upload-zone";

interface PrefixOption {
  documentType: string;
  prefix: string;
}

interface DocumentUploadZoneProps {
  prefixOptions: PrefixOption[];
}

/**
 * Wraps FileUploadZone with document library cache invalidation.
 * After a successful upload, invalidates the documents and stats queries
 * so the table refreshes automatically.
 */
export function DocumentUploadZone({ prefixOptions }: DocumentUploadZoneProps) {
  const invalidate = useDocumentLibraryInvalidate();

  return (
    <FileUploadZone
      prefixOptions={prefixOptions}
      onUploadComplete={() => {
        invalidate();
      }}
    />
  );
}
