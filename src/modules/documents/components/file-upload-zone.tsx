"use client";

import { AlertCircle, CheckCircle, Copy, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { AppError } from "@/kernel/errors/app-error";
import { useT } from "@/kernel/i18n/use-t";
import { MAX_FILE_SIZE_MB } from "@/kernel/nav/constants";
import { CodeChip } from "@/kernel/ui/tags";
import { cn } from "@/lib/utils";
import type { DuplicateUploadRef } from "@/modules/documents/documents";
import { uploadDocumentAction } from "@/modules/documents/documents.actions";

const ACCEPTED_EXTENSIONS = ".pdf,.jpg,.jpeg,.png,.tiff,.tif";
const SLOW_UPLOAD_MS = 3000;

type PrefixOption = { documentType: string; prefix: string };

type FileUploadZoneProps = {
  prefixOptions: PrefixOption[];
  onUploadComplete?: (doc: { id: string; businessKey: string; fileName: string }) => void;
  onError?: (error: AppError) => void;
};

type UploadState = "idle" | "dragover" | "uploading" | "complete" | "duplicate" | "error";

export function FileUploadZone({ prefixOptions, onUploadComplete, onError }: FileUploadZoneProps) {
  const t = useT();
  // unique: the zone renders twice when + New opens the upload dialog over the library (F73)
  const prefixId = useId();
  const [state, setState] = useState<UploadState>("idle");
  const [selectedPrefix, setSelectedPrefix] = useState(prefixOptions[0]?.documentType ?? "");
  const [uploadedDoc, setUploadedDoc] = useState<{
    id: string;
    businessKey: string;
    fileName: string;
  } | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<DuplicateUploadRef | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [showSlow, setShowSlow] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { executeAsync } = useAction(uploadDocumentAction);

  useEffect(() => {
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  const handleUpload = useCallback(
    async (file: File, force = false) => {
      // Client-side pre-validation
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setErrorMessage(`File exceeds ${MAX_FILE_SIZE_MB} MB limit`);
        setState("error");
        return;
      }

      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const validExts = ["pdf", "jpg", "jpeg", "png", "tiff", "tif"];
      if (!validExts.includes(ext)) {
        setErrorMessage(t("documents.upload.unsupported"));
        setState("error");
        return;
      }

      fileRef.current = file;
      setState("uploading");
      setShowSlow(false);

      slowTimerRef.current = setTimeout(() => setShowSlow(true), SLOW_UPLOAD_MS);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("prefixType", selectedPrefix);
      if (force) formData.append("force", "true");

      const result = await executeAsync(formData);

      clearTimeout(slowTimerRef.current);
      setShowSlow(false);

      if (result?.serverError) {
        const err = result.serverError as AppError;
        setErrorMessage(err.message ?? t("documents.upload.failed"));
        setState("error");
        onError?.(err);
        return;
      }

      if (result?.data?.error) {
        setErrorMessage(result.data.error.message);
        setState("error");
        onError?.(result.data.error);
        return;
      }

      const data = result?.data?.data;
      if (data?.kind === "duplicate") {
        // the same bytes are already here (specs/documents US2): nothing was stored — the owner decides
        setDuplicateOf(data.existing);
        setState("duplicate");
        return;
      }
      if (data?.kind === "stored") {
        setUploadedDoc(data);
        setState("complete");
        onUploadComplete?.(data);
      }
    },
    [executeAsync, selectedPrefix, onUploadComplete, onError, t],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setState((s) => (s === "uploading" ? s : "dragover"));
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setState((s) => (s === "uploading" ? s : "idle"));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const files = e.dataTransfer.files;
      if (files.length > 1) {
        toast.info(t("documents.upload.oneFile"));
      }
      if (files.length > 0) {
        handleUpload(files[0]);
      }
    },
    [handleUpload, t],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleUpload(file);
      }
      // Reset input so same file can be re-selected
      if (inputRef.current) inputRef.current.value = "";
    },
    [handleUpload],
  );

  const handleClick = useCallback(() => {
    if (state === "uploading") return;
    inputRef.current?.click();
  }, [state]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  const handleReset = useCallback(() => {
    setState("idle");
    setUploadedDoc(null);
    setDuplicateOf(null);
    setErrorMessage("");
    fileRef.current = null;
  }, []);

  const handleUploadAnyway = useCallback(() => {
    if (fileRef.current) handleUpload(fileRef.current, true);
  }, [handleUpload]);

  const handleRetry = useCallback(() => {
    if (fileRef.current) {
      handleUpload(fileRef.current);
    } else {
      handleReset();
    }
  }, [handleUpload, handleReset]);

  return (
    <div className="space-y-3">
      {/* Prefix type selector */}
      <div className="flex items-center gap-2">
        <label htmlFor={prefixId} className="text-sm font-medium text-muted-foreground">
          {t("documents.upload.type")}
        </label>
        <select
          id={prefixId}
          value={selectedPrefix}
          onChange={(e) => setSelectedPrefix(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          disabled={state === "uploading"}
        >
          {prefixOptions.map((opt) => (
            <option key={opt.documentType} value={opt.documentType}>
              {opt.documentType} ({opt.prefix})
            </option>
          ))}
        </select>
      </div>

      {/* Drop zone — div with role="button" is needed for drag-and-drop support */}
      {/* biome-ignore lint/a11y/useSemanticElements: drop zone requires div for drag-and-drop, button element doesn't support it */}
      <div
        role="button"
        tabIndex={0}
        aria-label={t("documents.upload.zone")}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer",
          state === "idle" && "border-muted-foreground/25 hover:border-muted-foreground/50",
          state === "dragover" && "border-primary bg-primary/5",
          state === "uploading" && "border-muted-foreground/25 cursor-wait",
          state === "complete" && "border-state-done/60",
          state === "duplicate" && "border-state-attention/70 cursor-default",
          state === "error" && "border-destructive/50 bg-destructive/5",
        )}
      >
        {state === "idle" && (
          <>
            <Upload className="mb-2 size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {isTouchDevice ? t("documents.upload.tap") : t("documents.upload.drop")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("documents.upload.hint", { max: MAX_FILE_SIZE_MB })}
            </p>
          </>
        )}

        {state === "dragover" && (
          <>
            <Upload className="mb-2 size-8 text-primary" />
            <p className="text-sm font-medium text-primary">{t("documents.upload.release")}</p>
          </>
        )}

        {state === "uploading" && (
          <>
            <Loader2 className="mb-2 size-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {showSlow ? t("documents.upload.stillUploading") : t("documents.upload.uploading")}
            </p>
          </>
        )}

        {state === "complete" && uploadedDoc && (
          <>
            <CheckCircle className="mb-2 size-8 text-state-done" />
            <p className="text-sm font-medium">{uploadedDoc.fileName}</p>
            <p className="text-xs text-muted-foreground">{uploadedDoc.businessKey}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={(e) => {
                e.stopPropagation();
                handleReset();
              }}
            >
              {t("documents.upload.another")}
            </Button>
          </>
        )}

        {state === "duplicate" && duplicateOf && (
          // biome-ignore lint/a11y/noStaticElementInteractions: the card's clicks must not reopen the file picker
          <div
            className="flex flex-col items-center text-center"
            data-testid="upload-duplicate"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Copy className="mb-2 size-8 text-state-attention" />
            <p className="text-sm font-medium">{t("documents.upload.duplicate.title")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("documents.upload.duplicate.body")}
            </p>
            <p className="mt-2 text-sm">
              <CodeChip>
                <span data-testid="upload-duplicate-key">{duplicateOf.businessKey}</span>
              </CodeChip>
              <span className="text-muted-foreground"> · {duplicateOf.fileName}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {duplicateOf.uploadedByName
                ? t("documents.upload.duplicate.uploadedBy", {
                    date: new Date(duplicateOf.createdAt).toISOString().slice(0, 10),
                    name: duplicateOf.uploadedByName,
                  })
                : t("documents.upload.duplicate.uploaded", {
                    date: new Date(duplicateOf.createdAt).toISOString().slice(0, 10),
                  })}
              {duplicateOf.became && (
                <>
                  {" · "}
                  <span data-testid="upload-duplicate-became">
                    {t(
                      duplicateOf.became.type === "expense"
                        ? "documents.upload.duplicate.becameExpense"
                        : "documents.upload.duplicate.becameSupplierInvoice",
                      { key: duplicateOf.became.key ?? "" },
                    )}
                  </span>
                </>
              )}
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" render={<Link href={`/documents/${duplicateOf.id}`} />}>
                {t("documents.upload.duplicate.useExisting")}
              </Button>
              <Button variant="outline" size="sm" onClick={handleUploadAnyway}>
                {t("documents.upload.duplicate.uploadAnyway")}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleReset}>
                {t("documents.upload.another")}
              </Button>
            </div>
          </div>
        )}

        {state === "error" && (
          <>
            <AlertCircle className="mb-2 size-8 text-destructive" />
            <p className="text-sm text-destructive">{errorMessage}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={(e) => {
                e.stopPropagation();
                handleRetry();
              }}
            >
              {t("documents.upload.retry")}
            </Button>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
}
