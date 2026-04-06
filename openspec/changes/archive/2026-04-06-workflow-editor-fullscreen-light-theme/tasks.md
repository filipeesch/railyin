## Tasks

- [x] Wrap template in `<Teleport to="body">` for correct stacking context
- [x] Remove inner `.workflow-editor-dialog` wrapper div — make `.workflow-editor-overlay` the full-screen surface
- [x] Flatten CSS class names — remove `__dialog` level, all sections are direct `workflow-editor-overlay__*` children
- [x] Replace dark surface tokens with light theme tokens (`--p-surface-0/50/200`)
- [x] Remove `.workflow-editor-dialog` CSS block entirely
- [x] Switch Monaco theme from `"vs-dark"` to `"vs"`
- [x] Set `z-index: 1200` consistent with `CodeReviewOverlay`
