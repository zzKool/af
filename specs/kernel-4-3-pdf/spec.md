# Spec — 4.3 `kernel/pdf`: Chromium in the image, print-mode rendering

**Problem.** v1 had invoices that looked right because preview and PDF were one HTML (puppeteer); v2 had no PDF at all. The constitution (§3.6) wants Chromium in the image and PDFs generated from the print mode of the same component that renders the editable form — one template, ever.

**Decision.** `kernel/pdf` owns the browser (playwright-core driving the image's Chromium); modules only provide a `/print/...` route. Print pages are opened with a short-lived signed token, not a session.

**Requirements**
- R1 `renderPathToPdf(path, caller, options)` opens `INTERNAL_BASE_URL + path` with a print token bound to that path and returns the PDF bytes (A4, 15 mm, backgrounds, `@page` wins). `renderHtmlToPdf(html)` for self-contained documents.
- R2 Print tokens: HMAC-SHA256 over `{tenantId, userId, path, exp}` with `AUTH_SECRET`, 120 s, verified in constant time, bound to the exact path. `requirePrintCaller(searchParams, path)` (kernel/auth) turns a valid token into a `CallerIdentity` (owner, system) and 404s otherwise; `/print/*` is excluded from the session proxy.
- R3 One image: the runner stage installs Chromium + fonts and sets `CHROMIUM_PATH`. Locally: `CHROMIUM_PATH`, a system Chrome, or Playwright's browser (lookup order), else a clear error.
- R4 playwright-core is imported in `kernel/pdf` only (guard). A browser is launched per render and closed — no pool.
- R5 Tests on the real browser: page breaks → 2 pages, token-bound print route renders as the caller, a 404/foreign token surfaces as an error, non-print paths refused; pure tests on the token. The suite skips itself when no Chromium exists.

**Evidence.** `sample-invoice-page1.png` — a sample invoice rendered through `renderHtmlToPdf` (print CSS, fixed footer, tabular numbers); the real `InvoiceSheet` arrives with H2.

**Out of scope.** The invoice component and its print route (H2), the job that stores the PDF as a document (invoices module), header/footer templates (CSS `position: fixed` covers it).
