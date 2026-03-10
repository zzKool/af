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
- **Feature branches:** `feature/story-<id>-<description>` — one branch per story (branch from `develop`)
- **Fix branches:** `fix/<description>` (branch from `develop`)
- **Chore branches:** `chore/<description>` (branch from `develop`)
- No staging environment — deploy directly from `main` after CI passes

### Story Git Workflow (STRICT — per command, per story)

Each story gets its own feature branch. Git actions are tied to specific BMAD commands:

#### 1. `/bmad-bmm-create-story` — ALWAYS start with:
   a. `git checkout develop`
   b. `git pull`
   c. `git checkout -b feature/story-<id>-<description>` (e.g., `feature/story-1-2-prisma-schema-rls`)

#### 2. `/bmad-bmm-dev-story` — during implementation:
   a. `git add` + `git commit` after each completed task
   b. `git push` when dev is done

#### 3. `/bmad-bmm-code-review` — when review completes:
   a. If fixes needed: commit fixes, push again
   b. When fully done: create PR `feature/story-*` → `develop`

#### Deploy
When `develop` is stable and ready, merge `develop` → `main` to deploy.

Commits use conventional commit prefixes. NEVER use Co-Authored-By Claude headers. NEVER include "Generated with Claude Code" in PR descriptions or comments.

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
