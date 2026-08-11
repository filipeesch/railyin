# M001: Engine Management UI

**Vision:** Structured engine management UI — replaces the raw YAML text box with a sidebar list, form-based editing for engine/model/variant details, import/export with merge conflict resolution, and live reload without restart. Supports copilot, claude, cursor, and pi engine types.

## Success Criteria

- User can browse all engines, select one, and see structured form fields + YAML preview
- User can edit engine details (id, name, type, model, api_key, dialect) through forms
- User can create/edit/delete models with name, token limits, reasoning flags, thinkingFormat
- User can create/edit/delete variants with name, label, thinking toggle, and Monaco options editor
- User can configure provider and harness fields for pi engine type
- Import validates YAML, detects conflicts, user Replace/Skip per engine
- Export downloads single engine YAML file
- Save triggers live UI refresh — no browser reload or app restart needed
- YAML validation errors shown inline in both form and Monaco preview
- Duplicate/empty engine IDs prevented by UI validation

## Slices

## Boundary Map

### S01 → S02
Produces:
- Engine list component with id/name/type display and selection state
- Engine detail panel skeleton with form container and Monaco YAML preview
- Engine form data model (basic fields: id, name, type, model, api_key, dialect)
- RPC integration: load engines, load single engine YAML, save engines YAML
- Pinia store: engine state (list, selected, editing)

Consumes:
- nothing (first slice)

### S02 → S03
Produces:
- Model CRUD component with form fields (name, token limits, reasoning, tool_call, thinkingFormat, sampling presets)
- Variant CRUD component with form fields (name, label, thinking toggle) + Monaco options editor
- Form-to-YAML serialization for model/variant data
- Bidirectional sync: form changes → YAML preview update, YAML preview parse → form update (on explicit sync)

Consumes:
- Engine list and detail panel from S01
- Engine form data model from S01

### S03 → S04
Produces:
- Provider form fields (base_url, api_key, max_inflight, queue_timeout_ms) for pi engine type
- Harness form fields (undo_stack_size, delegate, background_compaction) for pi engine type
- Type-specific form rendering: copilot (model only), claude (model only), cursor (model + api_key), pi (full)
- Save flow: serialize form → RPC call → invalidateConfigCache() → re-fetch → refresh UI

Consumes:
- Model/variant forms from S02
- Engine list/detail from S01

### S04 → S05
Produces:
- Import flow: file picker → YAML parsing → merge conflict detection → conflict panel with Replace/Skip per engine
- Export flow: click export → serialize single engine → download as .yaml file
- Validation layer: YAML syntax validation inline in both form and Monaco
- Error handling: save failures, import errors, duplicate ID warnings

Consumes:
- All form components from S01-S03
- Engine list state from S01
<!-- gsd:state-version=16:0 -->
