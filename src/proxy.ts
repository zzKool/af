import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // /print/* is opened by the PDF renderer with a print token (kernel/pdf), never by a session.
  // icon.svg (the favicon) and brand/ (the logos) are public: the login page shows them too; the web app
  // manifest too (F142) — a phone fetches it without the session cookie.
  matcher: [
    "/((?!api|_next/static|_next/image|login|register|favicon.ico|icon.svg|manifest.webmanifest|brand/|print/).*)",
  ],
};
