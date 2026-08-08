---
last_mapped_commit: c8816b4c
---

# External Integrations

**Analysis Date:** 2026-08-08

## APIs & External Services

**LLM Providers (direct REST):**
- Anthropic API — `https://api.anthropic.com` (version header `2023-06-01`), used by the legacy AI provider layer `src/bun/ai/anthropic.ts` (`AnthropicProvider`): `/v1/messages` (stream + non-stream), `/v1/models`, `/v1/models/{id}` capabilities endpoint. Features: prompt caching (`cache_control` with `5m`/`1h` TTL), adaptive thinking (`output_config.effort`), `context_edit_strategy` (`clear_tool_uses_20250919`), rate-limit header tracking with cooldown (`updateCooldownFromHeaders`). Auth: `x-api-key` header from `providers.api_key` in workspace config or `ANTHROPIC_API_KEY` env
- OpenAI-compatible endpoints — `src/bun/ai/openai-compatible.ts` (`OpenAICompatibleProvider`) and Pi engine providers: `/v1/chat/completions` SSE streaming, `/v1/models`. Used for LM Studio (`http://localhost:1234/v1`), Ollama (`http://localhost:11434/v1`), vLLM, OpenRouter (`https://openrouter.ai/api/v1`), Groq, Mistral — configured per provider in `config/engines.yaml` (`config/engines.yaml.sample` documents the support matrix). Auth: `Bearer` header from `providers.<id>.api_key`
- Tavily Search API — `https://api.tavily.com/search`, called by the Pi engine's `search_internet` tool (`src/bun/engine/pi/tools/web.ts`). Config: `search.engine: tavily` + `search.api_key` in `config/workspace.yaml` (see `config/workspace.yaml.sample`). Only Tavily is supported as a search engine

