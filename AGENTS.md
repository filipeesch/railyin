# Railyin - Agent Guide

## Setup & Build

```bash
bun install
bun run dev       # dev server (in-memory DB by default)
bun run prod     # production server
bun run build    # build frontend for `dist/`
```

Dev and prod can use `--port=3001` to run on a different port, or `--real-db` to persist data.

Types & path aliases (`vitest.config.ts`): `@` → `src/mainview/`, `@shared` → `src/shared/`, `@bun` → `src/bun/`. Config references `aliases` and `include` patterns accordingly.

## Testing

| Command | Description |
|---|---|
| `bun test src/bun --timeout 20000` | All Bun backend tests (vitest) |
| `bun test src/bun/test/orchestrator.test.ts` | Single backend test file |
| `bun test src/mainview/stores/conversation.test.ts` | Frontend unit test |
| `bun test e2e/api --timeout 30000` | API smoke tests |
| `bun run test:e2e` | Full Playwright suite (builds first) |
| `bun run test:e2e:chat` | Single Playwright spec |
| `bun run test:mutation` | Stryker mutation tests |

### UI tests (Playwright)

UI tests run against `dist/` served by `vite preview` — no Bun server involved. All `/api/*` endpoints are mocked via `page.route()` in `e2e/ui/fixtures/mock-api.ts`.

| Command | Description |
|---|---|
| `bun run build` | Build frontend before running UI tests |
| `bun run test:e2e` | Run all Playwright specs in `e2e/ui/` |
| `bun run test:e2e:chat` | Single Playwright spec: chat |
| `bun run test:e2e:board` | Single Playwright spec: board |

Run `bun run build` first — Playwright config spares `dist/` via `vite preview` and handles the rest.

## Architecture

- **Backend**: `src/bun/index.ts` boots the app — resolves shell env, runs SQLite migrations, loads `config/workspace.yaml` + `config/workflows/*.yaml`, starts MCP servers, mounts `/api/*` and `/ws`, serves `dist/`.
- **Frontend**: Vue 3 + Pinia (`src/mainview/`). `App.vue` wires WebSocket stream into Pinia stores.
- **Shared contract**: `src/shared/rpc-types.ts` — source of truth for API & push events. Update types, backend handlers (`src/bun/handlers/*`), and frontend consumers (`src/mainview/rpc.ts` or Pinia stores) together.
- **Execution**: `src/bun/engine/orchestrator.ts` — workflow transitions create executions, select engine per workspace, stream events to UI & DB.

## Conventions

- **Config-driven**: Workflow behavior lives in YAML (`config/workspace.yaml`, `config/workflows/*.yaml`). Column IDs, `on_enter_prompt`, tool scopes, WIP limits are all config. Hardcoding workflow logic is usually wrong.
- **Prompt refs**: `.github/prompts/*.prompt.md` files are referenced as `/prompt-name`. The reference must be the entire leading value, not inline prose.
- **Conversation UI**: Two layers — persisted `conversation_messages` + live stream blocks from WebSocket events (`src/mainview/stores/conversation.ts`). Changes must preserve both.
- **Task movement**: Not just UI state. `tasks.transition` enforces column limits, may trigger worktree setup / git context / execution. Keep lifecycle changes across handlers, DB state, and board UI aligned.
- **Playwright UI tests intercept backend traffic** via `e2e/ui/fixtures/mock-api.ts` and mock events. Add API calls or push events to the mocks, not the real Bun server.

## Gotchas

- Default DB state is **in-memory** when using `--real-db` flag. Without it, data persists since `bun run prod` uses the SQLite DB by default.
- Shell env resolution at startup is required for tool visibility in `.app` bundles. If slow, set `RAILYN_CLI=1` to skip it.
- Playwright runs headless by default in parallel (`fullyParallel: true`). The `webServer` config starts `vite preview` on `dist/` before each test run.
- Mutation testing uses Stryker (`stryker.backend.json` / `stryker.frontend.json`). Runs separately from normal test suites.
