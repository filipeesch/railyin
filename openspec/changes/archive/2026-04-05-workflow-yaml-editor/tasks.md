## 1. Backend — RPC Types

- [x] 1.1 Add `workflow.getYaml` request/response types to `src/shared/rpc-types.ts`
- [x] 1.2 Add `workflow.saveYaml` request/response types to `src/shared/rpc-types.ts`
- [x] 1.3 Add `workflow.reloaded` IPC event type to `src/shared/rpc-types.ts`

## 2. Backend — Config Reload

- [x] 2.1 Export a `reloadConfig()` function from `src/bun/config/index.ts` that resets the `_config` singleton to null

## 3. Backend — RPC Handlers

- [x] 3.1 Create `src/bun/handlers/workflow.ts` with handler for `workflow.getYaml` — resolves `config/workflows/<templateId>.yaml`, reads and returns the raw UTF-8 string; returns error if file not found
- [x] 3.2 Add handler for `workflow.saveYaml` in `src/bun/handlers/workflow.ts` — parses YAML, rejects if invalid, writes file, calls `reloadConfig()`, broadcasts `workflow.reloaded` IPC event
- [x] 3.3 Register the new `workflow.*` handlers in `src/bun/index.ts`

## 4. Frontend — WorkflowEditorOverlay Component

- [x] 4.1 Create `src/mainview/components/WorkflowEditorOverlay.vue` — full-screen overlay with Monaco editor in YAML mode, title bar showing template name, and Cancel / Save buttons
- [x] 4.2 Wire client-side YAML validation using `js-yaml` — parse on every editor change; disable Save and show error message when invalid, show "Valid YAML" indicator when valid
- [x] 4.3 Implement the save action — call `workflow.saveYaml` RPC, show loading state on button, close overlay on success, display backend error inline on failure
- [x] 4.4 Add Escape key dismissal to the overlay

## 5. Frontend — Board Header Integration

- [x] 5.1 Add pencil icon button to the board header in `BoardView.vue`, immediately to the right of the board selector; disable when no board is active
- [x] 5.2 On button click, call `workflow.getYaml` RPC with the active board's `workflowTemplateId` and open the `WorkflowEditorOverlay` with the returned YAML
- [x] 5.3 On `workflow.reloaded` IPC event (or overlay close after successful save), re-fetch `boards.list` to refresh the board columns

## 6. Wiring & Polish

- [x] 6.1 Add `WorkflowEditorOverlay` to `BoardView.vue` template (alongside the existing `TaskDetailDrawer` and `CodeReviewOverlay`)
- [x] 6.2 Add a note in the overlay UI: "Changes apply to all boards using this template"
- [x] 6.3 Verify the pencil button is styled consistently with existing header buttons (secondary/text/rounded)
