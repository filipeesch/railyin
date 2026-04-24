## Context

The runtime still ships a large obsolete native engine path: `src/bun/workflow/*`, `src/bun/engine/native/*`, and config compatibility code that auto-migrates legacy workspace settings into `engine.type: native`. The product direction is to rework this area rather than preserve backward compatibility with the existing native engine.

This change is intentionally breaking. Its job is to remove dead runtime/config paths so supported engine behavior is explicit and easier to maintain.

## Goals / Non-Goals

**Goals:**
- Remove native engine runtime support from engine resolution and lifecycle management
- Remove native-engine-specific config parsing and validation
- Delete legacy workflow/native engine implementation files and tests that only exist for that runtime
- Leave the supported engine surface explicit: Copilot and Claude

**Non-Goals:**
- Introduce a replacement for the old native engine
- Preserve runtime compatibility for `engine.type: native`
- Clean up unrelated conversation/session code paths

## Decisions

### 1. Remove native support from config and resolver together

**Decision:** Engine resolver and workspace config validation are changed in the same release so native is not left in a half-supported state.

**Rationale:** Keeping native in config after removing its runtime would produce confusing failures and dead configuration branches.

### 2. Treat the change as explicitly breaking

**Decision:** The change will document migration expectations rather than attempt in-runtime compatibility shims.

**Rationale:** The task direction is explicit that no backward compatibility is required for the obsolete native engine.

### 3. Delete obsolete implementation files rather than deprecate in place

**Decision:** Remove obsolete workflow/native engine code instead of keeping deprecated wrappers.

**Rationale:** The value is in reducing maintenance surface and ambiguity. Keeping the old code would preserve most of the confusion this change is meant to eliminate.

## Risks / Trade-offs

- **Existing native-configured workspaces will stop working until migrated** → Mitigation: document migration clearly in specs/tasks and fail fast with clear configuration guidance before deletion lands.
- **Some tests or helper fixtures may still rely on native behavior indirectly** → Mitigation: audit and update engine-related test fixtures as part of the same change.
- **Deletion can remove useful reference code for a future replacement** → Mitigation: rely on Git history for recovery rather than shipping dead code in the runtime.

## Migration Plan

1. Update execution/workspace specs to state supported engines clearly.
2. Remove resolver/config support for native.
3. Delete native engine implementation and obsolete workflow modules.
4. Update tests and fixtures to use supported engines only.
5. Validate that supported engines still satisfy the shared `ExecutionEngine` contract.

Rollback requires restoring the deleted code from version control; there is no runtime compatibility fallback by design.

## Open Questions

- Should startup/config validation produce a dedicated migration message for native-configured workspaces before hard failure, or is a standard unsupported-engine error enough?
