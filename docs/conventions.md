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

- **Default branch:** `develop` — all feature work merges here
- **Production branch:** `main` — merge from `develop` when ready to deploy
- **Feature branches:** `feature/<description>` (branch from `develop`)
- **Fix branches:** `fix/<description>` (branch from `develop`)
- **Chore branches:** `chore/<description>` (branch from `develop`)
- No staging environment — deploy directly from `main` after CI passes

### Sprint Git Workflow

Each sprint uses a single feature branch for all stories in that sprint:

1. **Checkout `develop`:** `git checkout develop`
2. **Pull latest:** `git pull`
3. **Create sprint branch:** `git checkout -b feature/<epic-id>-<description>` (e.g., `feature/epic-1-scaffolding-auth`)
4. **Complete the sprint:** Implement all stories with intermediate commits and pushes
5. **Review:** Code review happens on the feature branch
6. **PR to `develop`:** After review passes, create a pull request to merge `feature/*` → `develop`
7. **Deploy:** When `develop` is stable and ready, merge `develop` → `main` to deploy

Commits within the sprint branch use conventional commit prefixes and reference story IDs where relevant.

## Naming Standards

Naming conventions (to be documented in [[architecture-decisions]]):
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

> **Not yet configured.** GitHub branch protection requires a Pro plan for private repositories. This will be revisited if the repo is upgraded to Pro or made public.
>
> Intended rules (when available):
> - PRs required for merging to `main`
> - Status checks required when CI is configured (Story 1-6)
> - Admin bypass enabled for solo developer workflow
