# M001: Engine Management UI

**Vision:** Structured engine management UI that replaces the raw YAML-only editor. Users get a sidebar list of engines with type badges, form-based editing for engine/model/variant details, import/export with merge conflict resolution, and live reload without restart. Supports copilot, claude, cursor, and pi engine types.

## Success Criteria

- User can browse engines, select one, see structured form + YAML preview
- User can edit engine details through forms
- User can create/edit/delete models
- User can create/edit/delete variants
- Import validates YAML, detects conflicts, user Replace/Skip
- Export downloads single engine YAML
- Save triggers live UI refresh
- YAML validation errors shown inline
- Duplicate/empty engine IDs prevented

## Slices

- [ ] **S01: Engine list + detail panel skeleton** `[sketch]` `risk:medium` `depends:[]`
  > After this: Select engine from list, see form fields and YAML preview

- [ ] **S02: Type-specific form fields** `[sketch]` `risk:medium` `depends:[S01]`
  > After this: Form fields update YAML preview in real time

- [ ] **S03: Model management** `[sketch]` `risk:medium` `depends:[S02]`
  > After this: Model create/edit/delete works, YAML syncs

- [ ] **S04: Variant management** `[sketch]` `risk:low` `depends:[S03]`
  > After this: Variant create/edit/delete within model card

- [ ] **S05: Import and Export** `[sketch]` `risk:low` `depends:[S04]`
  > After this: Export downloads YAML and import merges engines

## Boundary Map

Not provided.
<!-- gsd:state-version=23:0 -->
