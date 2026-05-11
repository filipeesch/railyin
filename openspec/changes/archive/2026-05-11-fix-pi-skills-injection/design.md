## Context

The Pi engine integrates with the Pi SDK (`@earendil-works/pi-coding-agent`) via `createAgentSession`. One of the parameters is a `tools` array that acts as an allowlist — only tools named in this array are registered in the SDK's tool registry and presented to the LLM.

Internally, the Pi SDK's `buildSystemPrompt` guards skill injection with:
```js
const customPromptHasRead = !selectedTools || selectedTools.includes("read");
if (customPromptHasRead && skills.length > 0) {
    prompt += formatSkillsForPrompt(skills);
}
```

The current `tools` array includes `"read_file"` (our worktree-confined custom read tool) but not `"read"` (Pi SDK built-in). This means the guard is always `false`, and skills loaded from `additionalSkillPaths` in `DefaultResourceLoader` are never appended to the system prompt — even when the `copilot` dialect has correctly resolved skill paths.

Skills serve a dual purpose in the Pi SDK:
1. **System prompt injection** — appended to the prompt via `formatSkillsForPrompt`
2. **Explicit invocation** — `resourceLoader.getSkills()` is used to fulfil `/skill:name` commands

The fix must address (1) without breaking (2).

## Goals / Non-Goals

**Goals:**
- Skills from `.github/skills/` are injected into the Pi system prompt when a dialect returns skill paths
- No breaking change to explicit `/skill:name` invocation
- No path-traversal security regression

**Non-Goals:**
- Changing how dialects discover skill paths
- Hot-reloading skills into an existing session
- Adding skills support to non-Pi engines

## Decisions

### Add `"read"` to the tools allowlist

**Decision:** Add the Pi SDK's built-in `"read"` tool to the `createAgentSession` tools allowlist.

**Rationale:** The SDK's skill injection guard (`selectedTools.includes("read")`) is satisfied only when `"read"` is in the allowlist. This is the intended API surface — the SDK couples skill injection to read capability. Adding `"read"` is the minimal, semantically correct fix.

**Alternative considered:** Pre-loading skills manually with `loadSkills()` + `formatSkillsForPrompt()` and appending to `systemPromptOverride`. Rejected because it duplicates the SDK's internal skill formatting, must be kept in sync with SDK changes, and would require handling the existing-session path separately.

### Remove `"read_file"` from the tools allowlist

**Decision:** Remove the custom `"read_file"` tool from the `createAgentSession` tools allowlist (code is kept, not injected).

**Rationale:** With both `"read"` (SDK built-in) and `"read_file"` (custom) present, the LLM sees two overlapping file-read tools with different path restrictions. This causes ambiguity and likely degrades tool selection quality. Since `"read"` is now being added for skill injection, `"read_file"` is redundant in the allowlist.

**Risk:** The SDK's built-in `"read"` has no worktree path-traversal protection. However: (a) Pi sessions already run with shell access (`run_command`) which can read any file, so the security model relies on the worktree boundary at the session level, not per-tool; (b) removing `"read_file"` from the allowlist while keeping the code is trivially reversible.

### Keep `additionalSkillPaths` in `DefaultResourceLoader`

**Decision:** Retain `additionalSkillPaths` so the SDK's `resourceLoader.getSkills()` returns the correct skill list for `/skill:name` invocation.

**Rationale:** The SDK checks `_resourceLoader.getSkills().skills` at line ~1698 of `agent-session.js` to resolve explicit skill invocations. Removing `additionalSkillPaths` would silently break this feature.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| SDK's `"read"` guard changes in a future Pi SDK version | Fix is minimal; if guard changes, skills stop injecting again — a visible regression caught by any Pi conversation test |
| `"read"` exposes broader file access than `"read_file"` | Pi sessions already have shell access; per-tool path restriction was defence-in-depth, not the primary boundary |
| Existing sessions (reused across executions) don't rebuild their system prompt | Skills are only set at session creation time — this is pre-existing behaviour, not introduced by this fix |

## Migration Plan

No DB migrations, config changes, or API changes. The fix is a one-line change to the `tools` array in `getOrCreateSession`. Existing Pi sessions in memory will not be affected until they are recreated (conversation restart or server restart).
