# M001: Engine Management UI

**Gathered:** 2026-08-11
**Status:** Ready for planning

## Project Description

Railyin is an AI agent execution platform with a Vue 3 board-based UI, supporting multiple AI engine backends (GitHub Copilot, Claude, Cursor, Pi/local LLMs). Engine configuration lives in YAML files (~/.railyn/config/engines.yaml), currently editable only via a raw Monaco text box in an overlay dialog. This milestone replaces that raw editor with a structured UI: sidebar engine list, form-based editing for engine/model/variant details, import/export with merge conflict resolution, and live reload without restart.

## Why This Milestone

Engine configs are shared between users and team members, but the current raw YAML editor requires YAML knowledge and makes sharing error-prone. A structured UI makes engine management accessible to non-experts and enables safe sharing via import/export.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Browse all engines in a sidebar, click one to see structured form fields + YAML preview
- Edit engine details (id, name, type, model, api_key, dialect), model metadata, and variant fields (name, label, thinking toggle) through forms
- Paste arbitrary YAML into a Monaco editor for variant options (chat_template_kwargs, etc.)
- Import an engines.yaml file, see conflicts, and Replace/Skip per engine
- Export any single engine's YAML to a file
- See changes take effect immediately — no app restart needed

### Entry point / environment

- Entry point: Board view → menu item "Engines" → launches the Engine Management UI overlay
- Environment: Browser-facing Vue 3 app (dev mode via `bun run dev`)
- Live dependencies involved: engines.yaml file on disk, `config.getEnginesYaml` / `config.saveEnginesYaml` RPC endpoints

## Completion Class

- Contract complete means: All form fields save correctly, YAML is valid, import/merge works, export downloads files, UI refreshes after save
- Integration complete means: End-to-end flow — list → select → edit → save → verify → import → export
- Operational complete means: None (no service lifecycle or deploy behavior)

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- Open the engine list, select an engine, edit a field, save, and see the UI refresh with the latest config
- Import a file with duplicate engine IDs, resolve each conflict individually, and see only the accepted changes applied
- Export a single engine's YAML, verify the downloaded file is valid engines.yaml format
- Edit a model variant's thinking toggle via form, see it reflected in both the form and the Monaco preview

## Architectural Decisions

### Dual-view editor: forms + Monaco YAML preview

**Decision:** The engine detail panel uses a split layout: left side has form fields for basic engine/model/variant structure, right side has a full-height Monaco YAML preview that stays in sync with form changes. Variant options (the deeply nested YAML content) get their own Monaco editor within the variant form.

**Rationale:** Users need structured editing for common operations (editing engine IDs, adding models, toggling variant thinking), but variant options require arbitrary YAML (chat_template_kwargs, reasoning_effort, etc.) that no form can generically represent. Dual-view gives both.

**Alternatives Considered:**
- Fully form-based — too restrictive for arbitrary YAML content like chat_template_kwargs
- Fully Monaco — defeats the purpose of structured editing, what the user wants
- Tabbed toggle between form and Monaco — harder to see sync, context loss when switching

### Import merge strategy

**Decision:** Import is merge-based (add new engines, update matching IDs). When an ID conflict occurs, the user sees a "Merge Conflicts" panel with all conflicts listed. Each conflict shows the existing engine config and the incoming engine config, with Replace/Skip buttons. If user rejects all conflicts for duplicate engines, the import is silently discarded.

**Rationale:** Most sharing scenarios involve partial updates (add one engine, update another, leave others untouched). Replace-all is a different use case that can be added later. Per-conflict resolution gives users control without risk of accidental overwrites.

**Alternatives Considered:**
- Replace-all — simpler but dangerous if user imports a file with a matching ID by mistake
- Skip-all on conflict — too restrictive, defeats the purpose of updating existing engines

### Hot reload via invalidateConfigCache()

**Decision:** After save, the UI re-fetches the engine list from the backend. The backend already calls invalidateConfigCache() on save, which forces the next read to re-parse engines.yaml. No WebSocket or polling needed.

**Rationale:** Simplest approach that works with existing infrastructure. The user explicitly required "no restart" and this achieves it without adding WebSocket channels or polling loops.

**Alternatives Considered:**
- WebSocket push — adds infrastructure, overkill for save-only events
- Polling — wasteful, unnecessary when the client initiates the save

### Engine type scoping: copilot, claude, cursor, pi only

**Decision:** The UI only supports editing these four engine types. opencode and scripted are explicitly out of scope.

**Rationale:** User explicitly scoped to these four types. Reduces the form-building surface area significantly. Legacy types can be added later via an overlay config if needed.

**Alternatives Considered:**
- Full type coverage via a single "generic engine" form — too complex, most fields are type-specific
- Dynamic form generation from YAML schema — over-engineered for 4 types

## Error Handling Strategy

