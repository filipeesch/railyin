# Railyin

## Quick start

```bash
bun install
bun run build    # build frontend for `dist/` (prerequisite for UI tests)
bun run dev      # dev server (in-memory DB by default)
bun run prod     # prod server (persistent SQLite DB)
```

Dev and prod accept `--port=3001` to run on a different port, and `--real-db` to persist data.

`bun run prod` uses a persistent SQLite DB. For development with DB persistence, run `bun run dev -- --real-db`.

For production use, run `make run` (installs dependencies, builds the frontend, then starts the server).

## Testing

### Backend tests

```bash
bun test src/bun --timeout 20000
```

### Weights and measures

| Command | Description |
|---|---|
| `bun test src/bun --timeout 20000` | All Bun backend tests (vitest) |
| `bun test src/bun/test/orchestrator.test.ts` | Single backend test file |
| `bun test src/mainview/stores/conversation.test.ts` | Frontend unit test |
| `bun test e2e/api --timeout 30000` | API smoke tests |
| `bun run test:e2e` | Full Playwright suite (builds first) |
| `bun run test:e2e:chat` | Single Playwright spec: chat |
| `bun run test:mutation` | Stryker mutation tests |

### UI tests

UI tests run against `dist/` served by `vite preview` — no Bun server involved. All `/api/*` endpoints are mocked via `page.route()` in `e2e/ui/fixtures/mock-api.ts`.

| Command | Description |
|---|---|
| `bun run build` | Build frontend before running UI tests |
| `bun run test:e2e` | Run all Playwright specs in `e2e/ui/` |
| `bun run test:e2e:chat` | Single Playwright spec: chat |
| `bun run test:e2e:board` | Single Playwright spec: board |

Run `bun run build` first — Playwright config spares `dist/` via `vite preview` and handles the rest.

## Copilot & Claude Engines

To use either the GitHub Copilot or Claude Code engine, add it to `config/engines.yaml`:

```yaml
engines:
  - id: copilot
    type: copilot
  - id: claude
    type: claude
```

You must be **authenticated** before use. Read [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli#authenticate-with-login) or [Claude Code](https://code.claude.com/docs/en/authentication#log-in-to-claude-code) documentation for more information.

## Troubleshooting

### Tools not found in `.app` builds

When running the canary or stable `.app` bundle on macOS or Linux, the AI agent may report "command not found" for tools like `npm`, `cargo`, `rg`, or custom CLIs, even though they work fine in your terminal.

**Cause**: `.app` bundles receive a stripped environment from the OS with only a minimal PATH. Railyin captures your full shell environment at startup to fix this, but there may be issues.

**Solution**:
1. Check the startup logs: `cat ~/.railyn/logs/bun.log | grep shell-env`
2. Verify the resolved PATH contains your tool paths (homebrew, nvm, cargo, etc.)
3. If the shell resolution timed out, check your `.zshrc` or `.bashrc` for slow commands; you can increase the timeout in `workspace.yaml`:
   ```yaml
   shell_env_timeout_ms: 15000  # 15 seconds instead of 10
   ```
4. If a tool is still missing, you can add its path explicitly to `workspace.yaml`:
   ```yaml
   extra_paths:
     - /opt/homebrew/bin
     - ~/.cargo/bin
   ```

### Performance

If app startup feels slow in dev mode, you can skip shell environment resolution:

```bash
bun run dev
# Already has RAILYN_CLI=1 set, so shell resolution is skipped
```

For `.app` builds, the ~100–300ms startup cost is worth the tool visibility improvement.


