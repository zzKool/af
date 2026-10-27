# Auth Setup

Authentication and session management using Better Auth 1.5 with organization-based multi-tenancy.

## Better Auth Configuration

Server-side configuration lives in `src/kernel/auth/auth.ts`:

- **Prisma adapter** connects to PostgreSQL via the base Prisma client
- **Email + password** authentication with minimum 8 character passwords
- **Organization plugin** maps organizations to tenants (`creatorRole: "owner"`)
- **nextCookies plugin** for automatic cookie handling in Server Actions
- **Experimental joins** enabled for 2-3x faster `/get-session` performance
- **Database-generated IDs** (`generateId: false`) — all auth tables use `gen_random_uuid()` for UUID consistency

## Organization-to-Tenant Mapping

This is the most critical architectural concept:

```
Better Auth Session
  └─ activeOrganizationId ← user's current workspace
       └─ SET LOCAL app.tenant_id = activeOrganizationId
            └─ RLS policies filter ALL tenant-scoped queries
```

| Better Auth Concept | Our Concept |
|---------------------|-------------|
| `organization.id` | `tenantId` |
| `session.activeOrganizationId` | Current tenant context |
| `member.role = "owner"` | Owner role |
| `member.role = "member"` | Accountant role |

## Closing the box (D61, F105)

`AUTH_SIGNUP=closed` (read once at start-up by `src/kernel/auth/signup.ts`) does three things: Better Auth's `emailAndPassword.disableSignUp`, the organization plugin's `allowUserToCreateOrganization: false`, and `/register` answering 404 (the login page hides its *create an account* links). Unset — dev, CI, the e2e — everything stays open. The production runbook sets it after the owner's first registration ([[deployment]]).

`getCaller()` (pages) refuses what the action middleware refuses: no session, no active tenant, **no membership of the active tenant, or an unknown organisation role** (`isKnownOrgRole`, one list in `can.ts`) — a member removed from the tenant keeps a cookie until it expires but no page renders for it.

The app role's password comes from `AF_APP_PASSWORD`, set by `scripts/set-app-password.mjs` in the migrate image after every deploy (the init migration created `af_app` with `app`; dev and CI keep it).

## Session Structure

After sign-in with an active organization:

```typescript
const session = await auth.api.getSession({ headers });
// session.user.id       → userId
// session.user.email    → user email
// session.session.activeOrganizationId → tenantId (our key mapping)
```

## Getting Auth Context

In Server Components and Server Actions, use `getAuthContext()`:

```typescript
import { getAuthContext } from "@/server/auth";

const context = await getAuthContext(headers);
// context.userId   → string
// context.tenantId → string | null (null if no active org)
// context.role     → null (enriched by Story 1.4's authMiddleware)
```

Story 1.4's `authMiddleware` will enrich this into a full `CallerIdentity` with role lookup and `source: 'web'`.

## Auth Client (React)

Client-side auth operations use `src/kernel/auth/auth-client.ts`:

```typescript
import { authClient } from "@/lib/auth-client";

// Sign up
await authClient.signUp.email({ email, password, name });

// Sign in
await authClient.signIn.email({ email, password });

// Organization management
await authClient.organization.create({ name, slug });
await authClient.organization.setActive({ organizationId });
```

## Route Protection

`src/middleware.ts` protects all routes except public paths using a cookie-existence check (fast, no DB call):

```typescript
import { getSessionCookie } from "better-auth/cookies";

export function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|login|register|favicon.ico).*)"],
};
```

**Note:** Next.js route groups like `(app)` don't create URL segments, so the matcher uses a deny-list pattern excluding public paths rather than matching a `/(app)` prefix.

Full session validation happens server-side in Server Actions. For Server Action middleware that uses auth context, see [[server-actions]].

## Auth API Route

All Better Auth endpoints are handled by `src/app/api/auth/[...all]/route.ts`:

```typescript
import { auth } from "@/server/auth";
import { toNextJsHandler } from "better-auth/next-js";
export const { GET, POST } = toNextJsHandler(auth);
```

## Auth Tables — NO RLS

Auth tables (`users`, `sessions`, `accounts`, `organizations`, `members`, `invitations`, `verifications`) are **global cross-tenant tables** owned by Better Auth.

**Modules read them through `src/kernel/auth/users.ts`** (F66): `userName(db, userId)`, `tenantMembers(db, tenantId)` — never `tx.user` / `tx.member` in `src/modules/*`. A new read a module needs is one more function there.

**NEVER add RLS policies to auth tables.** Adding RLS would break Better Auth silently. Only app domain tables (in `app.prisma`) get RLS via [[prisma-rls-setup]].

## Adding New Auth Features

1. Update Better Auth config in `src/kernel/auth/auth.ts` (add plugins, options)
2. Run `npx auth generate` to regenerate schema additions
3. Merge generated changes into `prisma/schema/auth.prisma` preserving conventions (`@db.Uuid`, `@db.Timestamptz`, `@map("snake_case")`)
4. Run `npx prisma migrate dev --name <description>`
5. Update client plugins in `src/kernel/auth/auth-client.ts` if needed
6. Add tests in `src/kernel/auth/auth.test.ts`

## File Locations

| File | Purpose |
|------|---------|
| `src/kernel/auth/auth.ts` | Better Auth server config + `getAuthContext()` |
| `src/kernel/auth/users.ts` | Read API of `users` / `members` for the modules (F66) |
| `src/kernel/auth/auth-client.ts` | Better Auth React client with organization plugin |
| `src/app/api/auth/[...all]/route.ts` | Auth API route handler |
| `src/kernel/auth/signup.ts` | `signupClosed()` — `AUTH_SIGNUP=closed` (F105) |
| `src/app/(auth)/login/page.tsx` + `login-form.tsx` | Login page (server) + form (client) |
| `src/app/(auth)/register/page.tsx` + `register-form.tsx` | Registration page (404 when closed) + form |
| `scripts/set-app-password.mjs` | `af_app` password from `AF_APP_PASSWORD`, run by the migrate image |
| `src/middleware.ts` | Route protection (cookie check) |
| `prisma/schema/auth.prisma` | Auth schema (regenerated via `npx auth generate`) |
| `src/kernel/auth/auth.test.ts` | Auth integration tests |
