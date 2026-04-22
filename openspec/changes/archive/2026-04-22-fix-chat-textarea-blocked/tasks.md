## 1. Fix Editor Lock After AI Turn

- [x] 1.1 Add `editableCompartment` (a `new Compartment()`) at the top of `ChatEditor.vue` alongside `themeCompartment`
- [x] 1.2 In `buildExtensions()`, replace `EditorView.editable.of(!props.disabled)` with `editableCompartment.of(EditorView.editable.of(!props.disabled))`
- [x] 1.3 In the `watch(() => props.disabled, ...)` handler, replace `EditorView.editable.reconfigure(!props.disabled)` with `editableCompartment.reconfigure(EditorView.editable.of(!props.disabled))`
- [x] 1.4 Manually verify: open a task, send a message, wait for AI to finish — confirm the editor accepts input again without reopening the drawer

## 2. Fix Editor Background Visibility

- [x] 2.1 In `buildTheme()`, change the `bg` variable to use `--p-inputtext-background` (with appropriate light/dark fallback hex values) instead of `--p-surface-0` / `--p-surface-900`
- [x] 2.2 In the scoped `.chat-editor` CSS rule, remove the explicit `background: var(--p-surface-0, white)` declaration (the CM content background set by `buildTheme` is sufficient; the wrapper should be transparent)
- [x] 2.3 In the non-scoped `html.dark-mode .chat-editor` rule, remove the `background: var(--p-surface-900, #0f172a)` declaration for the same reason
- [x] 2.4 Visually verify in both light and dark modes that the editor looks like an input field (visually distinct from the drawer panel background)

## 3. Fix Horizontal Word-Wrap Overflow

- [x] 3.1 In `buildTheme()`, add `width: "100%"` to the `.cm-editor` theme rule
- [x] 3.2 In `buildTheme()`, add `overflowX: "hidden"` to the `.cm-scroller` theme rule
- [x] 3.3 Manually verify: type a very long line (50+ characters with no spaces) — confirm the text wraps within the editor and the input row does not grow wider than the drawer

## 4. Build Verification

- [x] 4.1 Run `bun run build` and confirm no TypeScript or Vite errors
- [x] 4.2 Write and run e2e tests for chat textarea re-enable after AI turn
