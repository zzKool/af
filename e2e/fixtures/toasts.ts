// Toast diagnostics: sonner toasts live for a few seconds, so a failed `toBeVisible` on one says nothing about
// what the app actually showed (an error toast, nothing at all). `trackToasts` records every toast's text in the
// page; `expectToast` waits for the expected one and, on failure, reports everything that was shown instead.
import { expect, type Page } from "@playwright/test";

declare global {
  interface Window {
    __toasts?: string[];
  }
}

export async function trackToasts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    window.__toasts = seen;
    const record = (node: Node) => {
      if (!(node instanceof HTMLElement)) return;
      const toasts = node.matches("[data-sonner-toast]")
        ? [node]
        : [...node.querySelectorAll("[data-sonner-toast]")];
      for (const t of toasts) seen.push((t.textContent ?? "").trim());
    };
    new MutationObserver((mutations) => {
      for (const m of mutations) for (const n of m.addedNodes) record(n);
    }).observe(document, { childList: true, subtree: true });
  });
}

/** Waits for a toast containing `text`; the failure message lists every toast seen on the page so far. */
export async function expectToast(page: Page, text: string): Promise<void> {
  await expect
    .poll(async () => page.evaluate(() => window.__toasts ?? []), {
      message: `toast "${text}"`,
    })
    .toContainEqual(expect.stringContaining(text));
}
