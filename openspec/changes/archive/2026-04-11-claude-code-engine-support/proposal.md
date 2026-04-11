## Why

Railyin already supports a pluggable execution-engine layer, but users who prefer Claude Code still cannot run that engine inside the product. The current native engine requires provider keys and the Copilot engine covers only GitHub Copilot. We want Claude users to bring their existing Claude subscription and get the same Claude Code project experience inside Railyin: `CLAUDE.md`, skills, slash commands, Claude's built-in tools, and Claude-managed sessions.

The missing piece is not only a third engine type. Claude's Agent SDK can pause mid-turn for permission requests and `AskUserQuestion`, which means the shared non-native engine contract must treat interactive suspension and resumption as first-class behavior. That shared contract is needed for Claude now and should later be reused by Copilot in a follow-up change.

## What Changes

- Add a new `engine.type: claude` execution backend implemented with `@anthropic-ai/claude-agent-sdk`.
- Configure the Claude engine to run with Claude Code presets and project settings so project-local Claude Code features such as `CLAUDE.md`, skills, and slash commands work natively instead of being reimplemented by Railyin.
- Extend the shared non-native engine/orchestrator contract so SDK-backed engines can surface permission requests and user questions, persist them as conversation messages, pause in `waiting_user`, and resume the same execution after the user responds.
- Register Railyin's engine-agnostic task-management tools with the Claude engine while relying on Claude's own built-in file, shell, search, edit, and agent tools for everything else.
- Add deterministic Claude SDK adapter tests and backend scenario coverage for session resume, built-in/custom tool execution, interactive pauses, and model listing.

## Capabilities

### New Capabilities
- `claude-engine`: Claude Agent SDK integration with Claude Code presets, project feature loading, model listing, session management, event translation, and shared-tool registration.

### Modified Capabilities
- `execution-engine`: Non-native engines gain a resumable interactive pause contract for approval requests and user questions.
- `engine-common-tools`: Shared task-management tools must be registerable in the Claude engine without replacing Claude's built-in toolset.
- `multi-provider-config`: Workspace engine config must support `engine.type: claude` with minimal engine-specific fields.
- `model-selection`: Model listing and per-task model selection must support Claude engine model IDs and provider grouping.

## Impact

- Affected code: `src/bun/engine/types.ts`, `src/bun/engine/resolver.ts`, `src/bun/engine/orchestrator.ts`, `src/bun/handlers/tasks.ts`, a new `src/bun/engine/claude/` tree, Claude SDK test support, and model/config loading paths.
- Affected dependencies: add `@anthropic-ai/claude-agent-sdk`.
- Affected behavior: non-native waiting-user flows become resumable within the same execution instead of being treated only as terminal pauses.
- Follow-up boundary: Copilot should adopt the new shared approval flow in a separate change/task after this contract lands.
