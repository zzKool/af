// Next.js instrumentation hook — runs once per server process (not at build).
// Composition root of the in-process job worker (D17): every module's jobs and schedules are listed here.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");

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
        ],
        [...rateSchedules],
      );
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = (await import("@sentry/nextjs")).captureRequestError;
