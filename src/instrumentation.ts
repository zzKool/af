// Next.js instrumentation hook — runs once per server process (not at build).
// Composition root of the in-process job worker (D17): every module's jobs and schedules are listed here.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");

    if (process.env.NEXT_PHASE !== "phase-production-build") {
      const [{ startJobs }, { documentJobs }, { rateJobs, rateSchedules }] = await Promise.all([
        import("@/kernel/jobs/queue"),
        import("@/modules/documents"),
        import("@/modules/rates"),
      ]);
      await startJobs([...documentJobs, ...rateJobs], [...rateSchedules]);
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = (await import("@sentry/nextjs")).captureRequestError;
