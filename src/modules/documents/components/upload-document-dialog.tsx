"use client";

// F73: the sidebar's **+ New → Upload document** lands on /documents?new=1 and opens this dialog — the same
// upload zone as above the library (type, drop / pick one or several files, the duplicate card), so nothing about uploading differs.
// Stays open after an upload (the key, *Upload another*); the list behind refreshes.
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/kernel/i18n/use-t";
import { FileUploadZone } from "./file-upload-zone";

export function UploadDocumentDialog({
  open,
  onOpenChange,
  prefixOptions,
  onUploadComplete,
  onBatchComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefixOptions: { documentType: string; prefix: string }[];
  onUploadComplete?: () => void;
  /** F92: once a batch of several files is through */
  onBatchComplete?: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="upload-document-dialog">
        <DialogHeader>
          <DialogTitle>{t("nav.new.document")}</DialogTitle>
        </DialogHeader>
        <FileUploadZone
          prefixOptions={prefixOptions}
          onUploadComplete={onUploadComplete}
          onBatchComplete={onBatchComplete}
        />
      </DialogContent>
    </Dialog>
  );
}
