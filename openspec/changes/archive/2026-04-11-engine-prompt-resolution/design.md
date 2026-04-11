## Context

All three engine implementations (Native, Copilot, Claude) currently receive a pre-expanded `prompt` string from the orchestrator. The orchestrator calls `resolveSlashReference()` before dispatch, unconditionally converting `/opsx-propose foo` into hundreds of lines of markdown. This was appropriate when only one prompt convention existed, but the Claude Agent SDK now has its own native resolution mechanism (`.claude/commands/`, `.claude/skills/`) that is richer than what railyin emulates — including sub-agent forking, tool pre-approval, and `$ARGUMENTS` substitution. By expanding before dispatch, railyin prevents the Claude SDK from ever using these capabilities.

Additionally, the `resolved_content` metadata written to `conversation_messages` is noise — the user sent `/opsx-propose foo` and that is what should appear in the conversation history.

## Goals / Non-Goals

**Goals:**
- Each engine resolves (or delegates) the prompt according to its own native convention.
- Claude engine passes prompt raw to the SDK so `.claude/commands/` and `.claude/skills/` work natively.
- Native and Copilot engines resolve using the copilot dialect (`.github/prompts/` lookup) as a shared library.
- Orchestrator dispatches raw prompts only — zero resolution logic.
- `systemInstructions` (stage_instructions) is always plain text; no engine resolves it.
- `resolved_content` DB metadata eliminated.

**Non-Goals:**
- Adding a second non-copilot dialect for Native engine (future, when needed).
- Changing `ExecutionParams` shape — `prompt: string` stays.
- Any changes to `systemInstructions` handling.
- Migrating existing stored messages that have `resolved_content`.

## Decisions

### 1. Copilot dialect as a shared library, not a base class

**Decision**: Extract `slash-prompt.ts` to `src/bun/engine/dialects/copilot-prompt-resolver.ts`. Both Native and Copilot engines import and call it directly before sending the prompt to their respective backends.

**Alternatives considered**:
- Engine base class with `resolvePrompt()` hook — adds inheritance, harder to test in isolation. Rejected.
- Keep it in `workflow/` and import from engines — wrong layer, same problem as today conceptually. Rejected.

### 2. Claude engine passes raw prompt, no fallback resolution

**Decision**: Claude engine does NOT call the copilot resolver. If the Claude SDK cannot resolve `/opsx-propose` (because there is no `.claude/commands/opsx-propose.md` in the worktree), the prompt lands as literal text and Claude handles it as best it can — same behavior you'd get today if the prompt file was missing.

**Rationale**: The failure mode (SDK sees a literal `/opsx-propose`) is no worse than the current silent 0-token completion caused by resolution failing in the orchestrator. And for the intended use case (railyin workflow columns using `/opsx-*`), the worktree should have `.claude/commands/` equivalents if Claude SDK native behavior is desired. Otherwise, the column config should use plain text prompts.

**Alternatives considered**:
- Claude engine falls back to copilot resolver if SDK resolution fails — adds complexity, defeats the purpose (the SDK would have already processed the prompt by then). Rejected.

### 3. process.cwd() fallback stays in the dialect

**Decision**: The copilot resolver retains its two-step lookup: worktree `.github/prompts/` first, then `process.cwd()/.github/prompts/` (the railyin app repo). This is the correct semantic for railyin: built-in prompts (`/opsx-*`) live in the app, per-repo prompts live in the worktree.

### 4. resolved_content metadata removed, no replacement

**Decision**: Stop writing `resolved_content` / `display_content` to `conversation_messages.metadata`. The raw slash reference is the right display value and is already stored as the message content.

**Alternatives considered**:
- Engine emits a `prompt_resolved` event carrying original + expanded — adds a new event type for debug-only info. Rejected.

## Risks / Trade-offs

- **[Risk] Claude engine passes unresolvable slash on misconfigured worktrees** → Claude receives literal `/opsx-propose foo` text. Mitigation: the `hadOutput` guard added to orchestrator will surface a visible "no output" warning. Long-term mitigation: column validation could warn if a slash reference is configured for a Claude workspace with no `.claude/commands/` equivalent.
- **[Risk] Test for slash-prompt.ts has import path change** → Low risk, one file. Update path in test.
- **[Risk] workflow/engine.ts also calls resolveSlashReference** → Must be removed from both `orchestrator.ts` and `workflow/engine.ts` (the NativeEngine wrapper currently routes through `workflow/engine.ts`). Both call sites must be cleaned.

## Migration Plan

1. Move `slash-prompt.ts` → `engine/dialects/copilot-prompt-resolver.ts` (rename, no logic change).
2. Remove both `resolveSlashReference` call sites from orchestrator + workflow engine.
3. Remove `resolved_content` / `display_content` metadata writes.
4. Add `resolvePrompt()` call in Native engine before LLM dispatch.
5. Add `resolvePrompt()` call in Copilot engine before `session.send()`.
6. Claude engine: no change to prompt handling.
7. Update test import path.

No rollback complexity — this is a pure refactor with no DB migrations or API changes. Reverting means moving the resolver back to `workflow/` and re-adding the two call sites.

## Open Questions

- Should `workflow/engine.ts` (NativeEngine's underlying implementation) also be cleaned up, or will it eventually be replaced entirely by the extracted Native engine? Either way the call site there must be removed in this change to avoid double-resolution.
