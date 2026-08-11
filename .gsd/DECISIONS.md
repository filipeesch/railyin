# Decisions Register

<!-- Append-only. Never edit or remove existing rows.
     To reverse a decision, add a new row that supersedes it.
     Read this file at the start of any planning or research phase. -->

| # | When | Scope | Decision | Choice | Rationale | Revisable? | Made By |
|---|------|-------|----------|--------|-----------|------------|---------|
| D001 | Before implementation starts on the detail panel layout | M001 | Editor layout | Dual-view: form fields on left, full-height Monaco YAML preview on right. Variant options get their own Monaco editor within the variant form. | Users need structured editing for common operations but arbitrary YAML for variant options (chat_template_kwargs). Fully form-based is too restrictive; fully Monaco defeats the purpose. Dual-view gives both. | true | agent |
| D002 | Before implementing the import flow UI | M001 | Import merge strategy | Merge-based: add new engines, update matching IDs. Conflicts listed in a panel; user Replace/Skip per engine. Reject all duplicates → silently discard import. | Most sharing involves partial updates. Replace-all is dangerous if user imports a file by mistake. Per-conflict resolution gives control without risk. | true | agent |
| D003 | Before implementing the save + refresh flow | M001 | Hot reload via invalidateConfigCache() | After save, the UI re-fetches the engine list from the backend. The backend already calls invalidateConfigCache() on save, forcing re-parse of engines.yaml. No WebSocket or polling. | Simplest approach with existing infrastructure. Client initiates the save, then fetches latest state. No need for push channels or polling loops. | true | agent |
| D004 | Before building form fields for each engine type | M001 | Engine type scoping | Only copilot, claude, cursor, pi engine types. opencode and scripted are explicitly out of scope. | User explicitly scoped to these four. Reduces form-building surface area significantly. Legacy types can be added later via overlay config if needed. | true | agent |
