"use client";

// The desk's hero (F153, the board *Documents*): *Drop anything here* — PDFs, phone photos, several at once; no
// type to pick (D78), the app reads each file and proposes what it becomes. The zone is the kit's upload zone
// (one file or a batch, the duplicate check, the progress per file); when a drop is through, the page reloads
// its inbox below. `?new=1` (+ New → Upload document) opens the same zone in a dialog.
import { useRouter } from "next/navigation";
import { useT } from "@/kernel/i18n/use-t";
import { useNewParam } from "@/kernel/ui/shell/use-new-param";
import { FileUploadZone } from "./file-upload-zone";
import { UploadDocumentDialog } from "./upload-document-dialog";

export function DropHero() {
  const t = useT();
  const router = useRouter();
  // the sidebar's **+ New → Upload document** (F73) lands here with ?new=1: the same zone, in a dialog
  const [uploadOpen, setUploadOpen] = useNewParam(true);
  return (
    <section
      className="grid items-center gap-5 rounded-[20px] border border-dashed border-primary/40 bg-primary/4 p-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]"
      data-testid="drop-hero"
    >
      <div>
        <h2 className="text-[24px] leading-tight font-semibold tracking-tight">
          {t("documents.desk.dropTitle")}
        </h2>
        <p className="mt-2 text-[13px] text-muted-foreground">{t("documents.desk.dropText")}</p>
      </div>
      <FileUploadZone
        compact
        onUploadComplete={() => router.refresh()}
        onBatchComplete={() => router.refresh()}
      />
      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        prefixOptions={[]}
        onUploadComplete={() => router.refresh()}
        onBatchComplete={() => router.refresh()}
      />
    </section>
  );
}