- YAML parse errors shown inline in the validation bar (real-time on any form/YAML change)
- Save failures shown inline in the footer (like existing overlay pattern)
- Import invalid files: clear "could not parse" error message, no changes made
- Import conflicts: per-engine Replace/Skip; reject all → silently discard import
- Engine ID validation: prevent empty or duplicate IDs
- Type validation: warn (don't block) if YAML contains an unsupported engine type
- No draft persistence: if tab closes mid-edit, changes are lost (accepted per explicit requirement)

## Risks and Unknowns

- Monaco performance: With 5-10 engines and many models each, the YAML preview could get heavy. Need to verify Monaco handles large YAML without lag.
- Form-to-YAML sync: Bidirectional sync between form fields and Monaco YAML needs careful diff handling to avoid overwriting user edits in the Monaco editor.
- Variant options editor: Full-height Monaco for variant options means the variant panel gets large. Need to balance screen real estate.
- `invalidateConfigCache()` reload: The backend invalidates its cache on save, but the UI needs to confirm the change actually propagated to disk before considering it "live."

## Existing Codebase / Prior Art

- `src/mainview/components/EnginesEditorOverlay.vue` — existing raw YAML editor overlay. Will be replaced entirely, but the Monaco initialization, validation, and save patterns can be reused.
- `src/bun/handlers/config.ts` — RPC handlers for `config.getEnginesYaml` and `config.saveEnginesYaml`. Already calls `invalidateConfigCache()` on save.
- `src/bun/config/index.ts` — Config types (EngineConfig, PiEngineConfig, PiModelConfig, etc.). Source of truth for form field generation.
- `src/mainview/rpc.ts` — RPC client used by the frontend to call backend handlers.
- `e2e/ui/fixtures/mock-api.ts` — Mock API for Playwright UI tests. New endpoints need mock entries.

## Relevant Requirements

- R001 (Engine List View) — S01 foundation
- R002 (Engine Detail Editor) — S01
- R003 (Model Management) — S02
- R004 (Variant Management) — S02
- R005 (Provider & Harness Config) — S03
- R006 (YAML Import with Merge) — S04
- R007 (Engine Export) — S04
- R008 (Live Reload) — S03
- R009 (YAML Validation) — S01
- R010 (Engine ID Uniqueness) — S01

## Scope

### In Scope

- Engine list sidebar with basic details (id, name, type)
- Structured form editor for engine-level fields (copilot, claude, cursor, pi)
- Model CRUD with form fields (name, token limits, reasoning, tool_call, thinkingFormat, sampling presets)
- Variant CRUD with form fields (name, label, thinking toggle) + Monaco for options YAML
- Provider & harness form fields for pi engine type
- Import with YAML validation + merge conflict resolution
- Export individual engine YAML to file
- Save to engines.yaml with live UI refresh
- YAML validation inline in both form and Monaco preview

### Out of Scope / Non-Goals

- Legacy engine types (opencode, scripted)
- Bulk replace all engines
- Bulk export all engines
- Workspace-level config editing (workspace.yaml)
- Draft persistence across page reloads
- Engine testing/connection verification UI

## Technical Constraints

- Must use existing tech stack: Vue 3, PrimeVue, Pinia, Monaco Editor (already a dependency)
- Backend RPC pattern must be followed — new endpoints in `src/bun/handlers/config.ts`
- Playwright UI tests must mock API calls in `e2e/ui/fixtures/mock-api.ts`
- Component follows existing patterns (Dialog overlay, composables for dark mode)

## Integration Points

- `config.getEnginesYaml` → RPC handler returns raw YAML string (needs new structured endpoint?)
- `config.saveEnginesYaml` → RPC handler validates YAML and writes to disk
- `invalidateConfigCache()` → backend re-reads engines.yaml on next config load
- PrimeVue Dialog component → used for the overlay container
- PrimeVue DataTable → for engine list display
- PrimeVue Tabs/Panel → for form section organization

## Testing Requirements

- Backend: vitest tests for import/merge logic (new RPC endpoint)
- Playwright UI: tests for list view, engine selection, form edit, save, import with conflicts, export
- Coverage target: happy paths for all RPC endpoints, error cases for invalid YAML, duplicate IDs
- Mock API fixtures in `e2e/ui/fixtures/mock-api.ts` must cover new endpoints

## Acceptance Criteria

- Engine list displays all engines with id, name, type; selecting an engine shows form fields + YAML preview
- Form edits (engine ID, name, model) are reflected in the Monaco YAML preview in real time
- Variant form: name field, label field, thinking checkbox, Monaco options editor — all save correctly
- Import: file with 5 engines (2 duplicates) → user sees 2 conflicts, replaces 1, skips 1 → UI reflects the merge result
- Export: click export on engine → downloads valid YAML file with that engine's full config
- Save: changes to engines.yaml → UI refreshes → list and detail reflect the latest state
- Invalid YAML: validation error shown immediately, save disabled
- Duplicate ID: validation error on create/edit, save disabled
