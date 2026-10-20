# Prisma schema — one file per module

Prisma's multi-file schema requires all files in this one folder, so module ownership is by file name,
not by location inside `src/modules/<module>/`:

| File | Owner |
|---|---|
| `auth.prisma` | kernel/auth (Better Auth models; also holds the `generator` and `datasource` blocks) |
| `tenancy.prisma`, `audit.prisma` | kernel |
| `<module>.prisma` | `src/modules/<module>` — the only place that module's models are declared |
| `linking.prisma` | `src/modules/linking` — the single `links` table; only that module writes it |

Rules: a model lives in exactly one file; cross-module references are validated UUIDs, not relations (RLS blocks
cross-table FKs — see `docs/cross-table-rls.md`); schema changes are serialised, one PR at a time.
