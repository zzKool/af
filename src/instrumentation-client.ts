// Browser Sentry (Next.js loads this file in the client; was sentry.client.config.ts until Sentry 11, F52).
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  // Disable performance and replay features — we only want error tracking
  integrations: [],
});
