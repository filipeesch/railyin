## Context

Workflow templates are YAML files in `<workspace>/workflows/`. `loadConfig()` in `src/bun/config/index.ts` (~900 lines) reads them into memory, and after loading unconditionally appends an in-memory `getDefaultTemplate()` (`id: "delivery"`) whenever no loaded file has that id. That template has no backing file, so `resolveWorkflowFilePath()` returns `null` and `workflow.getYaml`/`saveYaml` throw — the "ghost workflow" bug.

Seeding (`ensureWorkspaceConfigExists`) writes a single `delivery.yaml` from a hardcoded `DEFAULT_DELIVERY_YAML` string, duplicating the delivery flow that also exists as a TS object in `getDefaultTemplate()`. The bundled `config/workflows/` directory contains `delivery.yaml` and `openspec.yaml`; only the former is ever seeded.

The dev launcher (`scripts/dev.ts`) injects `__RAILYN_DEV_CONFIG_DIR__` (= `<repo>/config`) via `bun --define`. There is **no** production build/compile step — `bun run prod` runs `src/bun/index.ts` directly from source — so no "binary" or build-injected production constant exists.

Existing reusable pieces: `WorkflowEditorOverlay.vue` (Monaco YAML editor), `BoardSetupTab.vue` (the row layout to mirror), the inline delete-confirm `Dialog` pattern, `sanitizeWorkspaceKey()` slug rule, and the `workflow.reloaded` push event.

## Goals / Non-Goals

**Goals:**
- A Workflows setup tab that looks and behaves like the Boards tab: list, edit (YAML overlay), delete (confirmed), add (name-only).
- Delete guards (referenced-by-board, last-remaining) enforced server-side and reflected as a disabled button.
- Fresh-install seeding from every bundled workflow file, copy-if-absent, with a minimal fallback.
- Remove the phantom in-memory delivery template so every listed workflow has a real file.
- Carve workflow file/seeding/guard logic into one focused, testable, DB-agnostic module.

**Non-Goals:**
- No new build, compile, or packaging infrastructure (`bun build --compile`, asset-copy steps).
- No decomposition of the rest of `loadConfig()` — only the workflow concern is extracted.
- No structured/form-based workflow editing — editing stays raw-YAML via the existing overlay.
- No cross-workspace workflow management — the tab is scoped to the active workspace.

## Decisions

### D1 — Bundled-source resolution: one runtime helper, no build step
`getBundledWorkflowsDir()` resolves in three tiers: (1) the `RAILYN_BUNDLED_WORKFLOWS_DIR` env var when set, (2) `join(__RAILYN_DEV_CONFIG_DIR__, "workflows")` when the dev `--define` constant is defined and that directory exists, (3) otherwise a path resolved relative to `import.meta.dir` (`<install root>/config/workflows`). Production runs from the source tree, so `config/workflows/` ships with the install; all environments resolve through this single function with no hardcoded YAML in runtime code. The env-var tier mirrors the existing `RAILYN_CONFIG_DIR`/`RAILYN_DATA_DIR`/`RAILYN_WORKSPACES_DIR` precedence already used throughout `config/index.ts`, and lets the seeding source be pointed at a controlled directory when needed.
*Alternative considered:* a build step copying `config/workflows` into `dist/` and injecting `__RAILYN_BUNDLED_WORKFLOWS_DIR__` — rejected because the backend has no build/bundling step today; adding one is disproportionate to this feature. The helper can be swapped to read an injected constant later without touching callers.

### D2 — Focused `src/bun/config/workflows.ts` module, DB-agnostic
A single module owns: `getBundledWorkflowsDir()`, `seedWorkflows(targetDir, sourceDir?)`, `listWorkflowFiles(configDir)`, `resolveWorkflowFilePath(configDir, id)` (moved out of `handlers/workflow.ts`), `createWorkflowFile(configDir, name)`, `deleteWorkflowFile(configDir, id)`, and the pure `evaluateDeletable(id, boardCountById, totalWorkflows)`. It performs no database access. `config/index.ts` and `handlers/workflow.ts` depend on it.
*Rationale:* single responsibility, isolated unit testing, and dependency injection — the handler supplies DB-derived board counts to the pure guard function rather than the module reaching into SQLite. Keeps `config/index.ts` from growing and avoids a god-module.

