## Context

Engine display names in Railyin come from two disconnected sources: a hardcoded `ENGINE_LABELS` map in the frontend (`SetupView.vue`) and raw engine IDs in the conversation model picker (`ConversationInput.vue`). Users cannot assign a custom display name to an engine in `engines.yaml`. This creates an inconsistent UX where the same engine might be labeled differently across pages, and users cannot customize engine names to match their workflow.

The current data flow drops any potential `name` field from `engines.yaml` entries at multiple layers — the config loader ignores it, the RPC handler doesn't include it, and the frontend type doesn't expect it.

## Goals / Non-Goals

**Goals:**
- Add optional `name` field to `engines.yaml` engine entries
- Propagate `name` through the full stack (YAML → backend config → RPC → frontend)
- Use `name` as the primary display label in the workspace setup page engine checkboxes
- Use `name` as the group header label in the conversation model picker dropdown
- Document the new field in `config/engines.yaml.sample`
- Maintain backward compatibility — existing `engines.yaml` files work without changes

**Non-Goals:**
- Changing the `ENGINE_LABELS` map (it remains as fallback)
- Adding validation or schema enforcement for the `name` field beyond YAML parsing
- Internationalization or localization of engine names
- Migrating or renaming existing engines

## Decisions

### Decision 1: `name` is optional, not required
**Choice**: Optional field (`name?: string`)
**Rationale**: Zero breaking changes. Existing `engines.yaml` files continue to work. Users can gradually add names. Required would force all existing users to update their config.
**Alternatives considered**:
- Required: Breaking change, forces migration
- Default value in code: Would still need the field in YAML for anything beyond defaults, defeating the purpose

### Decision 2: Frontend fallback chain: `name` → `ENGINE_LABELS[type]` → `id`
**Choice**: YAML `name` is primary, existing `ENGINE_LABELS` map is fallback, engine `id` is last resort
**Rationale**: Follows the established pattern in this codebase (per-model `name` fields override computed labels). Provides graceful degradation for partial adoption.
**Alternatives considered**:
- YAML `name` only, drop `ENGINE_LABELS`: Breaking, removes backward compatibility
- `ENGINE_LABELS` only, ignore YAML name: Defeats the purpose of the feature

### Decision 3: Single field, not separate display name and description
**Choice**: One `name` field on engine entries
**Rationale**: The requirement is for a display name shown in select lists. A description would be useful later but is out of scope. Keeping it simple aligns with SOLID — this is a focused change.
**Alternatives considered**:
- `name` + `description`: Adds complexity for a feature not yet requested

### Decision 4: Propagate `name` through the full stack, not computed on-demand
**Choice**: Pass `name` from YAML through config layer → RPC → frontend
**Rationale**: Clean separation of concerns. The backend owns the source of truth (YAML) and provides it fully to the frontend. The frontend does not need to recompute or fetch names separately.
**Alternatives considered**:
- Compute name in frontend from type: Would require duplicating the type→name mapping in code

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| `ENGINE_LABELS` map becomes dead code over time | Mark as deprecated in comments; remove in a future cleanup PR once all engines have `name` in YAML |
| User adds `name` but restarts are needed for config to take effect | Already documented in the engines editor UI ("changes take effect after restarting") — no new behavior |
| Typo in `name` field (e.g., special chars) | YAML is user-editable text; no validation beyond existing YAML parsing. Users can fix via the engines editor overlay. |

## Migration Plan

No migration needed. The `name` field is optional. Existing `engines.yaml` files work without modification. Users can add `name` to any engine entry at any time; the change takes effect on next config load (server restart).

## Open Questions

None — all decisions have been made during the exploration phase.
