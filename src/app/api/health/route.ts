import { NextResponse } from "next/server";
import { prisma } from "@/kernel/db/client";
import { jobsEnabled } from "@/kernel/jobs/queue";

// The health endpoint (docs/deployment.md): what a container healthcheck, a reverse proxy and Azure's probes
// call. Unauthenticated, no data — a database round trip and the build's version; 503 when the database is gone.
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json(
      { status: "unavailable", db: "down", version: process.env.APP_VERSION ?? null },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json(
    {
      status: "ok",
      db: "ok",
      dbLatencyMs: Date.now() - startedAt,
      jobs: jobsEnabled() ? "enabled" : "disabled",
      version: process.env.APP_VERSION ?? null,
      uptimeSeconds: Math.round(process.uptime()),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
