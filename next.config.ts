import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT_STANDALONE === "false" ? undefined : "standalone",
  serverExternalPackages: ["pino", "pino-pretty", "pg-boss"],
  // playwright-core ≥1.6x loads its browsers.json with a computed require() (coreBundle.js), which the standalone
  // file tracing cannot see: without it the image fails at boot ("Cannot find module …/browsers.json"). Ship it.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/playwright-core/browsers.json"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "11mb",
    },
  },
};

export default withSentryConfig(nextConfig, {
  // Only upload source maps in production CI builds
  sourcemaps: {
    disable: process.env.NODE_ENV !== "production" || !process.env.SENTRY_AUTH_TOKEN,
  },
  // Suppress Sentry CLI logs unless debugging
  silent: true,
  // Disable telemetry
  telemetry: false,
});
