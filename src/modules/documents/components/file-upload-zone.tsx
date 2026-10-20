"use client";

import { AlertCircle, CheckCircle, Loader2, Upload } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { AppError } from "@/kernel/errors/app-error";
import { MAX_FILE_SIZE_MB } from "@/kernel/nav/constants";
import { cn } from "@/lib/utils";
import { uploadDocumentAction } from "@/modules/documents/documents.actions";

const ACCEPTED_EXTENSIONS = ".pdf,.jpg,.jpeg,.png,.tiff,.tif";
const SLOW_UPLOAD_MS = 3000;

type PrefixOption = { documentType: string; prefix: string };

type FileUploadZoneProps = {
  prefixOptions: PrefixOption[];
  onUploadComplete?: (doc: { id: string; businessKey: string; fileName: string }) => void;
  onError?: (error: AppError) => void;
};

type UploadState = "idle" | "dragover" | "uploading" | "complete" | "error";

export function FileUploadZone({ prefixOptions, onUploadComplete, onError }: FileUploadZoneProps) {
  const [state, setState] = useState<UploadState>("idle");
  const [selectedPrefix, setSelectedPrefix] = useState(prefixOptions[0]?.documentType ?? "");
  const [uploadedDoc, setUploadedDoc] = useState<{
    id: string;
    businessKey: string;
    fileName: string;
  } | null>(null);
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
    async (file: File) => {
      // Client-side pre-validation
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setErrorMessage(`File exceeds ${MAX_FILE_SIZE_MB} MB limit`);
        setState("error");
        return;
      }

      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const validExts = ["pdf", "jpg", "jpeg", "png", "tiff", "tif"];
      if (!validExts.includes(ext)) {
        setErrorMessage("Unsupported file type. Accepted: PDF, JPEG, PNG, TIFF");
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

      const result = await executeAsync(formData);

      clearTimeout(slowTimerRef.current);
      setShowSlow(false);

      if (result?.serverError) {
        const err = result.serverError as AppError;
        setErrorMessage(err.message ?? "Upload failed");
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

      if (result?.data?.data) {
        const doc = result.data.data;
        setUploadedDoc(doc);
        setState("complete");
        onUploadComplete?.(doc);
      }
    },
    [executeAsync, selectedPrefix, onUploadComplete, onError],
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
        toast.info("One file at a time");
      }
      if (files.length > 0) {
        handleUpload(files[0]);
      }
    },
    [handleUpload],
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
    setErrorMessage("");
    fileRef.current = null;
  }, []);

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
        <label htmlFor="prefix-type" className="text-sm font-medium text-muted-foreground">
          Document type
        </label>
        <select
          id="prefix-type"
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
        aria-label="Upload document"
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
          state === "complete" && "border-green-500/50 bg-green-50 dark:bg-green-950/20",
          state === "error" && "border-destructive/50 bg-destructive/5",
        )}
      >
        {state === "idle" && (
          <>
            <Upload className="mb-2 size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {isTouchDevice ? "Tap to upload" : "Drop file here or click to browse"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              PDF, JPEG, PNG, TIFF — max {MAX_FILE_SIZE_MB} MB
            </p>
          </>
        )}

        {state === "dragover" && (
          <>
            <Upload className="mb-2 size-8 text-primary" />
            <p className="text-sm font-medium text-primary">Release to upload</p>
          </>
        )}

        {state === "uploading" && (
          <>
            <Loader2 className="mb-2 size-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {showSlow ? "Still uploading..." : "Uploading..."}
            </p>
          </>
        )}

        {state === "complete" && uploadedDoc && (
          <>
            <CheckCircle className="mb-2 size-8 text-green-600 dark:text-green-400" />
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
              Upload another
            </Button>
          </>
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
              Try again
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
