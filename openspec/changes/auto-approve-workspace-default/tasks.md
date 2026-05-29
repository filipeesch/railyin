## 1. Config & Type Layer

- [ ] 1.1 Add `shell_auto_approve?: boolean` to `WorkspaceYaml` interface in `src/bun/config/index.ts`
- [ ] 1.2 Add `shellAutoApprove: boolean` to `WorkspaceConfig` interface in `src/shared/rpc-types.ts`
- [ ] 1.3 Add `shellAutoApprove?: boolean` to `workspace.update` params in `src/shared/rpc-types.ts`

## 2. Backend Handlers

- [ ] 2.1 Map `config.workspace.shell_auto_approve ?? false` to `shellAutoApprove` in `workspace.getConfig` handler (`src/bun/handlers/workspace.ts`)
- [ ] 2.2 Persist `shellAutoApprove` via `patchWorkspaceYaml` in `workspace.update` handler (`src/bun/handlers/workspace.ts`)
- [ ] 2.3 Seed `shell_auto_approve` from workspace config in `tasks.create` handler (`src/bun/handlers/tasks.ts`) — read `getWorkspaceConfig(workspaceKey).workspace.shell_auto_approve` and pass it into the INSERT

## 3. Frontend

- [ ] 3.1 Add `shellAutoApprove` to `wsForm` reactive object and `syncWsForm` in `src/mainview/views/SetupView.vue`
- [ ] 3.2 Add the toggle UI element after the worktree base path field in `SetupView.vue`
- [ ] 3.3 Include `shellAutoApprove` in the `saveWorkspaceSettings` call in `SetupView.vue`
- [ ] 3.4 Pass `shellAutoApprove` through `workspaceStore.update()` in `src/mainview/stores/workspace.ts`
