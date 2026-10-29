// Next.js instrumentation hook — runs once per server process (not at build).
// Composition root of the in-process job worker (D17): every module's jobs and schedules are listed here.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      const [
        { startJobs },
        { documentJobs },
        { rateJobs, rateSchedules },
        contracts,
        invoices,
        { expenseJobs },
        { traktamenteJobs },
        { packageJobs },
        settings,
        exportsModule,
        { proposalJobs, proposalSchedules },
      ] = await Promise.all([
        import("@/kernel/jobs/queue"),
        import("@/modules/documents"),
        import("@/modules/rates"),
        import("@/modules/contracts"),
        import("@/modules/invoices"),
        import("@/modules/expenses"),
        import("@/modules/traktamente"),
        import("@/modules/package"),
        import("@/modules/settings"),
        import("@/modules/exports"),
        import("@/modules/linking"),
      ]);
      // cross-module hooks are wired here, never by the modules themselves (D24: a used rate cannot be deleted;
      // T024: nor closed before the last day it priced)
      contracts.setRateUsage(invoices.ratePricingFromInvoiceLines);
      // lesson 19: a VAT registration an invoice or a declaration carries cannot be deleted
      settings.setVatRegistrationUsage("invoices", invoices.vatRegistrationUsageFromInvoices);
      settings.setVatRegistrationUsage(
        "declarations",
        async (tx, id) =>
          (await exportsModule.listDeclarations(tx)).filter((d) => d.vatRegistrationId === id)
            .length,
      );
      await startJobs(
        [
          ...documentJobs,
          ...rateJobs,
          ...invoices.invoiceJobs,
          ...expenseJobs,
          ...traktamenteJobs,
          ...packageJobs,
          ...proposalJobs,
        ],
        [...rateSchedules, ...proposalSchedules],
      );
    }
  }
}

/** Next.js calls this for an error a route or a page threw outside a Server Action: the same log line + reference (F111). */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  // the edge runtime (the proxy) has no pino; a route error there is Next's own log line
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/kernel/errors/report-error");
  reportError(error, { action: `${request.method} ${context.routePath || request.path}` });
}
