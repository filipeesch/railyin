---
last_mapped_commit: c8816b4c
---

# Technology Stack

**Analysis Date:** 2026-08-08

## Languages

**Primary:**
- TypeScript ~5.x (strict mode, ES2022 target, ESM, `allowImportingTsExtensions`) — the entire codebase: backend `src/bun/`, frontend `src/mainview/`, shared contract `src/shared/`, e2e suites `e2e/`. Config in `tsconfig.json`
- Vue 3 SFCs (`.vue` files, script setup style) — all UI components in `src/mainview/components/` and views in `src/mainview/views/`

**Secondary:**
- YAML — all runtime configuration: `config/workspace.yaml`, `config/engines.yaml`, `config/workflows/*.yaml`, `railyin.yaml`
- Shell (Bash) — `scripts/postinstall.ts` runs code-server's `postinstall.sh`; `shell-env.ts` executes the user's login shell
- Markdown — prompt files in `.github/prompts/*.prompt.md` (slash-command prompt refs)

## Runtime

**Environment:**
- [Bun](https://bun.sh) — the backend server and test runner. Server entry `src/bun/index.ts` boots via `bun run prod`; dev via `scripts/dev.ts` (`bun run dev`). Uses Bun built-ins: `Bun.serve` (HTTP + WebSocket), `bun:sqlite` (DB), `Bun.file`, `Bun.spawn`
- Node.js 20 — required only for code-server's postinstall (`scripts/postinstall.ts` sets `FORCE_NODE_VERSION: "20"`) and the VS Code extension tooling (`extensions/railyin-ref/`)

**Package Manager:**
- Bun (`bun install`) — lockfile `bun.lock` at repo root
- npm — legacy lockfile `package-lock.json` still present at root; the VS Code extension uses npm (`extensions/railyin-ref/package-lock.json`, `npx vsce package`)
- Registry config: `.npmrc` sets public `https://registry.npmjs.org/` as default (overriding an internal Nexus proxy) with `@quintoandar` scoped to `nexus.quintoandar.com.br`; `bunfig.toml` additionally routes `@xterm` and `@earendil-works` scopes to public npm

## Frameworks

**Core:**
- Vue 3.5 + Pinia 2 + vue-router 4 — frontend SPA in `src/mainview/`; Pinia stores in `src/mainview/stores/` (note: `vue`, `pinia`, `vue-router`, `primevue` are all listed under devDependencies in `package.json` — the app is bundled by Vite so runtime/peer deps live in devDependencies)
- PrimeVue 4 + PrimeIcons — UI component library (registered in `src/mainview/main.ts`)
- Bun.serve — backend HTTP/WebSocket server, no external web framework (`src/bun/index.ts` mounts all handlers)

**AI Agent SDKs (engines):**
- `@anthropic-ai/claude-agent-sdk` 0.3.204 — Claude engine (`src/bun/engine/claude/`)
- `@github/copilot-sdk` 0.3.0 — Copilot engine (`src/bun/engine/copilot/`)
- `@opencode-ai/sdk` 1.14.33 — OpenCode engine, in-process server (`src/bun/engine/opencode/`)
- `@cursor/sdk` 1.0.25 — Cursor engine, in-process (`src/bun/engine/cursor/`)
- `@earendil-works/pi-coding-agent` 0.80.3 (+ `pi-ai`, `pi-agent-core` transitively) — Pi engine (`src/bun/engine/pi/`)

**Testing:**
- Vitest 3 — frontend unit tests (`vitest.config.ts`) and backend tests via `bun test` (`vitest.backend.config.ts` uses vitest config shape but tests run under Bun)
- Playwright 1.59 — e2e UI + API suites (`playwright.config.ts`, `e2e/`)
- Stryker 9 — mutation testing (`stryker.backend.json`, `stryker.frontend.json`)

**Build/Dev:**
- Vite 6 + `@vitejs/plugin-vue` — frontend build (`vite.config.ts`: root `src/mainview`, outDir `dist/`, aliases `@` → `src/mainview`, `@shared` → `src/shared`)
- `concurrently` — dev process management (`scripts/dev.ts`)
- TypeScript project references: `tsconfig.json` (base), `tsconfig.frontend.json`, `tsconfig.backend.test.json`

## Key Dependencies

**Critical:**
- `code-server` 4.116.0 — VS Code-in-browser editor, spawned per project (`src/bun/launch/code-server.ts`), loads the bundled `extensions/railyin-ref/railyin-ref.vsix` extension
- `monaco-editor` 0.55 + `@monaco-editor/loader` — code editing UI (`FileEditorOverlay.vue`)
- `@codemirror/*` 6.x (autocomplete, commands, language, state, view) — chat/completion editors (`ChatEditor.vue`)
- `@xterm/xterm` 6 + `@xterm/addon-fit` + `@xterm/addon-web-links` — terminal UI over PTY WebSockets (`PtyTerminal.vue`, `src/bun/launch/pty.ts`)
- `better-sqlite3` 12 — devDependency ONLY, used as a `bun:sqlite` compatibility shim for Vite/Stryker runs (`src/bun/test/shims/bun-sqlite.ts`); production uses Bun's built-in `bun:sqlite`

**Infrastructure:**
- `ajv` 8 — JSON schema validation (tool args, config)
- `zod` 4 — runtime schema validation (Pi tool definitions)
- `js-yaml` 4 — YAML config loading
- `marked` 17 + `mermaid` 11 — markdown rendering and diagram rendering in chat
- `diff` 8 — file diff computation
- `minimatch` 10 + `@types/picomatch` — glob matching
- `@tanstack/vue-virtual` 3 — virtual scrolling in chat timeline
- `@iconify/vue` 5 — icon system
- `open` 11 — opens browser for OAuth flows
- `@types/bun` — Bun type definitions (`tsconfig.json` sets `types: ["bun-types"]`)

## Configuration

**Environment:**
- No `.env` file — configuration flows through YAML files, CLI flags, and process environment. `.env*` files are gitignored (`gitignore` line 19)
- Shell environment is resolved at startup from the user's login shell (`src/bun/shell-env.ts`, `RAILYN_CLI=1` skips it) so engines see the user's PATH
- Key env vars:
  - `RAILYN_DB` — SQLite path or `:memory:` (tests use `:memory:`)
  - `RAILYN_DATA_DIR` — overrides `~/.railyn` data dir
  - `RAILYN_CONFIG_DIR` — overrides config dir (default `config/` at repo root)
  - `RAILYN_WORKSPACES_DIR` — workspace registry location
  - `RAILYN_DEBUG`, `RAILYN_CLI`, `RAILYN_SHUTDOWN_GRACE_MS`, `RAILYN_STREAM_IDLE_TIMEOUT_MS`, `RAILYN_BUNDLED_WORKFLOWS_DIR`, `RAILYN_TEST_EXECUTION_ENGINE`
  - `ANTHROPIC_API_KEY`, `CURSOR_API_KEY` — provider keys with YAML `api_key` fallbacks

**Config files (runtime):**
- `config/engines.yaml` — global engine instances (required; engine types: `copilot`, `claude`, `opencode`, `cursor`, `pi`, plus `scripted` mock). Schema/validation in `src/bun/config/index.ts`
- `config/workspace.yaml` — per-workspace config (projects, worktrees, `search` for web search, `anthropic` cache/effort settings, `allowed_engines`, `default_model`)
- `config/workflows/*.yaml` — workflow/board definitions; bundled templates in `config/workflows/`, per-workspace copies seeded by `src/bun/config/workflows.ts`
- `railyin.yaml` — run profiles/launcher commands
- Global user config: `~/.railyn/config/config.yaml` (`config/config.yaml.sample`); data dir `~/.railyn/` (`src/bun/utils/platform.ts`)

**Build:**
- `vite.config.ts`, `tsconfig*.json`, `playwright.config.ts`, `vitest*.config.ts`, `stryker.*.json`, `bunfig.toml`

## Platform Requirements

**Development:**
- macOS/Linux primary; Windows handled explicitly in a few places (`isWindows()` in `src/bun/utils/platform.ts`, `scripts/postinstall.ts` skips code-server postinstall on win32)
- Bun (latest), Node 20 for code-server postinstall, `git` (worktree-based workflow), a login shell with user PATH
- Local model servers for the Pi engine: LM Studio (`http://localhost:1234/v1`), Ollama (`http://localhost:11434/v1`), or any OpenAI-compatible endpoint

**Production:**
- Self-hosted single process: `bun run prod` runs `src/bun/index.ts`, binds `127.0.0.1:3000` (override with `--port=`), serves built `dist/` + JSON-RPC-style `/api/*` + WebSocket `/ws`
- Persistent SQLite DB at `~/.railyn/railyn.db` (WAL mode)
- No external hosting/deployment target defined in-repo

---

*Stack analysis: 2026-08-08*
