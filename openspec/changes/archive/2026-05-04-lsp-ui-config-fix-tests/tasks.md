## 1. Backend — TaskLSPRegistry Unit Tests

- [ ] 1.1 Add `describe("TaskLSPRegistry", ...)` block to `src/bun/test/lsp.test.ts`
- [ ] 1.2 Write SCENARIO-LWC-T1: first call invokes factory with configs and path
- [ ] 1.3 Write SCENARIO-LWC-T2: cache hit — factory called only once on repeated call with same path
- [ ] 1.4 Write SCENARIO-LWC-T3: stale path — old manager shut down, factory called again with new path
- [ ] 1.5 Write SCENARIO-LWC-T4: empty configs returns null, factory not called
- [ ] 1.6 Write SCENARIO-LWC-T5: releaseTask shuts down manager and evicts from cache
- [ ] 1.7 Write SCENARIO-LWC-T6: two scopes are independent (release one does not affect the other)

## 2. Backend — lspHandlers Integration Tests

- [ ] 2.1 Add `describe("lspHandlers", ...)` block to `src/bun/test/lsp.test.ts`; set up in-memory DB + `setupTestConfig` with `extraWorkspaces` for a second workspace
- [ ] 2.2 Write SCENARIO-LWC-T7: addToConfig writes to secondary workspace yaml only
- [ ] 2.3 Write SCENARIO-LWC-T8: runInstall calls fake installer with correct workspaceKey and writes config on success
- [ ] 2.4 Write SCENARIO-LWC-T9: runInstall does not write config when installer rejects
- [ ] 2.5 Write SCENARIO-LWC-T10: workspaceSymbol passes task's worktree_path to getManager
- [ ] 2.6 Write SCENARIO-LWC-T11: workspaceSymbol falls back to project path from workspace config when worktree_path is null
- [ ] 2.7 Write SCENARIO-LWC-T12: workspaceSymbol returns empty array when workspace has no lsp.servers

## 3. Backend — ExecutionParamsBuilder Unit Tests

- [ ] 3.1 Extend `src/bun/test/execution-params-builder.test.ts`: add case for SCENARIO-LWC-T13 — `build()` sets `workspaceKey` from task's workspace
- [ ] 3.2 Add case for `buildForChat()` — `workspaceKey` is set when task belongs to a non-default workspace

## 4. Backend — Orchestrator Integration Test

- [ ] 4.1 Extend `src/bun/test/orchestrator.test.ts`: add case for SCENARIO-LWC-T14 — capture `ExecutionParams.workspaceKey` via `CapturingEngine`; assert it matches the board's workspace

## 5. Playwright — Suite L (Configure LSP Button)

- [ ] 5.1 Add Suite `L` to `e2e/ui/workspace-settings.spec.ts`; set up mock project list with two projects
- [ ] 5.2 Write SCENARIO-PM-L1: "Configure LSP" button visible on each project row
- [ ] 5.3 Write SCENARIO-PM-L2: click captures `detectLanguages` call with correct project path
- [ ] 5.4 Write SCENARIO-PM-L3: empty languages response shows "no languages" feedback, no prompt
- [ ] 5.5 Write SCENARIO-PM-L4: languages response shows LspSetupPrompt
- [ ] 5.6 Write SCENARIO-PM-L5: capture `addToConfig` call includes correct `workspaceKey`
- [ ] 5.7 Write SCENARIO-PM-L6: dismiss stays on /setup
- [ ] 5.8 Write SCENARIO-PM-L7: two project rows call detectLanguages independently

## 6. Playwright — Suite LP (LspSetupPrompt dismissOnly)

- [ ] 6.1 Add Suite `LP` to `e2e/ui/workspace-settings.spec.ts`
- [ ] 6.2 Write SCENARIO-PM-LP1: default mode navigates to /boards after done
- [ ] 6.3 Write SCENARIO-PM-LP2: dismissOnly mode stays on /setup after done
