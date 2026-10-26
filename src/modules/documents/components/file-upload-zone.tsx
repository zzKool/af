"use client";

import { AlertCircle, CheckCircle, Copy, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { AppError } from "@/kernel/errors/app-error";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { MAX_FILE_SIZE_MB } from "@/kernel/nav/constants";
import { CodeChip } from "@/kernel/ui/tags";
import { cn } from "@/lib/utils";
import type { DuplicateUploadRef } from "@/modules/documents/documents";
import { uploadDocumentAction } from "@/modules/documents/documents.actions";
import {
  ACCEPTED_UPLOAD_EXTENSIONS,
  type BatchItemStatus,
  countOutcomes,
  MAX_UPLOAD_BATCH_FILES,
  outcomeOf,
  precheckUpload,
  runUploadBatch,
  type UploadActionResult,
  type UploadBatchItem,
  type UploadOutcome,
} from "@/modules/documents/upload-batch";
import { UploadBatchList } from "./upload-batch-list";

const ACCEPTED_EXTENSIONS = ACCEPTED_UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(",");
const SLOW_UPLOAD_MS = 3000;

type PrefixOption = { documentType: string; prefix: string };

type FileUploadZoneProps = {
  prefixOptions: PrefixOption[];
  onUploadComplete?: (doc: { id: string; businessKey: string; fileName: string }) => void;
  /** F92: once a batch of several files is through (and after a row's retry) — the parent refreshes once */
  onBatchComplete?: () => void;
  onError?: (error: AppError) => void;
};

type UploadState = "idle" | "dragover" | "uploading" | "complete" | "duplicate" | "error" | "batch";

export function FileUploadZone({
  prefixOptions,
  onUploadComplete,
  onBatchComplete,
  onError,
}: FileUploadZoneProps) {
  const t = useT();
  // unique: the zone renders twice when + New opens the upload dialog over the library (F73)
  const prefixId = useId();
  const [state, setState] = useState<UploadState>("idle");
  // no default (D52): the type picks the OCR model and the key's prefix — the owner chooses it before the upload
  const [selectedPrefix, setSelectedPrefix] = useState("");
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
  const typeRef = useRef<HTMLSelectElement>(null);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // F92: several files, one type — the rows of the result list, and whether the batch is still going
  const [batch, setBatch] = useState<UploadBatchItem[] | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const batchTypeRef = useRef("");
  const busyRef = useRef(false);

  const { executeAsync } = useAction(uploadDocumentAction);

  /** The one upload path: one file, one action call — a batch is this, once per file. */
  const postOne = useCallback(
    async (file: File, prefixType: string, force = false): Promise<UploadOutcome> => {
      const problem = precheckUpload(file, MAX_FILE_SIZE_MB);
      if (problem === "tooLarge") {
        return { kind: "failed", reason: `File exceeds ${MAX_FILE_SIZE_MB} MB limit` };
      }
      if (problem === "unsupported") {
        return { kind: "failed", reason: t("documents.upload.unsupported") };
      }
      const formData = new FormData();
      formData.append("file", file);
      formData.append("prefixType", prefixType);
      if (force) formData.append("force", "true");
      const result = await executeAsync(formData);
      return outcomeOf(result as UploadActionResult, t("documents.upload.failed"));
    },
    [executeAsync, t],
  );

  useEffect(() => {
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  const askForType = useCallback(() => {
    setState("idle");
    toast.info(t("documents.upload.chooseType"));
    typeRef.current?.focus();
  }, [t]);

  const handleUpload = useCallback(
    async (file: File, force = false) => {
      if (!selectedPrefix) {
        askForType();
        return;
      }
      // Client-side pre-validation: nothing is posted for a file the server would refuse anyway
      const problem = precheckUpload(file, MAX_FILE_SIZE_MB);
      if (problem) {
        setErrorMessage(
          problem === "tooLarge"
            ? `File exceeds ${MAX_FILE_SIZE_MB} MB limit`
            : t("documents.upload.unsupported"),
        );
        setState("error");
        return;
      }

      fileRef.current = file;
      busyRef.current = true;
      setBatch(null);
      setState("uploading");
      setShowSlow(false);

      slowTimerRef.current = setTimeout(() => setShowSlow(true), SLOW_UPLOAD_MS);
      const outcome = await postOne(file, selectedPrefix, force);
      clearTimeout(slowTimerRef.current);
      setShowSlow(false);
      busyRef.current = false;

      if (outcome.kind === "failed") {
        setErrorMessage(outcome.reason);
        setState("error");
        if (outcome.error) onError?.(outcome.error);
        return;
      }
      if (outcome.kind === "duplicate") {
        // the same bytes are already here (specs/documents US2): nothing was stored — the owner decides
        setDuplicateOf(outcome.existing);
        setState("duplicate");
        return;
      }
      setUploadedDoc(outcome.doc);
      setState("complete");
      onUploadComplete?.(outcome.doc);
    },
    [postOne, selectedPrefix, askForType, onUploadComplete, onError, t],
  );

  const setBatchItem = useCallback(
    (index: number, status: BatchItemStatus, outcome?: UploadOutcome) =>
      setBatch((prev) =>
        prev ? prev.map((it, j) => (j === index ? { ...it, status, outcome } : it)) : prev,
      ),
    [],
  );

  /** F92: several files at once — the type chosen once, each file through `postOne`, one row each. */
  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      if (!selectedPrefix) {
        askForType();
        return;
      }
      if (files.length === 1) {
        handleUpload(files[0]);
        return;
      }
      if (files.length > MAX_UPLOAD_BATCH_FILES) {
        setState(batch ? "batch" : "idle");
        toast.info(t("documents.upload.tooMany", { max: MAX_UPLOAD_BATCH_FILES }));
        return;
      }
      const prefixType = selectedPrefix;
      batchTypeRef.current = prefixType;
      busyRef.current = true;
      setUploadedDoc(null);
      setDuplicateOf(null);
      setErrorMessage("");
      setBatch(files.map((file) => ({ file, status: "queued" as const })));
      setBatchRunning(true);
      setState("batch");

      const outcomes = await runUploadBatch(
        files,
        (file) => postOne(file, prefixType),
        setBatchItem,
        t("documents.upload.failed"),
      );

      busyRef.current = false;
      setBatchRunning(false);
      // the inbox count and the sidebar badge are server-rendered: one refresh for the whole batch
      if (outcomes.some((o) => o.kind === "uploaded")) onBatchComplete?.();
    },
    [selectedPrefix, askForType, handleUpload, batch, postOne, setBatchItem, onBatchComplete, t],
  );

  /** A row's second chance: *Try again* on a failed file, *Upload anyway* (force) on a duplicate. */
  const retryBatchItem = useCallback(
    async (index: number, force: boolean) => {
      const item = batch?.[index];
      if (!item || busyRef.current) return;
      busyRef.current = true;
      setBatchRunning(true);
      setBatchItem(index, "uploading");
      let outcome: UploadOutcome;
      try {
        outcome = await postOne(item.file, batchTypeRef.current, force);
      } catch (error) {
        outcome = {
          kind: "failed",
          reason: error instanceof Error ? error.message : t("documents.upload.failed"),
        };
      }
      setBatchItem(index, outcome.kind, outcome);
      busyRef.current = false;
      setBatchRunning(false);
      if (outcome.kind === "uploaded") onBatchComplete?.();
    },
    [batch, postOne, setBatchItem, onBatchComplete, t],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busyRef.current) return;
    setState("dragover");
  }, []);

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (busyRef.current) return;
      setState(batch ? "batch" : "idle");
    },
    [batch],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (busyRef.current) return;
      handleFiles(Array.from(e.dataTransfer.files ?? []));
    },
    [handleFiles],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      // Reset input so same file can be re-selected
      if (inputRef.current) inputRef.current.value = "";
      handleFiles(files);
    },
    [handleFiles],
  );

  const handleClick = useCallback(() => {
    if (state === "uploading" || busyRef.current) return;
    if (!selectedPrefix) {
      askForType();
      return;
    }
    inputRef.current?.click();
  }, [state, selectedPrefix, askForType]);

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
    setBatch(null);
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
          ref={typeRef}
          value={selectedPrefix}
          onChange={(e) => setSelectedPrefix(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          disabled={state === "uploading" || batchRunning}
          required
          data-testid="upload-type"
        >
          <option value="" disabled>
            {t("documents.upload.typePlaceholder")}
          </option>
          {prefixOptions.map((opt) => (
            <option key={opt.documentType} value={opt.documentType}>
              {t(`documents.prefix.${opt.documentType}` as MessageKey)} ({opt.prefix})
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
          state === "batch" && "border-muted-foreground/25",
          state === "batch" && batchRunning && "cursor-wait",
        )}
      >
        {state === "idle" && (
          <>
            <Upload className="mb-2 size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {isTouchDevice ? t("documents.upload.tap") : t("documents.upload.drop")}
            </p>
            {!selectedPrefix && (
              <p className="mt-1 text-xs text-foreground" data-testid="upload-choose-type">
                {t("documents.upload.chooseType")}
              </p>
            )}
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

        {state === "batch" && batch && (
          <>
            {batchRunning ? (
              <Loader2 className="mb-2 size-8 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="mb-2 size-8 text-muted-foreground" />
            )}
            <p className="text-sm text-muted-foreground" data-testid="upload-batch-progress">
              {batchRunning
                ? t("documents.upload.batch.progress", {
                    done: countOutcomes(batch.map((it) => it.status)).done,
                    total: batch.length,
                  })
                : isTouchDevice
                  ? t("documents.upload.tap")
                  : t("documents.upload.drop")}
            </p>
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
              {t("documents.upload.retry")}
            </Button>
          </>
        )}
      </div>

      {state === "batch" && batch && (
        <UploadBatchList
          items={batch}
          running={batchRunning}
          onRetry={(i) => retryBatchItem(i, false)}
          onUploadAnyway={(i) => retryBatchItem(i, true)}
          onReset={handleReset}
        />
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
}
