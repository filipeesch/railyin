## Why

The workflow YAML editor overlay currently renders as a constrained centered modal on a dark-themed surface, but the rest of the app uses PrimeVue Aura's light theme (white/light-gray surfaces, light borders). This visual inconsistency makes the editor feel out of place, and the fixed `min(900px, 95vw) × min(700px, 90vh)` dialog wastes screen space that Monaco could use for editing.

## What Changes

- **Full-screen overlay**: The editor expands to cover the entire viewport (`position: fixed; inset: 0`), matching the pattern already established by `CodeReviewOverlay`. The inner dialog box and its size constraints are removed.
- **Light theme alignment**: All dark surface variables (`--p-surface-900/800/700`) and hardcoded dark fallbacks are replaced with the app's standard light tokens (`--p-surface-0`, `--p-surface-50`, `--p-surface-200`). Monaco editor theme switches from `"vs-dark"` to `"vs"`.
- **Teleport to body**: The overlay is wrapped in `<Teleport to="body">` for correct stacking context, consistent with `CodeReviewOverlay`.
- **Remove backdrop**: No semi-transparent backdrop is needed since the overlay IS the screen.

## Capabilities

### New Capabilities
<!-- none — this is a pure UX/styling change to an existing capability -->

### Modified Capabilities
<!-- none — the existing `workflow-yaml-editor` spec already mandates a full-screen overlay; this change makes the implementation conform to the spec. No requirement text needs to change. -->

## Impact

- **`src/mainview/components/WorkflowEditorOverlay.vue`**: All CSS and template changes are contained to this single file.
- No backend changes. No RPC changes. No store changes.
- No other components reference `WorkflowEditorOverlay`'s internal styles.
