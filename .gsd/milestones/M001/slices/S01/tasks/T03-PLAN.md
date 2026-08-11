---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T03: Build dual-view overlay skeleton

Create EngineManagementOverlay.vue with: left sidebar showing engine list (id, name, type) via PrimeVue Listbox, right side Monaco YAML preview area. Wire up engine store. Replace in BoardView.vue. Show 'No engine selected' when no selection.

## Inputs

- `src/mainview/components/EnginesEditorOverlay.vue`
- `src/mainview/components/WorkflowEditorOverlay.vue`
- `src/mainview/stores/engine.ts`

## Expected Output

- `src/mainview/components/EngineManagementOverlay.vue`
- `src/mainview/components/EngineListSidebar.vue`
- `src/mainview/views/BoardView.vue`

## Verification

bun run typecheck. Manual test: open overlay from BoardView menu, verify list loads, click engine → YAML preview shows. Dark mode applies.
<!-- gsd:state-version=5:0 -->
