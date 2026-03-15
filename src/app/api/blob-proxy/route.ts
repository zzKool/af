import { type NextRequest, NextResponse } from "next/server";

/**
 * Proxies blob requests to Azure Storage / Azurite to avoid CORS issues.
 *
 * Usage: GET /api/blob-proxy?url=<signed-blob-url>
 *
 * Only used in local dev where the browser can't directly fetch from
 * Azurite (127.0.0.1:10000) due to cross-origin restrictions.
 * In production, blobs are served directly via SAS URLs.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // Only proxy requests to known blob storage hosts
  const parsed = new URL(url);
  const isAzurite = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  const isAzureBlob = parsed.hostname.endsWith(".blob.core.windows.net");

  if (!isAzurite && !isAzureBlob) {
    return NextResponse.json({ error: "Invalid blob host" }, { status: 403 });
  }

  const response = await fetch(url);
  if (!response.ok) {
    return NextResponse.json(
      { error: `Blob fetch failed: ${response.status}` },
      { status: response.status },
    );
  }

  const blob = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";

  return new NextResponse(blob, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=60",
    },
  });
}
