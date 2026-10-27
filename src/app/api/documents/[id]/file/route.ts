import { NextResponse } from "next/server";
import { getCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import { createStorageService } from "@/kernel/storage/storage";
import { uuid } from "@/kernel/validation/scalars";
import * as documents from "@/modules/documents";

// The one way a document's bytes reach a browser (F106, D61): the session's caller → the documents module says
// which bytes it may have (RLS + the accountant's financial-only rule) → the storage adapter streams them.
// `?download=1` saves instead of showing. Private, never cached. No SAS URL, no proxy of arbitrary URLs.
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!uuid.safeParse(id).success)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const file = await withTenantTransaction(prisma, caller.tenantId, (tx) =>
    documents.documentFile(tx, caller, id),
  );
  if (file.error) {
    const status = file.error.code === "FORBIDDEN" ? 403 : 404;
    return NextResponse.json({ error: file.error.message }, { status });
  }

  const bytes = await createStorageService().downloadBlob(file.data.blobPath);
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": file.data.mimeType,
      "content-length": String(bytes.length),
      "content-disposition": documents.contentDisposition(file.data.fileName, download),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
