## Why

Railyin needs a first-class engine for local LLMs (Qwen, Llama, Mistral via LM Studio/Ollama) — models with unlimited tokens but limited capability. The existing engines (Copilot, Claude, OpenCode) assume strong models with large context budgets; using them with weak local models produces poor results and wastes context. Pi SDK (`@mariozechner/pi-coding-agent`) provides a model-agnostic agentic loop with compaction and session management, making it the right foundation. On top of Pi, we need a "harness" — a curated tool set with context-saving mechanisms — to get reliable output from smaller models.

## What Changes

- **New engine**: `PiEngine` implementing `ExecutionEngine`, registered in `engineFactories`, configurable via `engines.yaml`
- **New tool set**: Revived Railyin-native file/search/shell tools (`read_file`, `glob`, `write_file`, `patch_file`, `delete_file`, `rename_file`, `undo_write`, `search_text`, `run_command`, `fetch_url`, `search_internet`) — all Pi built-ins hidden, replaced with our own. `glob` is a unified file+directory finder that replaces both `find_files` and `list_dir` from the old native engine (`type: "file"|"dir"|"any"`, `limit=100`, `offset` pagination).
- **Content hash cache**: Read and search tools return `[unchanged]` when file/result content hasn't changed since last send — prevents re-filling context with already-seen content
- **Undo stack**: Every write operation returns an `op:XXXX` id; `undo_write` reverts any write by id or path — enables the model to self-correct without a full re-read/re-write cycle
- **Tool descriptions as harness instructions**: NEVER/ALWAYS imperative language in every tool description enforces shell-as-read-only and undo usage patterns — no separate system prompt injection
- **Session persistence**: Pi sessions stored as JSONL trees per worktree path; one session per `conversationId` for clean context isolation

## Capabilities

### New Capabilities
- `pi-engine`: Pi SDK integration as a Railyin `ExecutionEngine` — session lifecycle, event translation, model configuration, tool injection
- `pi-native-tools`: Complete Railyin-owned tool set for Pi — file I/O, `glob` (unified file+dir finder replacing old `find_files`+`list_dir`), search, shell, web, board tools; replaces all Pi built-ins
- `content-hash-cache`: Per-conversation file/search hash cache that suppresses unchanged content responses to conserve context window
- `undo-write`: Per-conversation undo stack for write operations; addressable by `operationId` or file path; max 50 entries

### Modified Capabilities
- `engines-config`: Add `PiEngineConfig` type (`type: "pi"`, `model?`, `providers?`, `harness?`) to the engine config union

## Impact

- **New dependency**: `@mariozechner/pi-coding-agent` (npm package, not yet installed)
- **New files**: `src/bun/engine/pi/` directory tree (engine, config, event-translator, session-manager, harness/, tools/)
- **Modified**: `src/bun/config/index.ts` — `EngineConfig` union gets `PiEngineConfig`
- **Modified**: `src/bun/index.ts` — `engineFactories` map gets Pi factory entry
- **No breaking changes** to existing engines or API contracts
- **Board tasks deferred**: `spawn_agent` tool design (task #383), web tool improvements (task #384)
