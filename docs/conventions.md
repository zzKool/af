# Conventions

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/).

### Format

```
<type>: <description>

[optional body]
```

### Supported Prefixes

| Prefix | Purpose |
|--------|---------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation changes |
| `chore:` | Maintenance, dependencies, tooling |
| `test:` | Adding or updating tests |
| `refactor:` | Code restructuring without behavior change |

### Examples

```
feat: add journal entry reconciliation
fix: correct decimal rounding in currency conversion
docs: update API endpoint documentation
chore: upgrade prisma to v7.1
test: add RLS isolation tests for partners
refactor: extract CSV parsing into dedicated service
```

## Branching Strategy

- **Main branch:** `main` (never `master`)
- **Feature branches:** `feature/<description>`
- **Fix branches:** `fix/<description>`
- **Chore branches:** `chore/<description>`
- No staging environment — deploy directly from `main` after CI passes

## Naming Standards

See [[architecture-decisions]] for complete naming conventions covering:
- Database tables and columns (`snake_case`)
- Prisma models (`PascalCase`)
- Code files (`kebab-case`)
- Components (`PascalCase`)
- Functions and actions (`camelCase` verb-first)
- Route paths (`kebab-case`)
- Environment variables (`SCREAMING_SNAKE_CASE`)

## Repository Configuration

### Gitignore Rationale

| Excluded | Reason |
|----------|--------|
| `node_modules/` | Dependencies — install via `npm install` |
| `.next/`, `.turbo/`, `dist/` | Build artifacts — regenerated on build |
| `.env*` | Secrets — use `.env.example` as template |
| `_bmad/`, `_bmad-output/` | BMAD framework — not part of deliverable |
| `.claude/` | Claude Code local state |

**Exception:** `.env.example` is committed as a secret-free template.

### Branch Protection

- PRs required for merging to `main`
- Status checks required when CI is configured (Story 1-6)
- Admin bypass enabled for solo developer workflow
