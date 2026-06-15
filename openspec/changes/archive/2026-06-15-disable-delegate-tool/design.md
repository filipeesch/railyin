## Context

The Pi engine currently registers a `delegate` tool that enables fan-out parallel sub-agent sessions. This tool and its infrastructure span multiple modules: `tools/delegate.ts` (implementation), `tools/index.ts` (registration), `child-session.ts` (child factory), `engine.ts` (event wiring), and `tools/display.ts` (UI display metadata).

The delegate tool is being disabled — not removed entirely. The implementation files remain as reference; only the registration and wiring is deactivated.

## Goals / Non-Goals

**Goals:**
- Remove the `delegate` tool from the Pi engine's active tool set so it is never offered to the model.
- Eliminate dead code paths in the registration layer (`tools/index.ts`) and engine wiring (`engine.ts`).
- Keep the change minimal and fully reversible via git revert.

**Non-Goals:**
- Deleting `delegate.ts`, `child-session.ts`, or `PiDelegateConfig` — these are preserved.
- Updating tests — test cleanup is out of scope and handled later.
- Disabling delegate on other engines (e.g., Claude) — this change is Pi-only.

## Decisions

### Comment-out vs. file deletion
- **Choice**: Comment out registration lines; preserve implementation files.
- **Rationale**: The user explicitly requested "comment registration lines on Pi." Preserving `delegate.ts` and `child-session.ts` means re-enabling is a simple revert. Deleting files would require restoring from git history.
- **Alternatives considered**: Config flag (`harness.delegate.enabled = false`) — already exists but doesn't remove dead code from the registration path.

### Remove `buildChildTools()` and `CHILD_COMMON_TOOL_NAMES`
- **Choice**: Remove these exports entirely from `tools/index.ts`.
- **Rationale**: They have zero production consumers outside the delegate tool. Retaining them creates orphaned exports that tests exercise but production never calls.
- **Alternatives considered**: Keep them for test compatibility — rejected because the tests themselves are delegate-specific and will be addressed separately.

### Comment out `delegateEmitRefs` in `engine.ts`
- **Choice**: Comment out the Map field, getter, event wiring, and shutdown cleanup.
- **Rationale**: This infrastructure is exclusively used by the delegate tool. Leaving it as dead mutable state is confusing and adds unnecessary complexity.
- **Alternatives considered**: Leave as harmless no-op — rejected because it obscures intent and leaves a mutable field that's never meaningfully populated.

### Remove delegate-only fields from `AllToolsOptions`
- **Choice**: Remove `delegateEmitRef`, `childSessionFactory`, `limiterRegistry`, `parentModel`, `parentSystemPrompt`, `parentConversationId`, `parentCwd`, `engineConfig`, `onRawModelMessage` from the interface.
- **Rationale**: These fields exist solely to wire delegate-specific data through `buildAllTools()`. With delegate disabled, they are dead interface surface. Removing them also cleans up the call site in `engine.ts`.
- **Note**: `limiterRegistry` is still used by `engine.ts` for main prompt rate-limiting — it is just no longer passed through `AllToolsOptions`.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| TypeScript compilation errors from removed types | All delegate fields are optional; the `buildAllTools()` call in `engine.ts` is updated simultaneously. |
| Tests referencing `buildChildTools` fail | Out of scope — test updates handled in a follow-up. |
| Re-enabling delegate later | `delegate.ts` and `child-session.ts` preserved. A git revert restores registration. |
| `spawn-agent` spec becomes inconsistent | Delta spec marks requirements as REMOVED with clear migration note. |

## Migration Plan

No migration needed — this is an internal code change with no user-facing API impact. Rollback is a single `git revert`.
