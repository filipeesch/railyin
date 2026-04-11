## Why

Prompt resolution (expanding `/slash-references` to their `.github/prompts/` content) is currently performed by the orchestrator before dispatch, treating all engines identically. This prevents engines from using their own native prompt primitives — most critically, the Claude Agent SDK can resolve `.claude/commands/` and `.claude/skills/` in-session with sub-agent forking, tool pre-approval, and argument substitution, none of which are accessible when the prompt is pre-expanded to plain text.

## What Changes

- Remove `resolveSlashReference` calls from the orchestrator (`orchestrator.ts` and `workflow/engine.ts`).
- Remove `resolved_content` / `display_content` metadata written to `conversation_messages` — the raw slash reference is the correct display value.
- Move `src/bun/workflow/slash-prompt.ts` to `src/bun/engine/dialects/copilot-prompt-resolver.ts` — it becomes an engine-layer concern, not a workflow concern.
- **Native engine**: resolves prompt using the copilot dialect (`.github/prompts/` lookup with `process.cwd()` fallback) before sending to the LLM.
- **Copilot engine**: resolves prompt using the same copilot dialect (it is the dialect's owner).
- **Claude engine**: passes prompt raw to the Agent SDK; the SDK handles `.claude/commands/` and `.claude/skills/` natively in the `cwd`.
- `systemInstructions` (stage_instructions) is always plain text — no resolution anywhere.

## Capabilities

### New Capabilities

- `engine-prompt-resolution`: Per-engine prompt resolution — each engine resolves (or passes through) the prompt according to its own native convention, replacing the current single pre-dispatch expansion.

### Modified Capabilities

- `execution-engine`: `ExecutionParams.prompt` is now always the raw user input (never pre-expanded). Engine implementations are responsible for resolution.
- `slash-prompt-resolution`: Scope changes from workflow-layer utility to engine dialect library; resolution is no longer performed by the orchestrator.

## Impact

- `src/bun/engine/orchestrator.ts`: remove `resolveSlashReference` import and both call sites; remove `resolved_content` metadata writes.
- `src/bun/workflow/engine.ts`: remove `resolveSlashReference` call sites.
- `src/bun/workflow/slash-prompt.ts`: moved to `src/bun/engine/dialects/copilot-prompt-resolver.ts`.
- `src/bun/engine/native/engine.ts`: add pre-execution prompt resolution.
- `src/bun/engine/copilot/engine.ts`: add pre-execution prompt resolution.
- `src/bun/engine/claude/engine.ts`: no resolution — prompt passed raw.
- `src/bun/test/slash-prompt.test.ts`: update import path.
- No DB schema changes. No API changes.
