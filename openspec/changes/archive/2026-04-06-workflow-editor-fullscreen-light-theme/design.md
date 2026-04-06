## Design

All changes are confined to `src/mainview/components/WorkflowEditorOverlay.vue`.

### Template changes

**Wrap with `<Teleport to="body">`** — same pattern as `CodeReviewOverlay.vue` — so the overlay escapes any ancestor stacking context.

**Remove the inner `.workflow-editor-dialog` wrapper div.** The overlay root element itself becomes the full-screen surface. The header, note, editor, footer, and save-error sections are direct children of the overlay root, mirroring how `CodeReviewOverlay` is structured (header → body → footer, all flex children of the fixed root).

**Flatten the class naming** to match the overlay-as-surface pattern:
- `.workflow-editor-overlay` → the full-screen flex column container (was the dimmed backdrop)
- `.workflow-editor-overlay__header`, `__note`, `__editor`, `__footer`, `__save-error` → direct sections (the `__dialog` level is removed)

### CSS changes

| Before | After |
|---|---|
| `.workflow-editor-overlay`: backdrop with `rgba(0,0,0,0.6)`, `align-items:center`, `justify-content:center` | `.workflow-editor-overlay`: `background: var(--p-surface-0, #fff)`, `display:flex`, `flex-direction:column` — no centering |
| `.workflow-editor-dialog`: `width: min(900px, 95vw)`, `height: min(700px, 90vh)`, `background: var(--p-surface-900)`, `border-radius: 8px`, `border: 1px solid var(--p-surface-700)` | **removed** |
| Header `border-bottom: 1px solid var(--p-surface-700, #333)` | `border-bottom: 1px solid var(--p-surface-200, #e2e8f0)` |
| Note `background: var(--p-surface-800, #252525)`, `border-bottom: var(--p-surface-700)` | `background: var(--p-surface-50, #f8fafc)`, `border-bottom: var(--p-surface-200)` |
| Footer `border-top: var(--p-surface-700)` | `border-top: var(--p-surface-200, #e2e8f0)` |
| Save-error `border-top: var(--p-surface-700)`, dark red tint | `border-top: var(--p-surface-200)`, `background: var(--p-red-50, #fef2f2)` |
| `z-index: 1000` | `z-index: 1200` (consistent with `CodeReviewOverlay`) |

### Monaco theme

Change the `theme` option from `"vs-dark"` to `"vs"` so the editor renders with a white background and dark text, matching the light surface it now sits on.

### Reference

`CodeReviewOverlay.vue` is the authoritative style reference. The resulting overlay structure and CSS tokens must match it exactly for header, body, and footer sections.
