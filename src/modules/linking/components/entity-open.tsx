"use client";

// Open what a link or a suggestion points at without leaving the row (the owner, 2026-11-09: "when I upload a
// document I cannot open it from there" · "you suggest a document but I have no idea if it is the right one"):
// a document opens in a preview dialog (the file as the browser shows it — PDF or image — through the one file
// route, F106, shown by the documents module's viewer — the review page's), with its page and its download one
// click away; anything else opens its own page in a new tab.
import { Eye, SquareArrowOutUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/kernel/i18n/use-t";
import { DocumentViewer } from "@/modules/documents/ui";
import { entityHref } from "../hrefs";
import type { LinkableType } from "../types";

export function EntityOpen({ type, id, label }: { type: LinkableType; id: string; label: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const page = entityHref({ type, id, label });
  if (type !== "document")
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        nativeButton={false}
        render={<a href={page} target="_blank" rel="noopener" />}
        aria-label={t("linking.open.page", { label })}
        title={t("linking.open.page", { label })}
        data-testid="entity-open"
      >
        <SquareArrowOutUpRight />
      </Button>
    );
  const file = `/api/documents/${id}/file`;
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label={t("linking.open.preview", { label })}
        title={t("linking.open.preview", { label })}
        data-testid="document-preview-open"
      >
        <Eye />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex h-[90dvh] flex-col sm:max-w-4xl"
          data-testid="document-preview"
        >
          <DialogHeader>
            <DialogTitle className="truncate pr-8">{label}</DialogTitle>
            <DialogDescription className="flex flex-wrap gap-x-4">
              <a href={page} className="text-primary hover:underline">
                {t("linking.open.documentPage")}
              </a>
              <a href={`${file}?download=1`} className="text-primary hover:underline">
                {t("linking.open.download")}
              </a>
            </DialogDescription>
          </DialogHeader>
          {open && <Preview file={file} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** the file once, through the one route: its type picks the viewer (PDF pages or an image) */
function Preview({ file }: { file: string }) {
  const t = useT();
  const [loaded, setLoaded] = useState<{ url: string; mime: string } | "failed" | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    void fetch(file)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const blob = await r.blob();
        url = URL.createObjectURL(blob);
        if (live) setLoaded({ url, mime: blob.type || r.headers.get("content-type") || "" });
      })
      .catch(() => live && setLoaded("failed"));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);
  if (loaded === "failed")
    return <p className="text-[13px] text-muted-foreground">{t("linking.open.failed")}</p>;
  if (!loaded) return <div className="min-h-48 flex-1 animate-pulse rounded-lg bg-muted" />;
  return (
    <div className="min-h-0 flex-1 overflow-auto" data-testid="document-preview-file">
      <DocumentViewer fileUrl={loaded.url} mimeType={loaded.mime} />
    </div>
  );
}
