## 1. Workflow module (backend)

- [ ] 1.1 Create `src/bun/config/workflows.ts` with `getBundledWorkflowsDir()` resolving in three tiers: `RAILYN_BUNDLED_WORKFLOWS_DIR` env var → `__RAILYN_DEV_CONFIG_DIR__/workflows` when defined and present → `import.meta.dir`-relative `config/workflows`
- [ ] 1.2 Add `getMinimalWorkflow()` returning the minimal 3-column delivery template as a JS object (Backlog `is_backlog` → In Progress → Done); no YAML string literals
- [ ] 1.3 Add `seedWorkflows(targetWorkflowsDir, sourceDir = getBundledWorkflowsDir())`: ensure dir exists, copy each bundled `*.yaml`/`*.yml` only when its filename is absent in the target, and write the minimal delivery fallback when the bundled source is missing/empty and the target has no workflow files
- [ ] 1.4 Move `resolveWorkflowFilePath(configDir, templateId)` into the module and add `listWorkflowFiles(configDir)` returning `{ id, name }` per parsed file
- [ ] 1.5 Add `createWorkflowFile(configDir, name)`: slugify the name (reuse the sanitize rule), fall back to id `workflow` when the slug is empty, append `-2`/`-3`/… on filename collision, write the minimal template via `yaml.dump`, return the new id
- [ ] 1.6 Add `deleteWorkflowFile(configDir, templateId)` and the pure `evaluateDeletable(templateId, boardCountById, totalWorkflows)` returning `{ deletable, undeletableReason }` — the referenced-by-board reason takes precedence over the last-workflow reason

## 2. Config loader cleanup (backend)

- [ ] 2.1 Rewire `ensureWorkspaceConfigExists()` in `config/index.ts` to call `seedWorkflows()` instead of writing a single hardcoded `delivery.yaml`
- [ ] 2.2 Remove the in-memory delivery fallback append (lines ~707-711) and the `getDefaultTemplate()` function
- [ ] 2.3 Remove the `DEFAULT_DELIVERY_YAML` constant and the dead legacy `workflows.yaml` branch (lines ~693-705)
- [ ] 2.4 Drop the now-dead `?? "delivery"` literal fallback in `handlers/boards.ts` `boards.create`

## 3. Workflow RPC (backend + shared contract)

- [ ] 3.1 Add `workflow.list`, `workflow.create`, `workflow.delete` method types and a workflow-summary row type (`id`, `name`, `boardCount`, `deletable`, `undeletableReason`) to `src/shared/rpc-types.ts`
- [ ] 3.2 Change `workflowHandlers` to `workflowHandlers(db, notifyReloaded)` and update its registration in `src/bun/index.ts`
- [ ] 3.3 Implement `workflow.list`: query board counts per `workflow_template_id` for the workspace, combine with `listWorkflowFiles` and `evaluateDeletable`
- [ ] 3.4 Implement `workflow.create`: call `createWorkflowFile`, then `resetConfig()` + `loadConfig()` + `notifyReloaded()`
- [ ] 3.5 Implement `workflow.delete`: recompute the guard server-side, reject when referenced or last-remaining, otherwise `deleteWorkflowFile` then `resetConfig()` + `loadConfig()` + `notifyReloaded()`
- [ ] 3.6 Update `workflow.getYaml`/`saveYaml` to use the module's `resolveWorkflowFilePath`

## 4. Workflows setup tab (frontend)

- [ ] 4.1 Create `WorkflowSetupTab.vue` mirroring `BoardSetupTab.vue`: header with "+ Add Workflow" button, row list showing name + id, per-row pencil and trash buttons
- [ ] 4.2 Disable the trash button from each row's `deletable` flag; show the `undeletableReason` as a tooltip/title
- [ ] 4.3 Wire the pencil button to load YAML via `workflow.getYaml` and open `WorkflowEditorOverlay.vue`; refresh the list on its `saved` event
- [ ] 4.4 Add an inline delete-confirmation `Dialog` (mirror the Boards tab pattern) calling `workflow.delete`
- [ ] 4.5 Add a name-only Add Workflow `Dialog` calling `workflow.create`, then refresh the list
- [ ] 4.6 Add a small `useWorkflowStore` (or local list state) providing list + refresh, and reload the list on the `workflow.reloaded` push event

## 5. Setup screen and board header (frontend)

- [ ] 5.1 Insert `<TabPanel header="Workflows">` with `<WorkflowSetupTab />` immediately before the Boards tab in `SetupView.vue`
- [ ] 5.2 Update the tab-index constants (`PROJECTS_TAB_INDEX`, `LS_TAB_INDEX`, `BOARDS_TAB_INDEX`) and `onTabChange` to account for the inserted tab, and load workflows when the Workflows tab is selected
- [ ] 5.3 Remove the pencil button, `onEditWorkflow`, and the `WorkflowEditorOverlay` instance from `BoardView.vue`, keeping the `workflow.reloaded` → `loadBoards()` listener

## 6. Regression check

- [ ] 6.1 Run `bun test src/bun/test --timeout 20000` and fix any regressions caused by removing the in-memory delivery fallback and rewiring seeding

> Dedicated automated coverage for this feature (unit, handler, `e2e/api`, and Playwright) is delivered by the separate `workflow-setup-test-suite` change.
