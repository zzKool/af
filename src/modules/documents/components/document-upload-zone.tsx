"use client";

import { useDocumentLibraryInvalidate } from "@/modules/documents/components/document-library-client";
import { FileUploadZone } from "@/modules/documents/components/file-upload-zone";

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
