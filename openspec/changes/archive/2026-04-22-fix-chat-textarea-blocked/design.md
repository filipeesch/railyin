## Context

`ChatEditor.vue` is the CodeMirror 6 (CM6) based input component used in `TaskDetailDrawer`. It receives a `disabled` prop that is set to `true` while the AI is running (`task.executionState === 'running'`) and back to `false` when the turn ends. Three defects exist in the current implementation, all isolated to this single component.

## Goals / Non-Goals

**Goals:**
- Re-enable the editor correctly after every AI turn without requiring the drawer to be closed/reopened
- Make the editor visually distinguishable from the drawer background (match PrimeVue input field appearance)
- Prevent horizontal layout overflow when the user types a long unbroken line

**Non-Goals:**
- Changes to `TaskDetailDrawer.vue`, the task store, or any RPC/backend code
- Altering autocomplete, chip, or send-message behaviour
- Changing the dark-mode toggle mechanism

## Decisions

### Decision 1: Wrap `EditorView.editable` in a `Compartment`

**Problem**: CM6 extensions are immutable by default. To swap an extension's value at runtime, it must be wrapped in a `Compartment`. The current code calls `EditorView.editable.of(!props.disabled)` directly at build time, then tries `EditorView.editable.reconfigure(...)` in the `watch` — but `.reconfigure()` is a method on `Compartment`, not on `Facet`. This throws a TypeError on every `disabled: true → false` transition, leaving the editor permanently locked.

**Decision**: Add a second `Compartment` called `editableCompartment`, initialized as:
```ts
editableCompartment.of(EditorView.editable.of(!props.disabled))
```
And updated in the watch as:
```ts
editableCompartment.reconfigure(EditorView.editable.of(!props.disabled))
```

**Alternative considered**: Destroy and recreate the editor on every `disabled` change. Rejected: too expensive, loses cursor position, causes flicker, and is the wrong CM6 idiom.

---

### Decision 2: Use `--p-inputtext-background` for the editor background

**Problem**: The current `buildTheme()` uses `--p-surface-0` (light) / `--p-surface-900` (dark) — the same tokens the Drawer panel itself uses. The editor is visually invisible against its own container.

**Decision**: Switch to `--p-inputtext-background` (the PrimeVue semantic token for all text input fields, including `<InputText>` and `<Textarea>`). This token already handles dark/light correctly via the PrimeVue theme and is the established contract for input surfaces in this codebase.

For the scoped CSS wrapper (`.chat-editor`), remove the explicit `background` declarations and rely solely on `buildTheme()` which sets the background directly on `.cm-content` — the wrapping div's background becomes transparent, letting the CM content set the tone.

**Alternative considered**: Using `surface-50` (light) / `surface-800` (dark). Rejected: hardcoded level offsets are fragile across theme changes; the semantic `--p-inputtext-background` token is the correct abstraction.

---

### Decision 3: Constrain `cm-editor` width and hide `cm-scroller` horizontal overflow

**Problem**: When a user types a long line without pressing Enter, CM6's `.cm-scroller` grows horizontally (its default `overflow-x` is `auto`). Because `.chat-editor` has `overflow: visible`, this growth bleeds into the surrounding flex row, pushing the Send button off-screen.

The `.cm-content` already has `white-space: pre-wrap` and `word-break: break-word`, which are correct — but they need a bounded parent width to activate.

**Decision**: In `buildTheme()`, add to the `.cm-editor` rule:
```ts
".cm-editor": { width: "100%" }
```
And to the `.cm-scroller` rule:
```ts
".cm-scroller": { overflowX: "hidden" }
```

This constrains the editor to its flex cell and lets the existing wrap rules kick in.

**Alternative considered**: Adding `max-width: 100%; overflow: hidden` to the `.chat-editor` scoped CSS. Partially works, but hides the symptom (clipping) rather than enabling word-wrap; the inner CM content still won't reflow.

## Risks / Trade-offs

- **`overflow-x: hidden` on scroller** → code blocks or very wide autocomplete tooltips cannot be scrolled horizontally. Mitigation: autocomplete tooltips use their own positioned overlay (`z-index: 9999`) and are not affected; code blocks in the *chat history* are in a different component. Within the input box, horizontal scroll for code pasted mid-sentence is acceptable to sacrifice for layout stability.
- **`--p-inputtext-background` token availability** → If a future PrimeVue upgrade renames this token, the fallback value in `buildTheme()` must be kept in sync. Mitigation: keep explicit hex fallbacks.
