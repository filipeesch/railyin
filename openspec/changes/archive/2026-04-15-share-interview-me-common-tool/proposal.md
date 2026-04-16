## Why

The interview_me tool currently has split ownership: schema and registration are duplicated in Copilot-specific code while related behavior exists in shared and native paths. This duplication creates drift risk, inconsistent tool behavior across engines, and avoidable maintenance overhead.

Unifying interview_me as a shared common tool now removes engine-specific divergence and ensures a single cross-engine contract for high-stakes structured interview interactions.

## What Changes

- Move interview_me into the shared common tool registry used by all engines.
- Use the richer interview_me description and JSON schema currently defined in workflow tools as the canonical definition.
- Remove the Copilot-exclusive interview_me tool registration path.
- Extend shared common tool execution context to support interview suspension callbacks across engines.
- Ensure Copilot, Claude, and native engine paths all surface interview_me through the same shared registration and execution flow.
- Update engine integration so interview_me can pause execution and emit the interview prompt event consistently across engines.

## Capabilities

### New Capabilities
- `engine-interview-common-tool`: Shared cross-engine interview_me tool registration and execution behavior.

### Modified Capabilities
- `engine-common-tools`: Expand common tool scope to include interview_me with shared schema and execution hook semantics.

## Impact

- Affected code:
  - src/bun/engine/common-tools.ts
  - src/bun/engine/types.ts
  - src/bun/engine/copilot/tools.ts
  - src/bun/engine/copilot/engine.ts
  - src/bun/engine/claude/tools.ts
  - src/bun/engine/claude/adapter.ts
  - src/bun/engine/claude/engine.ts
  - src/bun/workflow/tools.ts
- Runtime behavior:
  - Removes Copilot-only interview tool registration.
  - Introduces shared callback-driven interview suspension behavior for all engines.
- No external dependency changes are expected.
