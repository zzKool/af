import { type NextRequest, NextResponse } from "next/server";

// Auth middleware placeholder — will be implemented in Story 1.3
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/(app)/:path*"],
};
