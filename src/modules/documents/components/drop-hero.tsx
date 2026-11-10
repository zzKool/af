"use client";

// *Drop anything here* (F185, the board *Documents*): the desk's hero is the drop target — PDFs, phone photos,
// several at once; no type to pick (D78), the app reads each file and proposes what it becomes. On its right one
// tile per file in flight: its name (mono), how far it is, a thin bar and the step in words — *uploading*, *queued
// to be read*, *reading the page* — first the files this page is sending (one upload action per file, the duplicate
// check answered on the tile: *Upload anyway*), then the inbox's documents still being read. When nothing is in
// flight the tile is the button that opens the file picker. `?new=1` (+ New → Upload document) opens the upload
// zone in a dialog, as before. (The mail-forward address of the board waits for a mailbox, F103.)
import { Upload, X } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import { MAX_FILE_SIZE_MB } from "@/kernel/nav/constants";
import { useNewParam } from "@/kernel/ui/shell/use-new-param";
import { cn } from "@/lib/utils";
import { uploadDocumentAction } from "@/modules/documents/documents.actions";
import type { InboxItem } from "@/modules/documents/queries";
import {
  ACCEPTED_UPLOAD_EXTENSIONS,
  MAX_UPLOAD_BATCH_FILES,
  outcomeOf,
  precheckUpload,
  type UploadActionResult,
  type UploadOutcome,
} from "@/modules/documents/upload-batch";
import { UploadDocumentDialog } from "./upload-document-dialog";

const ACCEPTED = ACCEPTED_UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(",");
/** a drop nobody typed (D78) */
const UNTYPED = "document";
const SHOWN = 4;

type Sending = {
  seq: number;
  file: File;
  status: "queued" | "uploading" | UploadOutcome["kind"];
  outcome?: UploadOutcome;
};

export type FlightTile = {
  id: string;
  name: string;
  pct: number;
  step: string;
  tone: "progress" | "attention" | "danger";
  action?: { label: string; run: () => void };
  dismiss?: () => void;
};

