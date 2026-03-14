import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT_STANDALONE === "false" ? undefined : "standalone",
  serverExternalPackages: ["pino", "pino-http", "pino-pretty"],
};

export default withSentryConfig(nextConfig, {
  // Only upload source maps in production CI builds
  sourcemaps: {
    disable: process.env.NODE_ENV !== "production",
  },
  // Suppress Sentry CLI logs unless debugging
  silent: true,
  // Disable telemetry
  telemetry: false,
});
