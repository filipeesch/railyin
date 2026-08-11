# Requirements

This file is the explicit capability and coverage contract for the project.

## Active

### R001 — Users can view a list of all engines in engines.yaml with basic details (id, name, type) and select one to see its full configuration.
- Class: core-capability
- Status: active
- Description: Users can view a list of all engines in engines.yaml with basic details (id, name, type) and select one to see its full configuration.
- Why it matters: Core capability — this is the primary entry point for managing engines. Without a list view, there's no way to navigate or select engines to edit.
- Source: user
- Validation: unmapped
- Notes: First slice — foundation for everything else

### R002 — Users can edit engine details (id, name, type, model, api_key, dialect, etc.) through structured form fields. Basic engine-level fields are form-managed; deep nested structures (variant options) use Monaco YAML editor.
- Class: core-capability
- Status: active
- Description: Users can edit engine details (id, name, type, model, api_key, dialect, etc.) through structured form fields. Basic engine-level fields are form-managed; deep nested structures (variant options) use Monaco YAML editor.
- Why it matters: Core capability — structured editing replaces the raw text box. Without forms, users still need to edit YAML by hand.
- Source: user
- Validation: unmapped
- Notes: Dual-view: form fields for basics + variant structure; Monaco for variant options and full YAML preview

### R003 — Users can create, edit, and delete models within an engine. Each model supports name, token limits, reasoning/tool_call flags, thinkingFormat, sampling presets, and variants.
- Class: core-capability
- Status: active
- Description: Users can create, edit, and delete models within an engine. Each model supports name, token limits, reasoning/tool_call flags, thinkingFormat, sampling presets, and variants.
- Why it matters: Users need to manage models inline rather than editing YAML by hand. Models are the core of engine configuration.
- Source: user
- Validation: unmapped
- Notes: Form fields for model metadata; Monaco for sampling preset YAML content

### R004 — Users can create, edit, and delete variants for each model. Each variant has: name (ID), display label, thinking boolean toggle, and options content managed via a full-height Monaco YAML editor for arbitrary key-value YAML content.
- Class: core-capability
- Status: active
- Description: Users can create, edit, and delete variants for each model. Each variant has: name (ID), display label, thinking boolean toggle, and options content managed via a full-height Monaco YAML editor for arbitrary key-value YAML content.
- Why it matters: Variant management is explicitly form-driven per user's direction. The thinking toggle and label are structured; only the raw options block stays in YAML form.
- Source: user
- Validation: unmapped
- Notes: Variant options = full Monaco editor for arbitrary YAML (e.g., chat_template_kwargs)

### R005 — Users can configure providers (base_url, api_key, max_inflight, queue_timeout_ms) and harness settings (undo_stack_size, delegate, background_compaction) through form fields for pi engine type. Other engine types show only their relevant fields.
- Class: core-capability
- Status: active
- Description: Users can configure providers (base_url, api_key, max_inflight, queue_timeout_ms) and harness settings (undo_stack_size, delegate, background_compaction) through form fields for pi engine type. Other engine types show only their relevant fields.
- Why it matters: Pi engine has complex provider and harness config that must be editable. Without structured fields, users edit complex YAML by hand.
- Source: user
- Validation: unmapped
- Notes: Type-specific form panels: copilot (model only), claude (model only), cursor (model + api_key), pi (full: providers, harness, models)

### R006 — Users can import an engines.yaml file. The system merges new engines into the current list, detects ID conflicts, and presents each conflict with a Replace/Skip decision per engine. Conflicts are resolved one-by-one with full visibility.
- Class: core-capability
- Status: active
- Description: Users can import an engines.yaml file. The system merges new engines into the current list, detects ID conflicts, and presents each conflict with a Replace/Skip decision per engine. Conflicts are resolved one-by-one with full visibility.
- Why it matters: Sharing engine configs between users requires import. Without merge + conflict resolution, importing would either overwrite silently or fail on any duplicate.
- Source: user
- Validation: unmapped
- Notes: Import validates YAML before merge. If user rejects all conflicts for duplicate engines, the import is silently discarded.

### R007 — Users can export a single engine's configuration to a YAML file. Each engine has an export button in the list view. The exported file contains only that engine's entry with all its models, providers, and variants.
- Class: core-capability
- Status: active
- Description: Users can export a single engine's configuration to a YAML file. Each engine has an export button in the list view. The exported file contains only that engine's entry with all its models, providers, and variants.
- Why it matters: Sharing individual engine configs requires export. Per-engine export (not bulk) lets users share selectively.
- Source: user
- Validation: unmapped
- Notes: Export downloads a .yaml file; no bulk export needed per user's explicit scope

### R008 — After saving engines.yaml, the UI reflects changes immediately without requiring a browser page reload or app restart. The engine list auto-refreshes and the selected engine's details update if the engine was modified.
- Class: core-capability
- Status: active
- Description: After saving engines.yaml, the UI reflects changes immediately without requiring a browser page reload or app restart. The engine list auto-refreshes and the selected engine's details update if the engine was modified.
- Why it matters: User explicitly required no restart. The backend already calls invalidateConfigCache() on save, so the UI needs to fetch the latest state.
- Source: user
- Validation: unmapped
- Notes: Backend invalidateConfigCache() already in place. UI needs to re-fetch after save.

### R009 — YAML syntax validation is shown inline in both the form editor (real-time on any change) and the raw Monaco YAML preview. Import files are validated before merge — invalid YAML produces a clear error message with no changes made.
- Class: core-capability
- Status: active
- Description: YAML syntax validation is shown inline in both the form editor (real-time on any change) and the raw Monaco YAML preview. Import files are validated before merge — invalid YAML produces a clear error message with no changes made.
- Why it matters: Validation prevents saving broken configs. Users need to know immediately when YAML is invalid.
- Source: user
- Validation: unmapped
- Notes: Existing validation pattern from EnginesEditorOverlay.vue can be leveraged

### R010 — Engine IDs must be unique within the list. The UI prevents creating an engine with a duplicate ID (existing or new) and rejects empty IDs. On rename, the old ID is checked against the rest of the list for conflicts.
- Class: core-capability
- Status: active
- Description: Engine IDs must be unique within the list. The UI prevents creating an engine with a duplicate ID (existing or new) and rejects empty IDs. On rename, the old ID is checked against the rest of the list for conflicts.
- Why it matters: Duplicate IDs would break config loading and engine selection. Validation at the UI level prevents silent data corruption.
- Source: user
- Validation: unmapped
- Notes: The config system already expects unique IDs. UI-level validation is the first line of defense.

## Validated

## Deferred

## Out of Scope

## Traceability

| ID | Class | Status | Primary owner | Supporting | Proof |
|---|---|---|---|---|---|
| R001 | core-capability | active | none | none | unmapped |
| R002 | core-capability | active | none | none | unmapped |
| R003 | core-capability | active | none | none | unmapped |
| R004 | core-capability | active | none | none | unmapped |
| R005 | core-capability | active | none | none | unmapped |
| R006 | core-capability | active | none | none | unmapped |
| R007 | core-capability | active | none | none | unmapped |
| R008 | core-capability | active | none | none | unmapped |
| R009 | core-capability | active | none | none | unmapped |
| R010 | core-capability | active | none | none | unmapped |

## Coverage Summary

- Active requirements: 10
- Mapped to slices: 0
- Validated: 0
- Unmapped active requirements: 10