**Coding-Agent SDKs (in-process/child-process):**
- Claude Agent SDK — `@anthropic-ai/claude-agent-sdk` 0.3.204, Claude engine `src/bun/engine/claude/adapter.ts`. Runs queries against the local `claude` CLI environment (uses `ANTHROPIC_API_KEY`/Claude Code auth from the user's environment; preserves `ANTHROPIC_API_KEY`, `HOME`, `PATH` for the child). Exposes Railyin tools to Claude as an SDK MCP server (`buildClaudeToolServer` in `src/bun/engine/claude/tools.ts`, `createSdkMcpServer`)
- GitHub Copilot SDK — `@github/copilot-sdk` 0.3.0, Copilot engine `src/bun/engine/copilot/` (`session.ts`, `engine.ts`). Uses Copilot's own auth/session (no Railyin-managed credential)
- OpenCode SDK — `@opencode-ai/sdk` 1.14.33, `createOpencodeServer`/`createOpencodeClient` run an in-process OpenCode server (`src/bun/engine/opencode/adapter.ts`). Providers configured in `engines.yaml` with `base_url`, `api_key`, optional `npm` package per provider — can route to Anthropic, OpenRouter, Ollama, LM Studio
- Cursor SDK — `@cursor/sdk` 1.0.25, in-process `Agent`/`Cursor` SDK (`src/bun/engine/cursor/inprocess-adapter.ts`). Auth: `api_key` in `engines.yaml` or `CURSOR_API_KEY` env (`src/bun/engine/cursor/adapter.ts`). Calls `Cursor.models.list({ apiKey })`; `AgentBusyError` recovery in `src/bun/engine/cursor/recovery.ts`
- Pi Coding Agent — `@earendil-works/pi-coding-agent` 0.80.3, Pi engine `src/bun/engine/pi/`. Provider transport + concurrency limiter in `src/bun/engine/pi/provider-transport.ts`; per-provider `max_inflight`/`queue_timeout_ms`; `thinkingFormat` compat (`openai|openrouter|deepseek|together|zai|qwen|chat-template|qwen-chat-template|string-thinking|ant-ling`) per `AGENTS.md`

## Data Storage

**Databases:**
- SQLite via Bun built-in `bun:sqlite` (`src/bun/db/index.ts`) — no ORM; raw SQL + typed repositories in `src/bun/db/repositories/` and `src/bun/db/task-repository.ts`
  - File: `~/.railyn/railyn.db` (or `RAILYN_DB`); `:memory:` for tests
  - Pragmas: `journal_mode = WAL`, `busy_timeout = 5000`, `foreign_keys = ON`
  - Migrations: 50+ sequential files in `src/bun/db/migrations/` (e.g. `044_mcp_disabled_by_default.ts`), run by `src/bun/db/migrations/runner.ts`
  - `better-sqlite3` 12 appears only in tests via the shim `src/bun/test/shims/bun-sqlite.ts` (Vite cannot resolve `bun:sqlite`)

**File Storage:**
- Local filesystem only: `~/.railyn/` data dir (DB, logs, worktrees), per-task git worktrees (`src/bun/git/WorktreeManager.ts`), session memory files

**Caching:**
- None external. Anthropic prompt caching via API params; in-process caches only (e.g. `CacheBreakTracker` in `src/bun/ai/anthropic.ts`, provider registry in `src/bun/ai/index.ts`)

## Authentication & Identity

**Auth Provider:**
- No user identity/auth for Railyin itself (single-user local app)
- **OAuth 2.0 client for MCP servers** — full PKCE + Dynamic Client Registration implementation in `src/bun/oauth/`:
  - `discovery.ts` (RFC 8414 metadata discovery), `pkce.ts`, `token-exchange.ts` (authorization_code grant), `token-provider.ts` (refresh), `token-store.ts` (persistence), `scope-resolution.ts`
  - Redirect URI: `http://localhost:${port}/api/mcp/oauth/callback` — loopback per RFC 8252 §7.3 (`src/bun/index.ts`); handles anonymous DCR with fallback to static `client_id`/`client_secret` for servers rejecting DCR (e.g. Keycloak) — `McpOAuthStaticClientConfig` in `src/bun/mcp/types.ts`
  - e2e coverage: `e2e/api/mcp-oauth.test.ts`

## Monitoring & Observability

**Error Tracking:**
- None external. `process.on("unhandledRejection"/"uncaughtException")` handlers in `src/bun/index.ts`; config errors broadcast to UI clients

**Logs:**
- File logging via console interception: `~/.railyn/logs/bun.log` with `.prev` rotation (`src/bun/server/file-logger.ts`)
- Structured logger abstraction `src/bun/logger.ts` (injected via DI; `realLogger` used in production)
- Usage/cost logging per model call (`logUsage` in `src/bun/ai/anthropic.ts`, hard-coded $/MTok pricing for Sonnet 4.6)

## CI/CD & Deployment

**Hosting:**
- Self-hosted local process (no cloud deployment config)

**CI Pipeline:**
- GitHub Actions: `.github/workflows/pr-checks.yml` — typecheck, `vite build`, backend tests (`bun test src/bun/test`), API smoke tests, Playwright e2e in 3 shards with `oven-sh/setup-bun@v1`; `.github/workflows/mutation.yml` — Stryker mutation runs. All on `ubuntu-latest`

## Environment Configuration

**Required env vars:**
- `ANTHROPIC_API_KEY` — Claude engine / Anthropic provider (fallback when `engines.yaml`/workspace `providers` omit `api_key`)
- `CURSOR_API_KEY` — Cursor engine (fallback when `engines.yaml` cursor entry omits `api_key`)
- `RAILYN_*` operational vars: `RAILYN_DB`, `RAILYN_DATA_DIR`, `RAILYN_CONFIG_DIR`, `RAILYN_WORKSPACES_DIR`, `RAILYN_DEBUG`, `RAILYN_CLI`, `RAILYN_BUNDLED_WORKFLOWS_DIR`, `RAILYN_SHUTDOWN_GRACE_MS`, `RAILYN_STREAM_IDLE_TIMEOUT_MS`, `RAILYN_TEST_EXECUTION_ENGINE` (see `STACK.md`)

**Secrets location:**
- No `.env` file used or committed; provider keys live in `config/engines.yaml` / workspace `providers` config (`api_key` fields) or process env
- OAuth tokens persisted locally (MCP token store in `src/bun/oauth/token-store.ts`)

## Webhooks & Callbacks

**Incoming:**
- `/api/mcp/oauth/callback` — MCP OAuth authorization-code redirect (`src/bun/index.ts` → `handleMcpOAuthCallback`)

**Outgoing:**
- None (no external webhook dispatch)

## Local Subsystem Integrations

**MCP (Model Context Protocol):**
- Built-in client supporting two transports: `stdio` (command + args + env) and Streamable HTTP (2025-06-18 spec, JSON or SSE responses) — `src/bun/mcp/client.ts`, `src/bun/mcp/types.ts`
- Config mirror of VS Code `mcp.json` format, loaded by `src/bun/mcp/config-loader.ts`; global + per-workspace registries (`src/bun/mcp/registry-pool.ts`, `registry.ts`); servers auto-start at boot (`registryPool.getGlobalRegistry().startAll()` in `src/bun/index.ts`); discovery tool in `src/bun/mcp/discovery-tools.ts`

**Language Servers (LSP):**
- Local subprocess LSP clients (`src/bun/lsp/`): typescript-language-server, pyright, rust-analyzer, gopls, jdtls (Java), kotlin-language-server, solargraph (Ruby) — registry + platform-aware install commands in `src/bun/lsp/registry.ts`, `installer.ts`

**VS Code / code-server:**
- Spawns `code-server` per project (port 3100+, binary from `node_modules/.bin`, PATH, or npx fallback) with the bundled `railyin-ref.vsix` extension installed (`src/bun/launch/code-server.ts`); extension source in `extensions/railyin-ref/` (VS Code extension "Send to Railyin", `cmd+shift+r`)

**Git:**
- Local git only: worktree creation at commit, task branch context, `git diff` computations (`src/bun/git/GitRepositoryManager.ts`, `WorktreeManager.ts`, `ProjectResolver.ts`); no GitHub API integration

**Terminal (PTY):**
- PTY sessions exposed over WebSocket `/ws/pty/*` (`src/bun/launch/pty.ts`, `terminal.ts`)

---

*Integration audit: 2026-08-08*
