## Why

Users have no way to edit workflow templates from within the app — they must manually find and edit YAML files on disk. This creates friction for customizing column prompts, stage instructions, and tool access, especially for non-technical users or when iterating quickly.

## What Changes

- A pencil (✏️) edit button appears in the board header, immediately to the right of the board selector dropdown.
- Clicking the button opens a full-screen Monaco editor overlay pre-loaded with the raw YAML of the active board's workflow template.
- The editor validates YAML syntax in real time and shows a valid/invalid indicator.
- Saving writes the updated YAML back to disk, reloads the config, and refreshes the board columns — no app restart required.
- Two new RPC endpoints are added: one to read a workflow template's raw YAML, one to write it back and trigger a reload.

## Capabilities

### New Capabilities

- `workflow-yaml-editor`: In-app Monaco YAML editor for workflow template files, accessible from the board header via a pencil button. Covers the UI overlay, backend read/write RPCs, and board reload on save.

### Modified Capabilities

- `workflow-engine`: Add RPC handlers for reading and writing workflow YAML files by template ID, and hot-reloading the config after a save.

## Impact

- `src/mainview/views/BoardView.vue` — add pencil button and editor overlay
- `src/mainview/components/` — new `WorkflowEditorOverlay.vue` component
- `src/bun/handlers/` — new or extended handler for `workflow.getYaml` and `workflow.saveYaml` RPCs
- `src/shared/rpc-types.ts` — new RPC type definitions
- `src/bun/config/index.ts` — expose config reload mechanism callable at runtime
