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
- [ ] **Specific GRANTs task** — Add explicit `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "new_table" TO af_app` in the migration (never use `GRANT ALL`). Use `SELECT, INSERT` only for immutable/append-only tables
- [ ] **Audit log integration task** — Wire the service to call `AuditLogger.log()` for create/update/delete operations. Include `old_data`/`new_data` for updates
- [ ] **RLS isolation test** — Use `assertRlsIsolation()` from `config-crud-helpers.ts` to verify tenant isolation
- [ ] **Audit log test** — Use `assertAuditLogged()` from `config-crud-helpers.ts` to verify audit entries

### Optional Tasks (Context-Dependent)

- [ ] **Immutability rules** — For append-only tables, add `CREATE RULE no_update` and `CREATE RULE no_delete`
- [ ] **Validation tests** — Duplicate prevention, required field validation, business rules
- [ ] **Action-level RBAC test** — Verify `ownerAction` blocks accountant role for write operations

## Client-Side UI Checklist

Stories that include client-side UI components must verify these items. Based on recurring issues identified in Epic 3 retrospective.

### Mandatory Items

- [ ] **Error handling with toast** — All Server Action failures must be surfaced via `toast.error()`. Never swallow errors silently.
  - *Rationale: Epic 3 had cases where failed actions showed no user feedback, leaving users confused about whether their action succeeded.*

- [ ] **Stale closure avoidance** — Callbacks in `useEffect` and event handlers must use refs or functional state updates for mutable state. Never close over stale state variables.
  - *Rationale: Epic 3 Story 3.1 had stale closure bugs where delete handlers captured outdated state, causing incorrect items to be removed.*

- [ ] **Unique React keys** — List items must use stable unique IDs (e.g., `entity.id`), never array indices for dynamic lists where items can be added/removed/reordered.
  - *Rationale: Epic 3 had key collision bugs causing React to skip re-renders or apply updates to wrong list items.*

- [ ] **Optimistic update rollback** — If using optimistic updates, the component must revert to previous state on Server Action failure. Include the rollback in the error handler.
  - *Rationale: Epic 3 had cases where optimistic UI showed success but the server rejected the change, leaving UI out of sync with the database.*

- [ ] **Confirm dialog for deletes** — Delete operations must use `<ConfirmDialog>` (from `src/components/ui/confirm-dialog.tsx`), never native `confirm()`. Include entity name in the confirmation description.
  - *Rationale: Native `confirm()` blocks the thread, is unstyled, and not accessible. Story 4.0 introduced the shared `ConfirmDialog` component as the standard.*

- [ ] **Empty-value clearing on blur** — Auto-save onBlur handlers must treat empty string as a valid value, not as "no change". When a user clears a text field, the empty value must be committed to the server.
  ```tsx
  // WRONG: if (value === field.current) return;  // "" === "" skips save
  // RIGHT: if (value === field.current && value !== "") return;
  ```
  - *Rationale: Story 4.1 — clearing a text field back to empty was ignored by onBlur, which treated "" as unchanged.*

- [ ] **None option for optional selects** — Optional select dropdowns (currency, language, BAS category, etc.) must include a "None" or "—" option so users can un-select a previously chosen value. The None option should send `null` to the server.
  ```tsx
  <option value="">— None —</option>  // Always include for optional selects
  // onChange handler: send null when value === ""
  ```
  - *Rationale: Story 4.1 — once a user selected a currency or language, there was no way to un-select it.*

- [ ] **Header-sync for persistent headers** — When a form field (e.g., partner name) is displayed in both a persistent header and a form body, auto-save updates must propagate to the header. Use a callback (e.g., `onNameSaved`) that triggers `router.refresh()` or direct state update.
  ```tsx
  // In form: onSave={() => onNameSaved?.(newName)}
  // In parent: const onNameSaved = () => router.refresh();
  ```
  - *Rationale: Story 4.3 — partner name in the persistent header became stale after auto-save updated the name in the form body.*

## Code Duplication Threshold

- **Second copy:** Flag as tech debt in the deferred items register immediately
- **Third copy:** Extract to shared utility — do NOT proceed with a third duplication

*Rationale: Epic 4 retro — `extractError` was duplicated in Stories 4.1 and 4.2, only extracted to shared utility in Story 4.3. Second copy should have been flagged immediately.*

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
- Test helpers: `src/kernel/test-utils/config-crud-helpers.ts`