### D3 — Server-authoritative delete guards
`workflow.list` returns each workflow as `{ id, name, boardCount, deletable, undeletableReason }`. The handler queries the `boards` table for counts per `workflow_template_id` (scoped to the workspace), and `evaluateDeletable` produces `deletable` + a human reason (`"in use by N board(s)"` or `"the last workflow cannot be deleted"`). The UI disables the trash button purely from `deletable`. `workflow.delete` independently recomputes the same guard and throws on violation.
*Alternative considered:* frontend derives guards from the loaded board store — rejected: duplicates rule logic and couples the tab to the board store.

### D4 — Id derivation by slug with collision suffixing
`workflow.create` slugifies the name with the existing sanitize rule (lowercase, non-alphanumerics → `-`). If `<slug>.yaml` exists, try `<slug>-2`, `<slug>-3`, … The name-only Add dialog therefore never fails on a duplicate. The new file is written via `yaml.dump` of a JS object (Backlog `is_backlog` → In Progress → Done), so no YAML string literal lives in code.

### D5 — Seeding: copy-if-absent over every bundled file
`seedWorkflows(targetDir, sourceDir = getBundledWorkflowsDir())` ensures the directory exists, lists `*.yaml`/`*.yml` in the bundled source, and copies each file only when a file of that exact name is absent in the target — user edits are never overwritten. If the bundled source is missing or empty **and** the target has no workflow files, it writes the minimal 3-column delivery (same JS object as D4, id `delivery`). It replaces the single-`delivery.yaml` write in `ensureWorkspaceConfigExists`. The `sourceDir` parameter defaults to `getBundledWorkflowsDir()` for production callers and is dependency-injected so the copy/fallback branches are exercisable in isolation.

### D6 — Remove the in-memory delivery fallback
Delete `getDefaultTemplate()`, `DEFAULT_DELIVERY_YAML`, the lines ~707-711 append, and the dead legacy `workflows.yaml` branch (~693-705). After seeding there is always ≥1 workflow file, so `boards.list`'s `?? workflows[0]` stays safe and `boards.create`'s `?? "delivery"` literal becomes dead and is dropped.

### D7 — Editor relocation, overlay reused as-is
`WorkflowEditorOverlay.vue` is unchanged and mounted by `WorkflowSetupTab.vue`. `BoardView.vue` loses the pencil button, `onEditWorkflow`, and its overlay instance, but keeps the `workflow.reloaded` → `loadBoards()` listener since saved YAML can change board columns. `handlers/workflow.ts` becomes `workflowHandlers(db, notifyReloaded)`; `create`/`delete`/`saveYaml` all `resetConfig()` + `loadConfig()` + `notifyReloaded()`.

## Risks / Trade-offs

- **`import.meta.dir`-relative path breaks if the install layout changes** → the helper is the single point of resolution; a future compiled binary swaps it for an injected constant without touching callers. The dev constant path is unaffected.
- **Newly seeding `openspec.yaml` into existing-but-incomplete workspaces** → seeding is copy-if-absent and only adds files; existing `delivery.yaml` is untouched. The added `openspec.yaml` is a valid template and is intended per the spec.
- **Deleting the delivery fallback could leave zero workflows if seeding fails entirely** → the minimal-fallback branch in `seedWorkflows` guarantees at least one file; seeding runs on every `loadConfig` before workflows are read.
- **Tab-index constants in `SetupView.vue` shift when Workflows is inserted** → all index constants (`PROJECTS_TAB_INDEX`, `LS_TAB_INDEX`, `BOARDS_TAB_INDEX`) and `onTabChange` must be updated together; a missed index silently loads the wrong tab's data.
- **A workflow referenced by a board that itself has stale rows** → guard counts boards by `workflow_template_id`; deletion is blocked while any board references it, so no board is ever orphaned onto a missing template.
