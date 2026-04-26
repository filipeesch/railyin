# Copilot Instructions

## Build and test commands

- Install dependencies with `bun install`.
- Build the frontend bundle with `bun run build`.
- Run the main backend test suite with `bun test src/bun/test --timeout 20000`.
- Run a single backend test file with `bun test src/bun/test/orchestrator.test.ts --timeout 20000`.
- Run API smoke tests with `bun test e2e/api --timeout 30000`.
- Run a single API test file with `bun test e2e/api/smoke.test.ts --timeout 30000`.
- Run targeted frontend Bun tests with `bun test src/mainview/stores/conversation.test.ts`.
- Run the Playwright UI suite with `bun run build && npx playwright test e2e/ui`.
- Run a single Playwright spec with `bun run build && npx playwright test e2e/ui/chat.spec.ts`.
- There is no dedicated lint script in `package.json`.

## High-level architecture

- `src/bun` is the Bun backend. `src/bun/index.ts` boots the app by resolving the shell environment, running SQLite migrations, loading workspace/workflow config, starting MCP servers from `~/.railyn/mcp.json`, mounting `/api/*` and `/ws`, and serving the built `dist/` frontend.
- `src/mainview` is the Vue 3 + Pinia frontend. `App.vue` wires the shared WebSocket stream into domain stores, and `views/BoardView.vue` is the main shell for boards, drawers, review, terminal, and chat UI.
- `src/shared/rpc-types.ts` is the typed contract between frontend and backend. The frontend transport in `src/mainview/rpc.ts` uses typed POST calls for RPC methods and a reconnecting WebSocket for push events like `stream.event`, `task.updated`, and `message.new`.
- Task execution flows through `src/bun/engine/orchestrator.ts`. Workflow transitions create executions, append conversation messages, select the active engine per workspace, and stream incremental events that are both pushed to the UI and persisted.
- Repository behavior is heavily config-driven. `config/workspace.yaml(.sample)` defines workspace/project/engine settings, and `config/workflows/*.yaml` defines board columns, grouped lanes, prompts, tool scopes, and WIP limits.

## Key conventions

- Treat `src/shared/rpc-types.ts` as the source of truth for API and push payloads. When you add or change a method/event, update the shared type, the backend handler in `src/bun/handlers/*`, and the frontend consumer in `src/mainview/rpc.ts` or the relevant Pinia store.
- Prefer changing workflow behavior in YAML and prompt files before hardcoding it in Vue or Bun. Column IDs, `on_enter_prompt`, `stage_instructions`, tool availability, and grouped board lanes all come from `config/workflows/*.yaml`.
- Slash prompt references are first-class. Workflow config and task chat can reference `.github/prompts/*.prompt.md` using `/prompt-name`; the reference must be the whole leading value, not inline prose.
- The conversation UI has two layers: persisted `conversation_messages` and live stream blocks assembled from WebSocket events in `src/mainview/stores/conversation.ts`. Streaming changes need to preserve both live rendering and the reload-on-`done` path.
- UI Playwright tests are intentionally frontend-only. `playwright.config.ts` serves `dist/` with `vite preview`, while `e2e/ui/fixtures/mock-api.ts` and WebSocket mocks intercept backend traffic. When UI features add API calls or push events, extend the mocks instead of assuming a real Bun server in Playwright.
- Task movement is not just UI state. `tasks.transition` enforces column limits from workflow YAML, can trigger worktree setup/git context wiring, and may start an execution through the orchestrator. Keep task lifecycle changes aligned across handlers, DB state, and board UI.
