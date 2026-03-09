# Project Scaffold

## Tech Stack

- **Framework:** Next.js 16.1 (App Router, Turbopack)
- **Language:** TypeScript 5 (strict mode)
- **Styling:** Tailwind CSS 4 + shadcn/ui v4
- **Linting:** Biome 2 (replaces ESLint + Prettier)
- **Testing:** Vitest 4 (unit/integration) + Playwright 1.58 (E2E)
- **Database:** PostgreSQL 17 via Prisma 7
- **Auth:** Better Auth 1.5
- **Background Jobs:** Inngest 3

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with Turbopack |
| `npm run build` | Production build |
| `npm run lint` | Run Biome check |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run test` | Run Vitest tests |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:server` | Run server-side tests only |
| `npm run test:client` | Run client-side tests only |
| `npm run e2e` | Run Playwright E2E tests |
| `npm run typecheck` | Run TypeScript type check |
| `npm run db:migrate` | Run Prisma migrations (dev) |
| `npm run db:deploy` | Deploy Prisma migrations |
| `npm run db:seed` | Seed database |
| `npm run db:studio` | Open Prisma Studio |

## Project Structure

```
src/
├── app/              # Next.js App Router pages
│   ├── (app)/        # Authenticated routes
│   ├── (auth)/       # Public auth routes
│   └── api/          # API route handlers
├── components/
│   └── ui/           # shadcn/ui primitives
├── lib/              # Client-side utilities
│   └── utils.ts      # cn() helper
├── server/           # Server-side code
│   └── inngest/      # Background job queue
├── types/            # Shared TypeScript types
└── middleware.ts      # Route middleware
```

## Conventions

- **Files:** kebab-case (`journal-entry.ts`)
- **Components:** PascalCase (`JournalEntryRow`)
- **Tests:** `.test.ts` = Vitest (co-located), `.spec.ts` = Playwright (`e2e/`)
- **No barrel exports:** Direct imports only
- **One component per file**

See [[conventions]] for full details.
