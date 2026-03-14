import { NextResponse } from "next/server";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Development only" }, { status: 403 });
  }
  throw new Error("Sentry test error — verify this appears in your Sentry dashboard");
}
