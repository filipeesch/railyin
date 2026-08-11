# S01: Engine List + Detail Panel Skeleton — Research

## Active Requirements Owned/Supported

- **R001** (Engine List View) — Core: browse list, select engine, see full config
- **R002** (Engine Detail Editor) — Core: structured form fields for engine-level fields
- **R009** (YAML Validation) — Inline validation in form and Monaco preview
- **R010** (Engine ID Uniqueness) — Prevent duplicate/empty IDs

## Summary

S01 replaces the existing monolithic raw-YAML `EnginesEditorOverlay` with a structured two-pane UI: a sidebar engine list and a detail panel with form fields + synchronized Monaco YAML preview. The primary blocker is that the current RPC contract (`config.getEnginesYaml`) only returns raw YAML text — structured data is parsed only in the backend. S01 must wire up a new structured engine list endpoint and create the Pinia store, components, and dual-view layout.

## Key Findings

### 1. RPC Contract Gap (Highest Risk)
- `config.getEnginesYaml` → `{ yaml: string }` (raw file content only)
- `config.saveEnginesYaml` → validates & writes, calls `invalidateConfigCache()`
- The backend already has `loadEnginesConfig()` that returns `EngineEntry[]` (parsed, validated) — this needs to be exposed as an RPC endpoint.
- **Decision**: Create `engines.list` (returns structured `EngineEntry[]` with type info) and keep existing `config.getEnginesYaml`/`saveEnginesYaml` for the Monaco preview. The detail panel reads raw YAML for the Monaco preview but form edits serialize back to YAML for save.
- **Files to change**: `src/bun/handlers/config.ts` (new handler), `src/shared/rpc-types.ts` (new type entry), `src/mainview/rpc.ts` (new client function).

### 2. EngineConfig Union Type Complexity
- `EngineConfig` = `CopilotEngineConfig | ClaudeEngineConfig | ScriptedEngineConfig | OpenCodeEngineConfig | PiEngineConfig | CursorEngineConfig`
- **In scope for S01**: copilot (model only), claude (model only), cursor (model + api_key), pi (full: providers, harness, models, dialect, context_window)
- **Out of scope**: opencode, scripted
- The `EngineEntry` type (`{ id: string, config: EngineConfig }`) is already exported from `src/bun/config/index.ts`.
- **Decision**: Define matching types in `src/shared/rpc-types.ts` so the frontend has full type safety. These mirror the backend config types. The `EngineConfig` discriminated union uses `type` field.

### 3. Pinia Store Pattern
- Existing stores: `workspace.ts`, `board.ts`, `task.ts`, `chat.ts`, `drawer.ts`, `conversation.ts`, `codeServer.ts`
- Pattern: `defineStore()` with `ref()` state, `async` functions, `api()` calls, TypeScript interfaces
- **Decision**: New `engine.ts` store with state: `engines: EngineEntry[]`, `selectedId: string | null`, `editing: Partial<EngineEntry> | null`, `yaml: string`, `validationError: string | null`
- Must handle lazy loading: load on first open, refresh on save (via `invalidateConfigCache()` call).

### 4. Dual-View Layout
- **Existing precedent**: `WorkflowEditorOverlay.vue` uses a single Monaco editor with validation bar. `EnginesEditorOverlay.vue` also uses single Monaco.
- **Decision**: Split layout — left pane (sidebar list + form), right pane (Monaco YAML preview). Use CSS flex/grid. Left side ~35% sidebar + ~65% form area, right side Monaco fills remaining.
- PrimeVue `DataTable` can be used for the list view (shows id, name, type). If not already used, PrimeVue's simpler `v-for` list with `Accordion` or plain list items is acceptable for S01.
- **Simpler approach for S01**: Use PrimeVue's `Listbox` for the engine list (handles selection state natively), `Panel` or `Fieldset` for form sections.

### 5. Monaco Integration Pattern
- Already working in `EnginesEditorOverlay.vue` and `WorkflowEditorOverlay.vue`
- Pattern: `loader.config({ monaco })`, `monaco.editor.create(el, { value, language: "yaml", ... })`, `onDidChangeModelContent` for validation
- **Reuse**: Copy the Monaco initialization from `EnginesEditorOverlay.vue` into the detail panel. The key difference: Monaco is read-only preview (synced from form changes), not a user-edited field.

### 6. Dark Mode
- `useDarkMode()` composable returns `{ isDark: ref<boolean>, toggle }`
- Monaco theme is set based on `isDark` value (watched)
- **Decision**: Apply same pattern. Monaco theme updates when dark mode changes.

### 7. Entry Point / Launch
- `BoardView.vue` has `enginesEditorVisible` ref and renders `<EnginesEditorOverlay>`
- Menu command `{ label: "Engines", icon: "pi pi-server", command: () => { enginesEditorVisible.value = true; } }`
- **Decision**: Keep the same launch pattern. Replace `<EnginesEditorOverlay>` with the new `<EngineManagementOverlay>` (or `<EngineEditorOverlay>`) in `BoardView.vue`.

## Files and Purpose

