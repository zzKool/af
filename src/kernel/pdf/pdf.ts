// PDF rendering — Chromium printing a page of this app (constitution §3.6: the PDF is the print mode
// of the same component that renders the editable form; no second template). The only importer of
// playwright-core (guard). Modules provide a `/print/...` route and call renderPathToPdf().
//
// Chromium ships in the image (Dockerfile: apk chromium, CHROMIUM_PATH). Locally, CHROMIUM_PATH or the
// Playwright-installed browser of the e2e suite. A browser is launched per render and closed after —
// invoices are issued a few times a month; a warm pool would be a mechanism for nothing.
import { existsSync } from "node:fs";
import { type Browser, chromium } from "playwright-core";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { logger } from "@/kernel/logging/logger";
import { createPrintToken, PRINT_TOKEN_PARAM } from "./print-token";

export interface PdfOptions {
  format?: "A4" | "Letter";
  landscape?: boolean;
  /** CSS lengths; default 15 mm all round. `@page` rules in the print CSS win when preferCSSPageSize. */
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  /** Whole render budget (navigation + fonts + print). */
  timeoutMs?: number;
}

const DEFAULT_MARGIN = { top: "15mm", right: "15mm", bottom: "15mm", left: "15mm" };
const DEFAULT_TIMEOUT_MS = 30_000;

const CANDIDATE_PATHS = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
];

/** The Chromium executable this environment has, or null — tests skip, renders fail with a clear error. */
export function chromiumExecutablePath(): string | null {
  const fromEnv = process.env.CHROMIUM_PATH;
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  for (const p of CANDIDATE_PATHS) if (existsSync(p)) return p;
  try {
    const p = chromium.executablePath();
    if (existsSync(p)) return p;
  } catch {
    // playwright-core without a downloaded browser
  }
  return null;
}

/** Where Chromium reaches this app from inside the container. */
export function internalBaseUrl(): string {
  return (
    process.env.INTERNAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`
  ).replace(/\/$/, "");
}

async function launch(): Promise<Browser> {
  const executablePath = chromiumExecutablePath();
  if (!executablePath) {
    throw new Error(
      "No Chromium found: set CHROMIUM_PATH (the image installs it at /usr/bin/chromium-browser)",
    );
  }
  return chromium.launch({
    executablePath,
    headless: true,
    // Containers run as a non-root user without user namespaces; the pages are our own.
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--font-render-hinting=none",
    ],
  });
}

async function withPage<T>(
  timeoutMs: number,
  fn: (page: import("playwright-core").Page) => Promise<T>,
): Promise<T> {
  const browser = await launch();
  try {
    const context = await browser.newContext({ locale: "sv-SE", deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

function pdfSettings(options: PdfOptions) {
  return {
    format: options.format ?? "A4",
    landscape: options.landscape ?? false,
    margin: { ...DEFAULT_MARGIN, ...options.margin },
    printBackground: true,
    preferCSSPageSize: true,
  } as const;
}

/** Render a self-contained HTML document (inline CSS, no app routes). For statements, tests, fixtures. */
export async function renderHtmlToPdf(html: string, options: PdfOptions = {}): Promise<Buffer> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return withPage(timeoutMs, async (page) => {
    await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
    await page.emulateMedia({ media: "print" });
    const started = Date.now();
    const pdf = await page.pdf(pdfSettings(options));
    logger.info({ bytes: pdf.length, durationMs: Date.now() - started }, "pdf: rendered html");
    return Buffer.from(pdf);
  });
}

/**
 * Render one of this app's `/print/...` pages as `caller` (the user issuing the document). The page
 * authenticates the request with a short-lived print token bound to `path` (requirePrintCaller).
 */
export async function renderPathToPdf(
  path: string,
  caller: Pick<CallerIdentity, "tenantId" | "userId">,
  options: PdfOptions = {},
): Promise<Buffer> {
  if (!path.startsWith("/print/")) throw new Error(`Not a print route: ${path}`);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const token = createPrintToken({ tenantId: caller.tenantId, userId: caller.userId, path });
  const url = `${internalBaseUrl()}${path}?${PRINT_TOKEN_PARAM}=${encodeURIComponent(token)}`;
  return withPage(timeoutMs, async (page) => {
    const started = Date.now();
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    if (!response || !response.ok()) {
      throw new Error(`Print page ${path} answered ${response?.status() ?? "no response"}`);
    }
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf(pdfSettings(options));
    logger.info(
      { path, bytes: pdf.length, durationMs: Date.now() - started },
      "pdf: rendered print page",
    );
    return Buffer.from(pdf);
  });
}
