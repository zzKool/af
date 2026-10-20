# PDF rendering (kernel/pdf)

Constitution §3.6: Chromium ships in the image; a PDF is the **print mode of the same component that renders the editable form** — invoices, quotes, credit notes, reimbursement statements, the package summary. No second template. Phase-0 item 4.3 (2026-10-20). Rules for the printed documents themselves: the `invoice-pdf` skill.

## Shape

```
src/kernel/pdf/
  pdf.ts                 renderPathToPdf(path, caller, options) · renderHtmlToPdf(html, options) · chromiumExecutablePath() · internalBaseUrl()
                         the ONLY importer of playwright-core (guard)
  print-token.ts         createPrintToken / verifyPrintToken — HMAC(AUTH_SECRET), bound to one path, 120 s
  pdf.test.ts            real Chromium (skipped when none is found): page breaks, token-bound print route, 404 surfaced
  print-token.pure.test.ts
src/kernel/auth/print-caller.ts   requirePrintCaller(searchParams, path) → CallerIdentity for a /print page (404 otherwise)
src/proxy.ts                      /print/* is excluded from the session redirect — the token is the auth
Dockerfile                        runner stage: apk chromium + fonts, CHROMIUM_PATH=/usr/bin/chromium-browser
```

## How a module prints something

1. A **print route** under `src/app/print/<thing>/[id]/page.tsx` — a server component, no client JS needed:
   ```tsx
   export default async function PrintInvoicePage({ params, searchParams }) {
     const { id } = await params;
     const caller = await requirePrintCaller(searchParams, `/print/invoice/${id}`);
     const invoice = await withTenantTransaction(prisma, caller.tenantId, (tx) => invoices.getInvoice(tx, id));
     if (!invoice.data) notFound();
     return <InvoiceSheet mode="print" invoice={invoice.data} />;
   }
   ```
   The page renders with `caller` = the user who asked for the PDF (role owner, source system) inside the tenant's RLS transaction. It writes nothing.
2. The service that issues the document calls `renderPathToPdf("/print/invoice/" + id, caller)` and stores the bytes as a document (`InvoiceAF_{number}.pdf`) — from a job or an action's `onCommit`, never inside the issuing transaction (Chromium takes ~1 s).
3. Print CSS lives with the component: `@page { size: A4; margin: 15mm }`, `break-before: page`, `print:` Tailwind variants. `preferCSSPageSize` is on, so `@page` wins over the default A4/15 mm.

`renderHtmlToPdf(html)` renders a self-contained document (inline CSS) — for generated statements that have no page, and for tests.

## Security

- A print token is minted by the renderer right before navigation, signed with `AUTH_SECRET`, bound to the exact path, valid 120 s. The page 404s on anything else — print pages are not discoverable, and a leaked URL dies in two minutes.
- Chromium only ever opens `INTERNAL_BASE_URL` (default `http://127.0.0.1:$PORT`, the app itself) and runs `--no-sandbox` because the container has no user namespaces; the pages are ours.
- Tenant isolation is the same RLS transaction every page uses; the token carries `tenantId` + `userId`, nothing else.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `CHROMIUM_PATH` | image: `/usr/bin/chromium-browser`; else a system Chrome or Playwright's browser | the executable |
| `INTERNAL_BASE_URL` | `http://127.0.0.1:${PORT}` | where Chromium reaches this app |

Local dev on Windows: set `CHROMIUM_PATH` to Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`) or run `npx playwright install chromium` once (the e2e suite needs it anyway).

## Testing

`pdf.test.ts` launches the real browser against a tiny `node:http` stand-in for a print page (it verifies the token like `requirePrintCaller`). Page count is read from the PDF's `/Pages /Count`. The suite skips itself when no Chromium is found — CI's Ubuntu runner has Chrome, the image has Chromium, so it runs there.

Related: [[async-jobs]] (PDF generation runs as a job), [[document-upload]] (the PDF is stored as a document), [[constitution]].