### New Files (to create)
| File | Purpose |
|------|---------|
| `src/mainview/stores/engine.ts` | Pinia store: engine list, selected engine, YAML, validation state |
| `src/mainview/components/EngineListSidebar.vue` | Sidebar component: engine list with id/name/type, selection, "New Engine" button |
| `src/mainview/components/EngineDetailPanel.vue` | Detail panel: type-specific form fields + Monaco YAML preview |
| `src/mainview/components/EngineFieldRow.vue` | Reusable form field wrapper (label, input, validation message) |
| `src/mainview/components/EngineManagementOverlay.vue` | Top-level overlay: coordinates sidebar + detail panel (replaces EnginesEditorOverlay) |

### Modified Files
| File | Changes |
|------|---------|
| `src/bun/handlers/config.ts` | Add `engines.list` handler that returns parsed `EngineEntry[]` |
| `src/shared/rpc-types.ts` | Add `engines.list` RPC entry + engine type interfaces (`EngineInfo`, `PiModelInfo`, `PiVariantInfo`, `PiProviderInfo`, `SamplingPresetInfo`) |
| `src/mainview/rpc.ts` | Add `listEngines()` client function |
| `src/mainview/views/BoardView.vue` | Replace `<EnginesEditorOverlay>` with `<EngineManagementOverlay>`, update imports |

### Referenced (read-only, for understanding)
| File | Why |
|------|-----|
| `src/bun/config/index.ts` | Source of truth for `EngineEntry`, `EngineConfig` union, `PiEngineConfig`, `PiModelConfig`, `PiVariantConfig`, `PiProviderConfig`, `SamplingPreset`, `PiDelegateConfig`, `PiBackgroundCompactionConfig`, `CopilotEngineConfig`, `ClaudeEngineConfig`, `CursorEngineConfig` |
| `src/bun/handlers/config.ts` | Existing `getEnginesYaml`/`saveEnginesYaml` handler pattern |
| `src/mainview/components/EnginesEditorOverlay.vue` | Current raw YAML editor — Monaco init, validation, save patterns to reuse |
| `src/mainview/components/WorkflowEditorOverlay.vue` | Similar overlay pattern, Teleport-to-body usage |
| `src/mainview/components/ManageModelsModal.vue` | Dialog-based UI pattern for model management |
| `src/mainview/composables/useDarkMode.ts` | Dark mode composable for Monaco theme |
| `config/engines.yaml` | Sample data showing real engine shapes (copilot, pi) |
| `config/engines.yaml.sample` | Full example with all supported types |

## Verification

### Unit/Contract Tests
```bash
# Backend: verify new RPC endpoint returns structured data
bun test src/bun/test/engines-config.test.ts

# Type check
bun run typecheck
```

### Manual Verification Steps
1. Open the app (`bun run dev`), navigate to Board view
2. Open the "Engines" menu → new overlay opens with empty list
3. Backend should have at least one engine in engines.yaml (the test config or default)
4. List should show engine id and type
5. Select an engine → detail panel shows form fields + YAML preview
6. Edit a form field → YAML preview updates in real time
7. YAML validation status shows (valid/invalid)

## Implementation Landscape

### Phase 1: RPC Layer (unblocks everything)
1. Add `engines.list` handler in `config.ts` — returns parsed `EngineEntry[]` from `loadEnginesConfig()`
2. Add type definitions in `rpc-types.ts` — mirror the backend config types for frontend use
3. Add `listEngines()` client function in `rpc.ts`

### Phase 2: Pinia Store
4. Create `engine.ts` store with `engines`, `selectedId`, `yaml`, `validationError` state
5. Implement `loadEngines()`, `selectEngine()`, `refreshYaml()`, `setYaml()`, `validateYaml()`

### Phase 3: UI Components
6. Create `EngineManagementOverlay.vue` — the wrapper overlay (replaces EnginesEditorOverlay)
7. Create `EngineListSidebar.vue` — PrimeVue Listbox or DataTable showing id/name/type
8. Create `EngineDetailPanel.vue` — form fields for basic engine info + Monaco YAML preview
9. Wire up sync: form changes → YAML update → Monaco refresh

### Phase 4: Integration
10. Update `BoardView.vue` to use new overlay
11. Verify dark mode, validation, loading states

### First Proof of Concept
The highest-risk item is the RPC → store → UI data flow. A minimal POC that shows the engine list (from the new structured endpoint) and a read-only Monaco preview of the selected engine's YAML would prove the entire chain works before building forms.

## Don't Hand-Roll
- **Monaco Editor**: Already a dependency, use the same loader pattern as existing overlays
- **PrimeVue components**: Dialog (Teleport pattern), Listbox/DataTable for list, Button for actions
- **YAML parsing**: Use `js-yaml` (already imported in config handler)
- **Dark mode**: Reuse `useDarkMode()` composable pattern
- **RPC transport**: Use existing `api()` function pattern

## Risks and Watch-Outs

1. **RPC type sync**: Engine types in `rpc-types.ts` must stay in sync with `bun/config/index.ts`. Consider: export types from `config/index.ts` and import them in both backend and frontend, or maintain a shared types file.
2. **Monaco re-init on engine switch**: When switching engines, the Monaco model needs to be swapped (not re-created). Use `editor.setModel()` with a new model instance.
3. **YAML → form round-trip**: When loading YAML into the form, the raw YAML text must be parsed into the structured form model. This requires a YAML-to-form-model converter. For S01, a simple field-level mapping is sufficient (id, name from YAML id/config, type from config.type, model from config.model).
4. **Performance**: With large engines.yaml (many engines/models), loading all engines at once could be slow. `loadEnginesConfig()` re-parses the file each time. Consider caching or memoization if needed.