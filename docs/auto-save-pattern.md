# Auto-Save Pattern Reference

Comprehensive guide for building auto-save forms in DefterFab. Consolidates all known edge cases from Epics 3–4.

## Auto-Save Lifecycle

- **Text fields:** Save on `onBlur` — user finishes editing, focus leaves the field
- **Select dropdowns:** Save on `onChange` — immediate commit on selection change
- **Toggles/checkboxes:** Save on `onChange` — immediate commit

## Edge Cases

### 1. Error Handling

Surface all failures via `toast.error()`. Never swallow errors silently.

```tsx
const handleSave = async (value: string) => {
  const result = await updateAction({ field: value });
  if (result?.serverError) {
    toast.error(extractError(result.serverError));
    // Revert to previous value (see Edge Case 3)
  }
};
```

### 2. Stale Closures

Use refs or functional state updates for mutable state in event handlers.

```tsx
// WRONG — stale closure captures initial value
const handleBlur = () => save(currentValue);

// RIGHT — ref always points to latest value
const valueRef = useRef(currentValue);
valueRef.current = currentValue;
const handleBlur = () => save(valueRef.current);
```

### 3. Optimistic Rollback

Revert state on server failure. Store previous value before optimistic update.

```tsx
const handleChange = async (newValue: string) => {
  const previousValue = fieldRef.current;
  setField(newValue); // Optimistic
  const result = await updateAction({ field: newValue });
  if (result?.serverError) {
    setField(previousValue); // Rollback
    toast.error(extractError(result.serverError));
  }
};
```

### 4. Empty-Value Clearing

Treat empty string as a valid value, not as "no change".

```tsx
// WRONG: skips save when field is cleared to empty
if (value === field.current) return;

// RIGHT: always save when value differs OR when value is empty (clearing)
if (value === field.current && value !== "") return;
```

### 5. None Option for Optional Selects

Include a "None" option for optional dropdowns so users can un-select.

```tsx
<option value="">— None —</option>

// onChange handler:
const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
  const value = e.target.value === "" ? null : e.target.value;
  updateAction({ field: value });
};
```

### 6. Header Sync

Propagate changes to persistent headers when form fields are displayed in both.

```tsx
// In form component:
onSave={() => onNameSaved?.(newName)}

// In parent (entity view):
const onNameSaved = () => router.refresh();
// OR direct state update if header uses local state
```

### 7. React Key Stability

Use entity IDs for React keys, never array indices.

```tsx
// WRONG — indices shift when items are added/removed
{items.map((item, i) => <Row key={i} />)}

// RIGHT — stable entity ID
{items.map((item) => <Row key={item.id} />)}
```

### 8. Confirm Dialog for Destructive Saves

Use `<ConfirmDialog>` for irreversible changes (deactivation, deletion).

```tsx
const { dialogProps, confirm } = useConfirmDialog();

const handleDeactivate = async () => {
  const confirmed = await confirm({
    title: "Deactivate partner?",
    description: `This will deactivate "${partner.name}".`,
  });
  if (!confirmed) return;
  await deactivateAction({ id: partner.id });
};
```

## Reference Implementations

- **Text field onBlur:** `PartnerForm` in `src/components/partners/partner-form.tsx`
- **Select onChange:** Settings tabs (company, my-preferences)
- **Confirm dialog:** Deactivate buttons in partner/contract entity views
- **Header sync:** `PartnerEntityView` with `onNameSaved` callback

## Checklist for New Auto-Save Forms

- [ ] All 8 edge cases reviewed
- [ ] Error handling with toast
- [ ] Stale closure prevention (refs)
- [ ] Optimistic rollback on failure
- [ ] Empty-value clearing handled
- [ ] Optional selects have None option
- [ ] Header sync if applicable
- [ ] Stable React keys
- [ ] Confirm dialog for destructive actions
