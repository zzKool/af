# Story Creation Checklist

Pre-flight checks and mandatory tasks for story creation. Used by the SM/create-story workflow.

## Task 0: Retro Gate Check

Before creating any new story, verify:

1. Open the deferred items register (`_bmad-output/implementation-artifacts/deferred-items.md`)
2. Check for items with deadlines that have passed or match the current epic/story
3. If items are past deadline: include them as tasks in the new story, OR explicitly re-defer with written justification
4. Document the check result in the story's Dev Notes section

## Mutation Story Checklist

Stories that create, update, or delete data (mutation stories) must include these tasks:

### Required Tasks

- [ ] **RLS policy task** — Ensure the new table has `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and a `tenant_isolation` policy using `current_setting('app.tenant_id', true)::uuid`
- [ ] **Specific GRANTs task** — Add explicit `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "new_table" TO defterfab_app` in the migration (never use `GRANT ALL`). Use `SELECT, INSERT` only for immutable/append-only tables
- [ ] **Audit log integration task** — Wire the service to call `AuditLogger.log()` for create/update/delete operations. Include `old_data`/`new_data` for updates
- [ ] **RLS isolation test** — Use `assertRlsIsolation()` from `config-crud-helpers.ts` to verify tenant isolation
- [ ] **Audit log test** — Use `assertAuditLogged()` from `config-crud-helpers.ts` to verify audit entries

### Optional Tasks (Context-Dependent)

- [ ] **Immutability rules** — For append-only tables, add `CREATE RULE no_update` and `CREATE RULE no_delete`
- [ ] **Validation tests** — Duplicate prevention, required field validation, business rules
- [ ] **Action-level RBAC test** — Verify `ownerAction` blocks accountant role for write operations

## Pattern-Setter Flag

Mark a story as **pattern-setter** when it's the first of its kind:

- First CRUD page → keep scope minimal, establish reusable patterns
- First background job → establish job infrastructure
- First external API integration → establish adapter pattern

Pattern-setter stories should:
- Have explicit "establish pattern" tasks
- Include documentation tasks for the new pattern
- Be reviewed more carefully (consider additional code review iteration)
- Keep scope narrow — defer edge cases to follow-up stories

## References

- Deferred items register: `_bmad-output/implementation-artifacts/deferred-items.md`
- Config page test template: `docs/config-page-test-template.md`
- Test helpers: `src/server/test-utils/config-crud-helpers.ts`