export function DropHero({
  pending,
  knownIds,
  onUploaded,
  canUpload,
}: {
  /** the inbox's documents still being read (needs OCR, processing, stuck) */
  pending: InboxItem[];
  /** every document the inbox shows — a sent file leaves the hero once its row is there */
  knownIds: ReadonlySet<string>;
  /** a file is stored: the host reloads its inbox */
  onUploaded: () => void;
  canUpload: boolean;
}) {
  const t = useT();
  const [uploadOpen, setUploadOpen] = useNewParam(canUpload);
  const [sending, setSending] = useState<Sending[]>([]);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const running = useRef(false);
  const queue = useRef<{ seq: number; force: boolean }[]>([]);
  const { executeAsync } = useAction(uploadDocumentAction);

  const update = useCallback(
    (s: number, patch: Partial<Sending>) =>
      setSending((list) => list.map((it) => (it.seq === s ? { ...it, ...patch } : it))),
    [],
  );

  const pump = useCallback(
    async (files: Map<number, File>) => {
      if (running.current) return;
      running.current = true;
      while (queue.current.length > 0) {
        const next = queue.current.shift();
        const file = next ? files.get(next.seq) : undefined;
        if (!next || !file) continue;
        update(next.seq, { status: "uploading" });
        const form = new FormData();
        form.append("file", file);
        form.append("prefixType", UNTYPED);
        if (next.force) form.append("force", "true");
        let outcome: UploadOutcome;
        try {
          outcome = outcomeOf(
            (await executeAsync(form)) as UploadActionResult,
            t("documents.upload.failed"),
          );
        } catch (e) {
          outcome = {
            kind: "failed",
            reason: e instanceof Error ? e.message : t("documents.upload.failed"),
          };
        }
        update(next.seq, { status: outcome.kind, outcome });
        if (outcome.kind === "uploaded") onUploaded();
      }
      running.current = false;
    },
    [executeAsync, onUploaded, t, update],
  );

  const files = useRef(new Map<number, File>());
  const send = useCallback(
    (list: File[]) => {
      if (list.length === 0) return;
      if (list.length > MAX_UPLOAD_BATCH_FILES) {
        toast.info(t("documents.upload.tooMany", { max: MAX_UPLOAD_BATCH_FILES }));
        return;
      }
      const added: Sending[] = [];
      for (const file of list) {
        const s = ++seq.current;
        const problem = precheckUpload(file, MAX_FILE_SIZE_MB);
        if (problem) {
          added.push({
            seq: s,
            file,
            status: "failed",
            outcome: {
              kind: "failed",
              reason:
                problem === "tooLarge"
                  ? t("documents.upload.tooLarge", { max: MAX_FILE_SIZE_MB })
                  : t("documents.upload.unsupported"),
            },
          });
          continue;
        }
        files.current.set(s, file);
        queue.current.push({ seq: s, force: false });
        added.push({ seq: s, file, status: "queued" });
      }
      setSending((prev) => [...prev, ...added]);
      void pump(files.current);
    },
    [pump, t],
  );

  const again = (s: number, force: boolean) => {
    update(s, { status: "queued", outcome: undefined });
    queue.current.push({ seq: s, force });
    void pump(files.current);
  };
  const drop = (s: number) => setSending((list) => list.filter((it) => it.seq !== s));

  // the tiles: what this page sends, then what the inbox is reading
  const tiles: FlightTile[] = [];
  for (const it of sending) {
    const o = it.outcome;
    if (o?.kind === "uploaded" && knownIds.has(o.doc.id)) continue;
    const base = { id: `send-${it.seq}`, name: it.file.name };
    if (it.status === "queued")
      tiles.push({ ...base, pct: 0, step: t("documents.flight.waiting"), tone: "progress" });
    else if (it.status === "uploading")
      tiles.push({ ...base, pct: 30, step: t("documents.flight.uploading"), tone: "progress" });
    else if (o?.kind === "uploaded")
      tiles.push({ ...base, pct: 45, step: t("documents.flight.queued"), tone: "progress" });
    else if (o?.kind === "duplicate")
      tiles.push({
        ...base,
        pct: 100,
        step: t("documents.flight.duplicate", { key: o.existing.businessKey }),
        tone: "attention",
        action: {
          label: t("documents.upload.duplicate.uploadAnyway"),
          run: () => again(it.seq, true),
        },
        dismiss: () => drop(it.seq),
      });
    else if (o?.kind === "failed")
      tiles.push({
        ...base,
        pct: 100,
        step: o.reason,
        tone: "danger",
        action: files.current.has(it.seq)
          ? { label: t("documents.upload.retry"), run: () => again(it.seq, false) }
          : undefined,
        dismiss: () => drop(it.seq),
      });
  }
  for (const r of pending)
    tiles.push({
      id: r.id,
      name: r.fileName,
      pct: r.state === "needs_ocr" ? 45 : 75,
      step: t(
        r.state === "needs_ocr"
          ? "documents.flight.queued"
          : r.state === "stuck"
            ? "documents.flight.stuck"
            : "documents.flight.reading",
      ),
      tone: r.state === "stuck" ? "attention" : "progress",
    });
  const shown = tiles.slice(0, SHOWN);
  const more = tiles.length - shown.length;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the whole hero takes a drop; the tile below is the button that opens the picker
    <section
      className={cn(
        "flex flex-wrap items-center gap-[18px] rounded-[20px] border border-dashed px-5 py-[18px] pulse-card",
        over ? "border-read bg-read/6" : "border-read/35",
      )}
      data-testid="drop-hero"
      onDragOver={(e) => {
        if (!canUpload) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!canUpload) return;
        e.preventDefault();
        setOver(false);
        send(Array.from(e.dataTransfer.files ?? []));
      }}
    >
      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-1">
        <h2 className="m-0 text-[26px] leading-tight font-semibold tracking-[-0.02em]">
          {t("documents.desk.dropTitle")}
        </h2>
        <p className="text-muted-foreground">{t("documents.desk.dropText")}</p>
      </div>
      {shown.map((f) => (
        <FlightTileView key={f.id} tile={f} />
      ))}
      {more > 0 && (
        <span className="text-xs text-muted-foreground" data-public>
          {t("documents.flight.more", { count: more })}
        </span>
      )}
      {canUpload && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex min-w-0 items-center gap-3 rounded-[14px] border border-dashed border-border bg-surface-2 px-3.5 py-3 text-left outline-none hover:border-read/60 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/40",
            shown.length > 0 ? "flex-none" : "flex-[1_1_220px]",
          )}
          data-testid="drop-pick"
        >
          <Upload className="size-4 shrink-0 text-read" aria-hidden />
          <span className="flex min-w-0 flex-col">
            <span className="text-[13px] font-medium">
              {t(shown.length > 0 ? "documents.flight.addMore" : "documents.flight.choose")}
            </span>
            {shown.length === 0 && (
              <span className="text-[11.5px] text-muted-foreground">
                {t("documents.upload.hint", { max: MAX_FILE_SIZE_MB })}
              </span>
            )}
          </span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED}
        className="hidden"
        data-testid="drop-input"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.target.value = "";
          send(list);
        }}
      />
      {canUpload && (
        <UploadDocumentDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          prefixOptions={[]}
          onUploadComplete={onUploaded}
          onBatchComplete={onUploaded}
        />
      )}
    </section>
  );
}

const BAR = { progress: "bg-read", attention: "bg-state-attention", danger: "bg-destructive" };

function FlightTileView({ tile: f }: { tile: FlightTile }) {
  const t = useT();
  return (
    <div
      className="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5 rounded-[14px] border border-subtle bg-surface-2 px-3.5 py-3"
      data-testid="flight-tile"
      data-tone={f.tone}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f.name}>
          {f.name}
        </span>
        <span className="text-[11.5px] text-muted-foreground" data-public>
          {f.pct}%
        </span>
        {f.dismiss && (
          <button
            type="button"
            onClick={f.dismiss}
            className="rounded-sm text-muted-foreground hover:text-foreground"
            aria-label={t("common.close")}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-subtle" aria-hidden>
        <div
          className={cn(
            "h-full rounded-full",
            BAR[f.tone],
            f.tone === "progress" && "motion-safe:animate-pulse",
          )}
          style={{ width: `${Math.max(f.pct, 6)}%` }}
        />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[11.5px]",
            f.tone === "danger" ? "text-destructive" : "text-muted-foreground",
          )}
          title={f.step}
        >
          {f.step}
        </span>
        {f.action && (
          <Button size="xs" variant="outline" onClick={f.action.run} className="h-6">
            {f.action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
