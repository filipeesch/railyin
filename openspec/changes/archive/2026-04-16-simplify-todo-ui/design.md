## Context

The todo tool system was implemented with both model-controlled and user-editable capabilities. The `TodoDetailOverlay.vue` component currently allows users to edit number, title, description, status, and phase fields. However, this creates UX confusion and potential execution issues:

- Users don't understand sparse numbering (10, 20, 30) and shouldn't modify execution order
- Users changing status on in-progress/done items can interfere with model execution flow
- Phase scoping is a model concern for context injection, not user configuration
- The overlay uses custom button styling that doesn't match the app's PrimeVue/Sakai design system
- Dark mode overrides are incomplete for custom button styles

The current overlay structure has two close buttons (delete and close) using the same "✕" icon, making it unclear which action does what.

## Goals / Non-Goals

**Goals:**
- Simplify user interface to only show editable fields that make sense for users (title, description for pending items)
- Remove all model-controlled fields from user editing (number, status, phase)
- Restrict user actions to pending items only (edit description, delete)
- Follow existing overlay visual patterns (WorkflowEditorOverlay, CodeReviewOverlay)
- Use PrimeVue Button components for consistent styling and automatic dark mode support
- Add proper dark mode overrides using semantic tokens

**Non-Goals:**
- Change model tool behavior (models still control everything via tools)
- Add new capabilities or RPC endpoints
- Change database schema or todo structure
- Allow users to create new todos (still model-only)
- Allow users to edit non-pending todos

## Decisions

### D1: Remove all number/status/phase inputs from overlay

**Decision**: Completely remove the number input, status dropdown, and phase dropdown from the overlay. Users should only see title (always editable) and description (editable only when pending).

**Rationale**: 
- Numbers are execution order—users don't need to understand or modify this
- Status is model-controlled via `update_todo_status`—user changes can break execution flow
- Phase is context scoping—model decides when todos are active based on workflow state
- These fields create cognitive load without providing user value

**Alternatives considered**:
- Hide number but keep status/phase: Rejected—status changes on in-progress items are dangerous
- Make status/phase read-only display: Rejected—adds UI clutter for information users don't act on

### D2: Conditional rendering based on todo status

**Decision**: Use `isPending = computed(() => form.status === "pending")` to conditionally show:
- Edit tab (only when pending)
- Textarea edit mode (only when pending)
- Delete button (only when pending)
- Footer with Save/Cancel buttons (only when pending)

When status is not pending (in-progress, done, blocked):
- Show only Preview tab (no Edit tab)
- Show markdown preview only (no textarea)
- Show only Close button (no delete)
- No footer (no save/cancel)

**Rationale**: 
- Prevents users from modifying work that's already in progress or completed
- Reduces overlay complexity for non-pending items
- Makes it visually clear which items are still editable

**Alternatives considered**:
- Show all fields but disable non-pending edits: Rejected—confusing UI with disabled fields
- Separate overlays for pending vs non-pending: Rejected—overly complex, same component with conditional rendering is cleaner

### D3: Follow WorkflowEditorOverlay visual pattern

**Decision**: Replace custom button implementations with PrimeVue Button components following the exact pattern from `WorkflowEditorOverlay.vue`:

**Header structure**:
```vue
<div class="todo-overlay__header">
  <div class="todo-overlay__title">
    <i class="pi pi-check-circle" />
    <span>{{ form.title }}</span>
  </div>
  <div class="todo-overlay__header-actions">
    <Button v-if="isPending" icon="pi pi-trash" severity="danger" text rounded @click="onDelete" />
    <Button icon="pi pi-times" severity="secondary" text rounded @click="onClose" />
  </div>
</div>
```

**Footer structure**:
```vue
<div v-if="isPending" class="todo-overlay__footer">
  <Button label="Cancel" severity="secondary" @click="onClose" />
  <Button label="Save" severity="primary" :loading="saving" @click="onSave" />
</div>
```

**Rationale**:
- PrimeVue Button components handle dark mode automatically via severity tokens
- Consistent visual language across all overlays in the app
- Proper accessibility (aria-labels, keyboard navigation)
- Follows established patterns (WorkflowEditorOverlay, CodeReviewOverlay)

**Alternatives considered**:
- Keep custom buttons with manual dark mode: Rejected—duplicates work, easy to get wrong
- Use PrimeVue Dialog: Rejected—overlay pattern is correct, Dialog is for modals

### D4: Dark mode using unscoped html.dark-mode selector

**Decision**: Add dark mode overrides in an unscoped `<style>` block using `html.dark-mode` ancestor selector:

```css
<style>
html.dark-mode .todo-overlay {
  background: var(--p-surface-900, #0f172a);
}
html.dark-mode .todo-overlay__header {
  background: var(--p-surface-800, #1e293b);
  border-bottom-color: var(--p-surface-700, #334155);
}
html.dark-mode .todo-overlay__footer {
  border-top-color: var(--p-surface-700, #334155);
}
</style>
```

**Rationale**:
- PrimeVue Aura uses `dark-mode` class on `<html>` element
- Semantic tokens (`--p-surface-0/50/200`) automatically flip to dark values (`--p-surface-900/800/700`)
- Unscoped block needed so `html.dark-mode` ancestor selector works (scoped would prefix class names)
- PrimeVue Button components handle their own dark mode via severity tokens

**Reference**: `WorkflowEditorOverlay.vue` lines 283-298, `CodeReviewOverlay.vue` lines 930-944

### D5: RPC validation for pending-only edits

**Decision**: Add validation in `src/bun/handlers/tasks.ts` `todos.edit` handler to reject edits to non-pending todos:

```typescript
const todo = getTodo(taskId, todoId);
if (!todo) return error("Todo not found");
if (todo.status !== "pending") {
  return error("Can only edit description of pending todos");
}
// Proceed with edit...
```

**Rationale**:
- Defense in depth: even if UI bypassed validation, backend protects execution flow
- Clear error messages help debugging
- No schema changes needed—just add validation logic

**Alternatives considered**:
- Trust UI completely: Rejected—bad security practice, easy to bypass
- Allow all edits but log warnings: Rejected—doesn't prevent execution issues

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Users can't delete done todos accidentally | Delete button only shown for pending; model can still delete via tools if needed |
| Users can't fix status on mis-marked items | Model controls status; if status is wrong, model should have set it correctly |
| Visual inconsistency during transition | Follow exact WorkflowEditorOverlay pattern; test in both light/dark mode |
| Validation blocking legitimate edits | Validation only blocks non-pending edits; pending items always editable |

## Migration Plan

This is a pure UI change with no schema or API changes. No migration needed.

1. **Update TodoPanel.vue**: Remove `[+]` button
2. **Rewrite TodoDetailOverlay.vue**: 
   - Remove number/status/phase inputs
   - Add PrimeVue Button components
   - Add `isPending` computed property
   - Add conditional rendering
   - Add dark mode overrides
3. **Update RPC handlers**: Add validation for pending-only edits
4. **Test**: Verify light/dark mode, pending/non-pending behavior, delete functionality

## Open Questions

None—design is complete and aligned with requirements.
