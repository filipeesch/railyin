## Context

The codebase already supports conversation-scoped model selection and, for Pi, conversation-scoped sampling preset override. Model capabilities are discovered per engine, but current shared contracts flatten this to coarse booleans and omit per-model setting options/defaults needed for consistent chat controls.  
This change must support Copilot, Cursor, and Claude in both task and session chats, with strict SDK-driven discovery and no static model-name compatibility matrix.

## Goals / Non-Goals

**Goals:**
- Add a conversation-scoped model-setting control for v1 in both task and session chat surfaces.
- Expose normalized model-setting metadata in `models.listEnabled`, while preserving raw provider metadata for traceability.
- Apply model-switch compatibility rules deterministically (keep compatible, auto-clear unsupported, persist default when no explicit override).
- Support Cursor variant-as-effort mapping using discovered parameter/variant metadata.

**Non-Goals:**
- Introduce multi-setting generic UI for all possible knobs in v1.
- Add hardcoded per-model compatibility tables.
- Expand to engines outside Copilot, Cursor, and Claude in this change.
- Deliver testing work (handled in a separate effort).

## Decisions

1. **Conversation-scoped persistence via conversation column**
   - Store the selected/effective v1 setting value on `conversations` so task and session chat remain consistent through shared conversation state.
   - Persist default value on model switch when no explicit user override exists and provider metadata exposes a default.
   - Rationale: matches existing conversation-level model/sampling behavior and user decisions.

2. **Normalized + raw API contract**
   - Extend `models.listEnabled` with:
     - normalized v1 setting metadata used by UI rendering (`supportedValues`, `defaultValue`, current compatibility),
     - raw provider metadata for discovery provenance and future extension.
   - Rationale: keeps frontend simple while preserving strict-discovery auditability.

3. **Strict discovery with adapter-bound normalization**
   - Keep engine adapters as source-of-truth readers of SDK metadata.
   - Add a dedicated normalization layer that maps adapter outputs into shared contract fields without hardcoded model IDs.
   - Rationale: SOLID separation (discovery vs normalization vs persistence), lower coupling, easier future settings.

4. **Generic user-facing naming**
   - Use a generic UX label (`Reasoning mode`) while preserving provider-native option labels (`Fast`, `Normal`, `Low`, `Medium`, `High`, etc.).
   - Rationale: supports Cursor variants without forcing anthropic/copilot-only wording.

5. **Cursor variant-as-effort mapping rule**
   - Treat Cursor parameters/variants as v1 setting candidates when metadata indicates speed/depth-style mode semantics.
   - Do not infer from static model names.
   - Rationale: honors strict discovery while matching expected Cursor behavior.

## Risks / Trade-offs

- **[Risk] Cursor variant semantics are sometimes ambiguous** → Mitigation: require metadata-based qualification and fall back to hidden control when confidence is insufficient.
- **[Risk] Persisting default may blur explicit-vs-implicit origin** → Mitigation: include source flag in normalized payload/raw metadata (`default_applied` vs `user_selected`) for UI/debug clarity.
- **[Risk] Contract growth in `ModelInfo` increases coupling** → Mitigation: isolate v1 fields under a dedicated settings object and keep legacy fields stable during rollout.
- **[Risk] Model switch logic divergence across task/session paths** → Mitigation: centralize compatibility/default-application in shared conversation-setting service.

## Migration Plan

1. Add conversation schema migration for v1 setting value column.
2. Add shared contract fields in `rpc-types` and backend model handler responses.
3. Implement adapter discovery extensions (Copilot/Claude direct fields, Cursor parameter/variant mapping) and normalization layer.
4. Wire conversation-setting update/read flows for both task and session model changes.
5. Render control in shared `ConversationInput` using normalized metadata; hide when unsupported.
6. Roll out with backward-compatible API shape (new optional fields).
7. If rollback is required, keep nullable column and ignore new fields in handlers/UI.

## Open Questions

- Should the persisted conversation column be named narrowly for v1 (`reasoning_mode`) or reserved for multi-setting expansion (`model_settings_v1` JSON)?
- Should provider-native labels always be shown verbatim, or should we allow optional friendly aliases while preserving raw values?
