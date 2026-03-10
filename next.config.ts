import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT_STANDALONE === "false" ? undefined : "standalone",
  serverExternalPackages: ["pino", "pino-http"],
};

export default nextConfig;
