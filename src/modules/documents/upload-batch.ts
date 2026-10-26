// F92 (D55): several files, one type. A batch is N single uploads run one after the other — each file goes
// through `uploadDocumentAction` exactly as one dropped file does (blob, its own provisional key, the
// content-hash duplicate check, its OCR job). Nothing here talks to the server: the caller passes the
// one-file upload; this file only turns a list of files into a list of per-file outcomes.
//
// Pure and client-safe (no server import beyond types) — `upload-batch.pure.test.ts`.
import type { AppError } from "@/kernel/errors/app-error";
import type { DuplicateUploadRef } from "@/modules/documents/documents";

/** At most this many files in one drop / pick; more is refused as a whole (the owner picks again). */
export const MAX_UPLOAD_BATCH_FILES = 50;

export const ACCEPTED_UPLOAD_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "tiff", "tif"] as const;

export type StoredUpload = { id: string; businessKey: string; fileName: string };

/** What happened to one file — the row of the result list. */
export type UploadOutcome =
  | { kind: "uploaded"; doc: StoredUpload }
  | { kind: "duplicate"; existing: DuplicateUploadRef }
  | { kind: "failed"; reason: string; error?: AppError };

/** A row while the batch runs: waiting, on its way, or done with its outcome. */
export type BatchItemStatus = "queued" | "uploading" | UploadOutcome["kind"];

/** One row of the result list: the file, where it stands, and its outcome once it has one. */
export type UploadBatchItem = { file: File; status: BatchItemStatus; outcome?: UploadOutcome };

/** The client-side check before anything is posted (the server checks the bytes again). */
export type PrecheckProblem = "tooLarge" | "unsupported";

export function precheckUpload(
  file: { name: string; size: number },
  maxSizeMb: number,
): PrecheckProblem | null {
  if (file.size > maxSizeMb * 1024 * 1024) return "tooLarge";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!(ACCEPTED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) return "unsupported";
  return null;
}

/** The shape `uploadDocumentAction` returns through next-safe-action (only what is read here). */
export type UploadActionResult =
  | {
      serverError?: unknown;
      data?: {
        error?: AppError;
        data?:
          | ({ kind: "stored" } & StoredUpload)
          | { kind: "duplicate"; existing: DuplicateUploadRef }
          | null;
      };
    }
  | undefined;

/** One action result → one outcome. Anything that is neither stored nor a duplicate is a failure. */
export function outcomeOf(result: UploadActionResult, fallbackReason: string): UploadOutcome {
  if (result?.serverError) {
    const err = result.serverError as Partial<AppError>;
    return {
      kind: "failed",
      reason: err.message || fallbackReason,
      error: err.code ? (err as AppError) : undefined,
    };
  }
  if (result?.data?.error) {
    return { kind: "failed", reason: result.data.error.message, error: result.data.error };
  }
  const data = result?.data?.data;
  if (data?.kind === "duplicate") return { kind: "duplicate", existing: data.existing };
  if (data?.kind === "stored") {
    return {
      kind: "uploaded",
      doc: { id: data.id, businessKey: data.businessKey, fileName: data.fileName },
    };
  }
  return { kind: "failed", reason: fallbackReason };
}

/**
 * Run the one-file upload over every file, one at a time (Next.js posts server actions one after the
 * other anyway, and the provisional key's series is row-locked per upload). A file that fails — or whose
 * upload throws (network) — becomes a `failed` row and the next file goes on.
 */
export async function runUploadBatch<F>(
  files: readonly F[],
  uploadOne: (file: F) => Promise<UploadOutcome>,
  onProgress: (index: number, status: BatchItemStatus, outcome?: UploadOutcome) => void,
  fallbackReason: string,
): Promise<UploadOutcome[]> {
  const outcomes: UploadOutcome[] = [];
  for (let i = 0; i < files.length; i++) {
    onProgress(i, "uploading");
    let outcome: UploadOutcome;
    try {
      outcome = await uploadOne(files[i]);
    } catch (error) {
      outcome = {
        kind: "failed",
        reason: error instanceof Error && error.message ? error.message : fallbackReason,
      };
    }
    outcomes.push(outcome);
    onProgress(i, outcome.kind, outcome);
  }
  return outcomes;
}

/** The summary line's counts. */
export function countOutcomes(statuses: readonly BatchItemStatus[]): {
  done: number;
  uploaded: number;
  duplicate: number;
  failed: number;
} {
  let uploaded = 0;
  let duplicate = 0;
  let failed = 0;
  for (const s of statuses) {
    if (s === "uploaded") uploaded++;
    else if (s === "duplicate") duplicate++;
    else if (s === "failed") failed++;
  }
  return { done: uploaded + duplicate + failed, uploaded, duplicate, failed };
}
