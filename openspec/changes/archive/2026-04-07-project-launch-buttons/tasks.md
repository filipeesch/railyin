## 1. RPC Types & Config Schema

- [x] 1.1 Define `LaunchProfile`, `LaunchConfig` interfaces in `src/shared/rpc-types.ts`
- [x] 1.2 Add `launch.getConfig` and `launch.run` RPC method signatures to `rpc-types.ts`

## 2. Backend — Config Reader

- [x] 2.1 Create `src/bun/launch/config.ts` — reads and parses `railyin.yaml` from a project path, returns `LaunchConfig | null`
- [x] 2.2 Validate parsed entries (skip and warn on missing label/icon/command fields)

## 3. Backend — Terminal Detection

- [x] 3.1 Create `src/bun/launch/terminal.ts` — OS detection and terminal probe logic
- [x] 3.2 Implement macOS probe: iTerm2, Warp, Ghostty, Kitty via `/Applications/`, fallback to Terminal.app
- [x] 3.3 Implement Windows probe: `wt` via PATH, fallback to `cmd.exe`
- [x] 3.4 Implement Linux probe: `gnome-terminal`, `konsole`, `xfce4-terminal`, `kitty`, `xterm` via `which`
- [x] 3.5 Cache detection result in memory for the session

## 4. Backend — Launch Handler

- [x] 4.1 Create `src/bun/launch/launcher.ts` — builds the OS-specific terminal launch invocation and spawns it
- [x] 4.2 Implement macOS AppleScript path for Terminal.app and iTerm2; CLI-flag path for Warp/Ghostty/Kitty
- [x] 4.3 Implement Windows launch (`wt -d <cwd> ...` / `start cmd /k ...`)
- [x] 4.4 Implement Linux launch (terminal-specific `--working-directory` / `-e` flags)
- [x] 4.5 Register `launch.getConfig` RPC handler in `src/bun/handlers/` — resolves task → project → reads config
- [x] 4.6 Register `launch.run` RPC handler — resolves worktree path (or project path fallback), calls launcher

## 5. Frontend — Store & RPC Wiring

- [x] 5.1 Add `launch.getConfig` and `launch.run` calls to `src/mainview/rpc.ts`
- [x] 5.2 Create or extend a store (e.g., `useLaunchStore`) to hold per-project `LaunchConfig` keyed by project ID

## 6. Frontend — TaskCard

- [x] 6.1 Fetch launch config when TaskCard mounts (via store, deduplicated by project ID)
- [x] 6.2 Render plain `<Button>` when exactly one profile is configured
- [x] 6.3 Render `<SplitButton>` when two or more profiles are configured (first = primary, rest = menu items)
- [x] 6.4 Render one `<Button>` per tool when tools are configured
- [x] 6.5 Hide all launch controls when config is null or empty

## 7. Frontend — TaskDetailDrawer

- [x] 7.1 Reuse the same launch config from the store (already fetched by TaskCard or fetch on open)
- [x] 7.2 Render identical profile SplitButton/Button in the conversation panel area
- [x] 7.3 Render identical tool Buttons in the conversation panel area
- [x] 7.4 Apply same visibility rules as TaskCard (hide when no config)

## 8. Error Handling

- [x] 8.1 Show a toast notification if `launch.run` returns an error (e.g., no terminal found on Linux)
