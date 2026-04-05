## Context

Workflow templates are defined in YAML files under `config/workflows/`. They are loaded at startup by `src/bun/config/index.ts` into a `LoadedConfig` singleton. The frontend receives a stripped-down version (`WorkflowTemplate`: id, name, columns with id/label/model) via the `boards.list` RPC — the raw YAML and the full column config (prompts, instructions, tools) are never sent to the frontend today.

A board stores a `workflowTemplateId` string (e.g. `"delivery"`) that maps to the filename `delivery.yaml`. The engine resolves the full column config at execution time from the in-memory `LoadedConfig`.

The Monaco editor is already used in the codebase (`MonacoDiffEditor.vue`) for the code review diff view, so the dependency is already present.

## Goals / Non-Goals

**Goals:**
- Let the user edit the workflow YAML for the active board's template directly from the board header
- Pencil button opens a Monaco overlay with the raw YAML, YAML mode, syntax validation
- Save writes the file back to disk, reloads the in-memory config, and refreshes the board
- No restart required after saving

**Non-Goals:**
- Creating new workflow template files from scratch (out of scope for v1)
- Deleting workflow templates
- Per-board workflow overrides (all boards sharing a template see the same YAML)
- Schema validation beyond YAML syntax (no column-structure linting in v1)
- Undo history beyond the Monaco editor's built-in undo

## Decisions

### D1: Raw YAML round-trip, not a structured form
Expose and edit the raw YAML string rather than building a form UI per field. This keeps complexity minimal, gives power users full control, and means the editor automatically reflects any new fields added to the schema without UI changes.

*Alternatives considered:*
- Structured form per field (label, prompt, stage_instructions, tools): More guided UX but high build cost and needs constant maintenance as the schema evolves.
- JSON editor: YAML is the native format, converting to/from JSON adds complexity.

### D2: Two new RPC endpoints on a `workflow` namespace
- `workflow.getYaml { templateId: string } → { yaml: string }` — reads `config/workflows/<templateId>.yaml` from disk
- `workflow.saveYaml { templateId: string; yaml: string } → { ok: true }` — validates basic parse, writes to disk, calls `reloadConfig()`, broadcasts `workflow.reloaded` IPC event

*Alternatives considered:*
- Extending the `boards` namespace: Less semantically clear; `workflow.*` makes the surface explicit.

### D3: Config hot-reload via existing `reloadConfig()` + board list refresh
After `saveYaml`, the backend calls `reloadConfig()` (already exists conceptually — config is loaded into a singleton; we expose a `resetConfig()` that nulls `_config` so next access re-reads from disk). The frontend receives the `workflow.reloaded` IPC event and re-fetches `boards.list` to get the updated column list.

*Alternatives considered:*
- Full app restart: Too disruptive, poor UX.
- Filesystem watcher: More complex, no clear advantage over an explicit save action.

### D4: New `WorkflowEditorOverlay.vue` component, not inline in BoardView
The overlay is self-contained with its own state (original YAML, edited YAML, save loading state). Keeping it in its own component keeps `BoardView.vue` clean.

### D5: YAML validation via `js-yaml` parse in the overlay (client-side)
Before enabling the Save button, parse the edited YAML with `js-yaml` in the frontend. If it throws, show an error and disable save. This gives instant feedback without a round-trip.

The backend `saveYaml` also parses before writing (defense in depth) and returns an error if invalid.

## Risks / Trade-offs

- **Corrupt YAML written on race condition** — Mitigated by: (a) client-side parse gate before sending, (b) server-side parse before writing. File is only overwritten if both pass.
- **No schema validation** — A user can save YAML that parses but has invalid column structure (e.g., missing `id`). The engine will silently ignore or error at execution time. Acceptable for v1; can add JSON Schema validation later.
- **Shared template mutation** — Editing the template file affects all boards that use it. This is a known non-goal for v1 (per-board overrides). The overlay should show a note: "Changes apply to all boards using this template."
- **File encoding** — Always read/write as UTF-8. Unlikely to be an issue in practice.

## Migration Plan

No DB migrations needed. No breaking changes. New RPC methods are additive. The existing YAML file on disk is not modified until the user explicitly saves.

## Open Questions

- Should we show a diff (before/after) before saving, or just overwrite directly? → Decided: overwrite directly for v1. The Monaco editor has built-in undo.
- Should the overlay be dismissible with Escape key? → Yes, standard modal behaviour.
