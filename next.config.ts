import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT_STANDALONE === "false" ? undefined : "standalone",
  // the dev badge sits bottom-right: bottom-left it covers the rail's foot (Settings, open / close — D76)
  devIndicators: { position: "bottom-right" },
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

export default nextConfig;
