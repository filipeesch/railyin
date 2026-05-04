## 1. Backend: `inConfig` support

- [x] 1.1 Add `isServerInConfig(workspaceYamlPath: string, serverName: string): boolean` to `src/bun/lsp/config-writer.ts` — reads YAML and returns true if `lsp.servers` contains an entry with the given name
- [x] 1.2 Add `workspaceKey: string` to `lsp.detectLanguages` params in `src/shared/rpc-types.ts`
- [x] 1.3 Add `inConfig: boolean` to `LspDetectedLanguage` in `src/shared/rpc-types.ts`
- [x] 1.4 Update `detectLanguages` handler in `src/bun/handlers/lsp.ts` to accept `workspaceKey`, call `getConfigDir(workspaceKey)` to get the yaml path, call `isServerInConfig` per detected language, and include `inConfig` in each result

## 2. Frontend: `LspSetupPrompt` inConfig awareness

- [x] 2.1 Update `LspSetupPrompt.vue` to hide the "Add to workspace config" button when `lang.inConfig === true` and show a "✓ In config" indicator instead
- [x] 2.2 Update all callers of `lsp.detectLanguages` in the frontend to pass `workspaceKey` in the params

## 3. Frontend: Language Servers tab

- [x] 3.1 Add a "Language Servers" tab to `SetupView.vue` (insert after Projects, before Boards; update `onTabChange` if needed)
- [x] 3.2 Implement the tab body: empty-state with "Scan for languages" button; on click call `lsp.detectLanguages` with workspace root path and active workspace key; show `LspSetupPrompt` when languages are detected
- [x] 3.3 Add a hint when scan returns no languages and workspace path is not set: "No languages detected. Make sure your Workspace path is set correctly."
- [x] 3.4 Import and wire `LspSetupPrompt` in the Language Servers tab section (pass detected languages, project path as workspace path, workspace key)

## 4. Frontend: Projects tab cleanup

- [x] 4.1 Add LSP status badge to each project row: a PrimeVue `Tag` showing "N LSP" (success) or "No LSP" (secondary) based on `workspaceStore` configured server count or a derived computed from the workspace config
- [x] 4.2 Replace the gear `⚙️` LSP button with a shortcut button (`pi-arrow-right` or `pi-external-link`) that switches `activeTab` to the Language Servers tab index
- [x] 4.3 Remove all inline `LspSetupPrompt` rendering from the Projects tab: remove the `v-if="showLspPrompt"` block and `noLspLanguagesProject` message
- [x] 4.4 Remove now-unused state and handlers from `SetupView.vue`: `showLspPrompt`, `showLspPromptForExisting`, `noLspLanguagesProject`, `onLspPromptDone`, `openLspForProject`, `lspLanguages`, `lastRegisteredPath`, and the auto-show logic in `onProjectSave`

## 5. Workspace store: LSP server count

- [x] 5.1 Expose `lspServerCount` (number) from the workspace store or as a local computed in `SetupView.vue` — reads from `workspaceStore.config.lsp?.servers?.length ?? 0` so the Projects tab badge needs no extra RPC call

## 6. Per-project language detection + badges

- [ ] 6.1 Add `projectLanguages: Map<string, { scanned: boolean; languages: LspDetectedLanguage[] }>` reactive state to `SetupView.vue`
- [ ] 6.2 On Projects tab activate (first time only), fire `lsp.detectLanguages` in parallel for all projects; store results in `projectLanguages` keyed by `project.key`; show a per-row spinner while scanning
- [ ] 6.3 Replace the workspace-wide badge on each project row with per-language badges derived from `projectLanguages[p.key]`: green `TypeScript ✓` when `inConfig`, orange `TypeScript` when not; show `—` when no languages detected; show spinner while unscanned
- [ ] 6.4 Remove the `→` arrow button from each project row (orange badge is the CTA)

## 7. Single-language install modal (`LspInstallModal.vue`)

- [ ] 7.1 Create `src/mainview/components/LspInstallModal.vue` — PrimeVue Dialog modal accepting `lang: LspDetectedLanguage`, `projectPath: string`, `workspaceKey: string` props and emitting `done` / `cancel`
- [ ] 7.2 Modal shows server name, install-options dropdown (or single option displayed inline), Install button and "Add to config only" button, Cancel button; reuses `lsp.runInstall` + `lsp.addToConfig` RPCs
- [ ] 7.3 On Install: run `lsp.runInstall`, show inline output/spinner, on success call `lsp.addToConfig`, emit `done`
- [ ] 7.4 On "Add to config only": call `lsp.addToConfig` directly, emit `done`
- [ ] 7.5 Wire modal in `SetupView.vue`: clicking an orange language badge opens the modal for that language + project; on `done` refresh `projectLanguages` entry by re-scanning that project

## 8. Fix LS tab scan to use project paths

- [ ] 8.1 Update `scanLanguages()` in `SetupView.vue` to iterate over all configured projects and call `lsp.detectLanguages` per project path (not workspace root); merge results deduplicating by `entry.serverName`
- [ ] 8.2 Remove the `wsForm.workspacePath || lastKnownProjectPath` fallback — if no projects are configured, show a hint to add projects first

## 9. Backend: `projects` scoping on lsp.servers entries

- [ ] 9.1 Add optional `projects?: string[]` to `LspServerConfig` interface in `src/bun/lsp/manager.ts` and to the workspace config type in `src/shared/rpc-types.ts`
- [ ] 9.2 Update `lsp.addToConfig` / `config-writer.ts` to write `projects` field when provided (pass project key from `LspInstallModal`)
- [ ] 9.3 In `src/bun/engine/claude/engine.ts` and `src/bun/engine/copilot/engine.ts`, filter `config.workspace.lsp?.servers` to only those with no `projects` field or whose `projects` includes the current task's project key before passing to `taskLspRegistry.getManager`
