## Why

The Pi engine fails to inject skills into the system prompt when configured with the `copilot` dialect, even though skills are correctly loaded into memory. This means skill files in `.github/skills/` are invisible to the LLM in every Pi conversation — a silent data loss with no error surfaced to the user.

## What Changes

- Add `"read"` (Pi SDK built-in) to the `tools` allowlist in `createAgentSession`, satisfying the SDK's `selectedTools.includes("read")` guard that gates skill injection into the system prompt.
- Remove `"read_file"` (our custom worktree-confined tool) from the `tools` allowlist to avoid presenting two conflicting file-read tools to the LLM. The tool code is kept; it is just no longer injected.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pi-engine`: The Pi engine's tool allowlist now includes `"read"` (SDK built-in) and excludes `"read_file"` (custom). Skills from `additionalSkillPaths` are now correctly appended to the system prompt at session creation.

## Impact

- **Code**: `src/bun/engine/pi/engine.ts` — `getOrCreateSession` tools array only.
- **Behaviour**: Pi sessions with a `copilot` dialect (or any dialect returning skill paths) will now receive skills in their system prompt, matching the Copilot engine's behaviour.
- **No API changes**, no DB migrations, no YAML config changes.
- **`additionalSkillPaths` in `DefaultResourceLoader` is unchanged** — explicit `/skill:name` invocation continues to work.
