# Auth Gating Strategy

## Overview

DefterFab uses Next.js 16.1's `proxy.ts` pattern (successor to `middleware.ts`) for client-side route protection. The proxy intercepts all app routes and checks for a valid Better Auth session cookie before allowing access.

## How It Works

**File:** `src/proxy.ts`

1. The proxy intercepts every request that matches the route matcher
2. It checks for a Better Auth session cookie using `getSessionCookie(request)`
3. If no session cookie exists, the user is redirected to `/login`
4. If a session cookie exists, the request proceeds normally

## Route Matcher

The matcher excludes these paths from auth gating:

- `api` — API routes (Better Auth endpoints, etc.)
- `_next/static` — Static assets
- `_next/image` — Image optimization
- `login` — Login page
- `register` — Registration page
- `favicon.ico` — Browser icon

All other routes require authentication.

## Important Notes

- The proxy only checks cookie **presence**, not validity. Full session validation happens server-side in the action middleware chain (`src/server/middleware/auth.ts`).
- This is a UX optimization — it prevents unauthenticated users from seeing the app shell before getting a server-side 401.
- Server Actions enforce RBAC independently via `authedAction` / `ownerAction` middleware.

## Migration History

The migration from `middleware.ts` to `proxy.ts` was completed during Epic 1. Next.js 16.1 introduced `proxy.ts` as the recommended replacement. No codemod was needed — the file was created directly following the new pattern.
