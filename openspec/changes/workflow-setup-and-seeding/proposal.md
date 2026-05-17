## Why

Workflow templates today can only be edited via a pencil button buried in the board header, and there is no UI to create or delete them. Worse, a runtime fallback synthesizes an in-memory `delivery` template with no backing file whenever none is loaded — that phantom breaks the YAML editor (it 404s on `getYaml`) and surfaces as un-manageable "ghost workflows". Fresh installs also only ever seed one hardcoded delivery file, ignoring every other bundled workflow.

## What Changes

- Remove the workflow-edit pencil button from the board header.
- Add a **Workflows** tab to the setup screen, positioned immediately before the **Boards** tab, that lists every workflow template for the current workspace (name + id) with per-row edit and delete actions and an "+ Add Workflow" button.
- The pencil opens the existing YAML editor overlay; deletion requires a confirmation dialog.
- Delete is blocked — button visible but disabled — when a workflow is referenced by at least one board in the workspace, or when it is the last remaining workflow. Guards are enforced server-side, not just in the UI.
- "+ Add Workflow" asks only for a name, derives an id, and writes a new YAML file with a minimal valid 3-column set (Backlog → In Progress → Done) to the workspace workflows directory.
- Add `workflow.list`, `workflow.create`, and `workflow.delete` RPC methods.
- On fresh install, seed the workspace workflows directory from **every** YAML file in the bundled `config/workflows` source directory, copying each file only when its filename is not already present (user customizations are never overwritten). If the bundled source is missing or empty, fall back to writing a minimal delivery workflow.
- **BREAKING** Remove the in-memory `delivery` fallback (`getDefaultTemplate()` and the `DEFAULT_DELIVERY_YAML` string): every workflow shown in the UI is now backed by a real file.
- Extract a focused `src/bun/config/workflows.ts` module owning bundled-source resolution, seeding, file discovery, and create/delete; remove the dead legacy `workflows.yaml` branch.

## Capabilities

### New Capabilities
- `workflow-management`: Workflows setup tab and the `workflow.list/create/delete` RPC surface, including server-enforced delete guards (referenced-by-board and last-remaining-workflow).
- `workflow-seeding`: Fresh-install seeding of the workspace workflows directory from the bundled source directory, with copy-if-absent semantics and a minimal-delivery last-resort fallback.

### Modified Capabilities
- `workflow-yaml-editor`: The editor overlay is now opened from the Workflows setup tab instead of a board-header pencil button; the board-header pencil requirement is removed.

## Impact

- **Frontend**: new `WorkflowSetupTab.vue`; new `<TabPanel>` in `SetupView.vue` (tab indices shift); `BoardView.vue` loses the pencil button, `onEditWorkflow`, and the overlay instance; `WorkflowEditorOverlay.vue` reused unchanged.
- **Backend**: new `src/bun/config/workflows.ts`; `handlers/workflow.ts` gains `db` injection and three new methods; `config/index.ts` seeding rewired and the delivery fallback / legacy branch deleted; `handlers/boards.ts` drops the now-dead `"delivery"` literal fallback.
- **Shared contract**: `src/shared/rpc-types.ts` gains `workflow.list/create/delete` methods and a workflow-summary row type.
- **Runtime behavior**: fresh workspaces now also receive `openspec.yaml` (and any other bundled workflow file), not just `delivery.yaml`.
- No new build/compile infrastructure; `getBundledWorkflowsDir()` resolves the source through a single helper with an env-var tier (`RAILYN_BUNDLED_WORKFLOWS_DIR`) → dev `--define` constant → `import.meta.dir`-relative path, and `seedWorkflows` accepts an injectable source directory.
- Automated test coverage for this feature is delivered separately by the `workflow-setup-test-suite` change.
