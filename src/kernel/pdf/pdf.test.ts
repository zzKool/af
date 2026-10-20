// Real Chromium when one is available (CHROMIUM_PATH, a system Chrome, or Playwright's browser);
// skipped otherwise — the Docker image always has one (Dockerfile runner stage).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromiumExecutablePath, renderHtmlToPdf, renderPathToPdf } from "./pdf";
import { PRINT_TOKEN_PARAM, verifyPrintToken } from "./print-token";

const executable = chromiumExecutablePath();

const PAGE = (body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 15mm; }
  body { font-family: sans-serif; }
  .break { break-before: page; }
</style></head><body>${body}</body></html>`;

function pageCount(pdf: Buffer): number {
  const m = pdf.toString("latin1").match(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/);
  return m ? Number(m[1]) : -1;
}

describe.skipIf(!executable)("kernel/pdf (Chromium)", () => {
  let server: Server;
  let base: string;
  const PATH = "/print/invoice/00000000-0000-4000-8000-000000000001";
  const requests: string[] = [];

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-for-pdf-tests-at-least-32-chars";
    // A stand-in for a Next.js print page: verifies the print token, serves HTML or 404.
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      requests.push(url.pathname);
      const payload = verifyPrintToken(url.searchParams.get(PRINT_TOKEN_PARAM), url.pathname);
      if (!payload || url.pathname !== PATH) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        PAGE(
          `<h1>Invoice VA26-INV-001</h1><p>tenant ${payload.tenantId} / user ${payload.userId}</p>`,
        ),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.INTERNAL_BASE_URL = base;
  });

  afterAll(async () => {
    delete process.env.INTERNAL_BASE_URL;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("renders inline HTML to an A4 PDF, honouring CSS page breaks", async () => {
    const pdf = await renderHtmlToPdf(PAGE("<h1>Page one</h1><div class='break'>Page two</div>"));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1_000);
    expect(pageCount(pdf)).toBe(2);
  }, 60_000);

  it("renders a print route as the caller: a token bound to the path opens it", async () => {
    const pdf = await renderPathToPdf(PATH, { tenantId: "tenant-1", userId: "user-1" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pageCount(pdf)).toBe(1);
    expect(requests).toContain(PATH);
  }, 60_000);

  it("fails loudly when the print page answers an error (404 for an unknown document)", async () => {
    await expect(
      renderPathToPdf(
        "/print/invoice/missing",
        { tenantId: "t", userId: "u" },
        { timeoutMs: 15_000 },
      ),
    ).rejects.toThrow(/answered 404/);
  }, 60_000);

  it("a request without a valid print token is refused by the page", async () => {
    // The stand-in behaves like requirePrintCaller(): no token → 404 → the renderer throws.
    const previous = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "a-different-secret-than-the-page-verifies-with";
    const mintedElsewhere = renderPathToPdf(
      PATH,
      { tenantId: "t", userId: "u" },
      { timeoutMs: 15_000 },
    );
    process.env.AUTH_SECRET = previous;
    await expect(mintedElsewhere).rejects.toThrow(/answered 404/);
  }, 60_000);

  it("refuses to render anything outside /print/", async () => {
    await expect(renderPathToPdf("/dashboard", { tenantId: "t", userId: "u" })).rejects.toThrow(
      /Not a print route/,
    );
  });
});

describe("chromiumExecutablePath", () => {
  it("returns null when CHROMIUM_PATH points nowhere", () => {
    const previous = process.env.CHROMIUM_PATH;
    process.env.CHROMIUM_PATH = "/nonexistent/chrome";
    expect(chromiumExecutablePath()).toBeNull();
    if (previous === undefined) delete process.env.CHROMIUM_PATH;
    else process.env.CHROMIUM_PATH = previous;
  });
});
