## Why

The current LSP setup UX has multiple broken layers. The scan passes the workspace root to `lsp.detectLanguages` (which only scans depth-1) so it finds nothing in mono-repos. The project row badges are workspace-wide (same count for every project), not per-project. The `→` arrow navigates to a generic tab with no context. Users cannot see which specific language a project needs or install it in one click. Configured servers are not visible on the Language Servers tab. The setup card was too narrow to display all five tabs without clipping.

Some of these are now fixed (card width, configured servers list, `inConfig` accuracy). The remaining work — per-project language detection, meaningful badges, single-language install modal, scan fix — is captured here.

## What Changes

- **Projects tab auto-scans on mount** — fires `lsp.detectLanguages` per project in parallel; results cached in component state so repeat tab visits don't re-scan
- **Per-project language badges** replace the workspace-wide badge: green `TypeScript ✓` if the server is in config, orange `Java` if detected but not configured; multiple badges shown when a project has multiple languages; `—` when nothing detected
- **Orange badge is the CTA** — clicking it opens a small single-language install modal (not the full `LspSetupPrompt`); arrow `→` button removed
- **Single-language install modal** — shows server name, install options dropdown, Install / Add to config only / Cancel; reuses `lsp.runInstall` + `lsp.addToConfig` RPCs
- **`projects` field on `lsp.servers` entries** — written on install, scopes which task worktrees activate a given server; backward-compatible (`undefined` = all projects)
- **LS tab "Scan" fixed** — now scans all configured project paths (not workspace root); results feed into the existing `LspSetupPrompt` for multi-language install flow
- **LS tab shows configured servers** — already deployed; listed above the Scan button

## Capabilities

### New Capabilities
- `lsp-setup`: Per-project language detection + per-language install modal; auto-scan on Projects tab; `projects` scoping on server config entries

### Modified Capabilities
- `project-management`: Project row badges become per-project language indicators with install CTA; arrow button removed
- `lsp-setup` (existing): Scan fixed to use project paths; configured servers list already added

## Impact

- `src/shared/rpc-types.ts` — `lsp.servers` entry gains optional `projects?: string[]`; no other type changes needed
- `src/bun/lsp/manager.ts` — `LSPServerManager` respects `projects` when filtering servers for a task
- `src/bun/engine/claude/engine.ts` + `src/bun/engine/copilot/engine.ts` — filter server configs by task project key before passing to `taskLspRegistry.getManager`
- `src/mainview/views/SetupView.vue` — auto-scan on Projects tab activate; per-project badge rendering from cached scan results; remove arrow button; LS tab scan uses project paths
- `src/mainview/components/LspInstallModal.vue` — new small modal component for single-language install flow
