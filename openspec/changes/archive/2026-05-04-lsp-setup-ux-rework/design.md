## Context

SetupView.vue has 5 tabs: Workspace, Projects, Language Servers, Boards, Models (phase 1 complete).

Phase 1 delivered: Language Servers tab, `inConfig` backend fix, `LspSetupPrompt` awareness, configured-servers list, setup card width fix, `lsp.detectLanguages` workspace-key param.

Phase 2 (current): Per-project language detection with cached async scan, per-language badges on project rows, single-language install modal, fix scan to use project paths, `projects` scoping on server config entries.

## Goals / Non-Goals

**Goals:**
- Auto-scan project languages on Projects tab mount; cache results so re-visits don't re-scan
- Show per-project per-language badges (green if configured, orange if not) — multiple per row
- Orange badge is the CTA: opens a small single-language install modal
- Fix the LS tab "Scan for languages" to scan actual project paths (not workspace root)
- Add `projects?: string[]` to `lsp.servers` entries to scope servers to specific projects

**Non-Goals:**
- Different LSP configuration per project (config remains workspace-scoped; `projects` scopes activation only)
- Recursive file scanning beyond depth-1 (existing behaviour)

## Decisions

### 1. Per-project scan caching
`projectLanguages: Ref<Map<string, { scanned: boolean; languages: LspDetectedLanguage[] }>>` in `SetupView.vue` component state. Populated on first Projects tab activate via parallel `lsp.detectLanguages` calls keyed by `project.key`. Re-scan only if the workspace switches. Per-row spinner while unscanned.

### 2. Per-project badge rendering
Replace the single workspace-wide `Tag` with a `v-for` over `projectLanguages[p.key].languages`:
- `inConfig === true` → green Tag `"TypeScript ✓"` (severity="success")
- `inConfig === false` → orange Tag `"TypeScript"` (severity="warn") — clickable, opens install modal
- Not yet scanned → small spinner icon
- Scanned, no languages → `—` muted text

Multiple badges shown inline when project has multiple detected languages.

### 3. Arrow button removed
The `pi-arrow-right` shortcut button is removed from the project row. The orange badge is the sole CTA for uninstalled LSPs. The Language Servers tab remains accessible via the tab strip.

### 4. `LspInstallModal.vue` — new small modal
Props: `lang: LspDetectedLanguage`, `projectKey: string`, `projectPath: string`, `workspaceKey: string`. Emits: `done`, `cancel`.

UI:
- Header: "Install LSP for {lang.entry.name}?"
- Server name shown
- Install options: if `lang.installOptions.length > 1` show a Select dropdown, else show inline
- Buttons: Install (primary) | Add to config only (secondary) | Cancel (text)
- On Install: call `lsp.runInstall`, show inline streaming output/spinner, on success call `lsp.addToConfig({ ..., projectKey })`, emit `done`
- On Add to config only: call `lsp.addToConfig({ ..., projectKey })`, emit `done`

### 5. LS tab scan fix
`scanLanguages()` iterates `workspaceStore.projects` and calls `lsp.detectLanguages` per project path in parallel. Results are merged, deduplicating by `serverName`. If no projects configured, show hint: "Add projects first to enable language detection."

### 6. `projects` field on `lsp.servers`
`lsp.addToConfig` gains optional `projectKey?: string` param. When provided, `config-writer.ts` writes `projects: [projectKey]` to the new server entry (or appends to existing entry's `projects` array). Backward-compatible: entries without `projects` apply to all tasks.

Engine filtering: before passing server configs to `taskLspRegistry.getManager`, filter to servers where `!server.projects || server.projects.includes(taskProjectKey)`.

## Risks / Trade-offs

- Parallel per-project scan fires N RPCs on tab open. Mitigated by caching (only once per workspace session) and the fact that `detectLanguages` is a cheap `readdirSync` + `which` call.
- `projects` scoping is additive — existing workspaces without the field are unaffected.
- The LS tab "Scan" now merges across projects, so if two projects have the same language it appears once (deduplicated by serverName). This is correct behaviour — LSP is workspace-scoped.
