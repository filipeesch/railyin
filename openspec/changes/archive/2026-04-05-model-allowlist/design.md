## Context

The app now supports multiple AI providers simultaneously. `models.list` iterates all configured providers and returns a flat merged list. The task drawer shows all models in a single `<Select>` dropdown — unusable when providers like OpenRouter expose 50–200 models. Users need a per-workspace curated shortlist stored persistently, manageable from both the config screen and a quick-access modal in the chat window.

Current state: the existing `models.list` RPC is used directly by the chat dropdown. No filtering, no grouping, no persistence.

## Goals / Non-Goals

**Goals:**
- Users can enable/disable individual models via a tree UI (provider → models)
- Only enabled models appear in the chat dropdown
- Model preferences persist across restarts (database)
- Same tree component used in the config screen and a modal in the chat window
- Graceful empty state with a clear path to enabling models

**Non-Goals:**
- Per-task model filtering (all tasks share one allowlist)
- Reordering models within a provider
- Provider-level enable/disable (only individual model granularity)
- Editing provider credentials from the UI

## Decisions

### D1 — Storage: DB table, not workspace.yaml

**Decision:** New `enabled_models (workspace_id INTEGER, qualified_model_id TEXT, PRIMARY KEY (workspace_id, qualified_model_id))` table.

**Rationale:** workspace.yaml holds provider credentials — it's a file the user manages manually and shouldn't be auto-written by the app. The DB is already the right place for user preferences. Orphaned rows (provider removed from yaml) are harmlessly ignored at query time.

**Alternative considered:** `enabled_models` list per provider in workspace.yaml. Rejected: requires the app to write back to a user-managed file, fragile for comments and formatting.

### D2 — `models.list` response shape change (breaking)

**Decision:** Rewrite `models.list` to return:
```ts
interface ProviderModelList {
  id: string;           // provider id, e.g. "anthropic"
  models: Array<{
    id: string;         // qualified: "anthropic/claude-opus-4-5"
    contextWindow: number | null;
    enabled: boolean;   // joined from enabled_models table
  }>;
  error?: string;       // set if provider fetch failed
}
// RPC returns: ProviderModelList[]
```

**Rationale:** The config tree needs all models + enabled state in one call. Baking `enabled` into the response avoids a second round-trip. The old flat `ModelInfo[]` shape is no longer needed since the flat chat dropdown is being replaced.

### D3 — Two additional RPCs: `models.setEnabled` + `models.listEnabled`

**Decision:**
- `models.setEnabled({ qualifiedModelId: string, enabled: boolean })` → upserts or deletes from `enabled_models`
- `models.listEnabled()` → returns `ModelInfo[]` (flat, only enabled rows), used exclusively by the chat dropdown

**Rationale:** Separating read (listEnabled) from write (setEnabled) keeps the chat dropdown cheap — it only fetches the small filtered set, not the full provider tree. The tree view uses `models.list` for the full picture.

### D4 — Shared `ModelTreeView.vue` component

**Decision:** Extract the provider tree with checkboxes into a standalone `ModelTreeView.vue`. Used both in the "Models" tab of SetupView and in `ManageModelsModal.vue`.

**Rationale:** Avoids duplicating the tree logic. Both contexts need identical behavior — fetch `models.list` on mount, toggle via `models.setEnabled`, refresh on demand.

### D5 — "Manage models" modal, not navigation

**Decision:** A `⚙ Models` button at the bottom of the chat dropdown opens `ManageModelsModal.vue` as an overlay. User stays in the task context.

**Rationale:** Navigating to the config screen interrupts the chat flow. The modal gives immediate access without losing context.

### D6 — Empty state: CTA modal, not silent failure

**Decision:** When `models.listEnabled` returns empty, the chat dropdown shows a single disabled option "No models enabled" with a `⚙ Manage models` button that opens the modal immediately.

**Rationale:** The `awaiting_user` execution state already handles the case where a task has no model. The empty dropdown CTA gives the user a direct path to fix it without hunting through menus.

### D7 — Searchable select in the chat drawer

**Decision:** Replace the plain PrimeVue `Select` in the task detail drawer with a filtered, grouped `Select` — the same component with `filter` and `optionGroupLabel` / `optionGroupChildren` props. No additional library required.

**Rationale:** With multiple providers (OpenRouter can expose 100+ models), a flat unfiltered list is unusable. PrimeVue `Select` already ships a built-in filter input; enabling it costs nothing and the pattern is consistent with the rest of the app. The grouped structure (provider → models) lets the user scan by provider first, then narrow by typing.

**Alternative considered:** PrimeVue `AutoComplete`. Rejected: autocomplete implies free-text entry, which creates confusion about whether arbitrary model ids are valid. `Select` with `filter` keeps the constraint that only known enabled models are selectable.

### D8 — Auto-load on Models tab open

**Decision:** `ModelTreeView` calls `models.list` on `onMounted`. A per-provider `[Refresh]` button re-fetches just that provider's models (by calling `models.list` again and diff-updating). No manual initial load required.

**Rationale:** Removes friction for first-time users. Provider APIs are generally fast enough that a background fetch on tab open is acceptable.

## Risks / Trade-offs

- **Stale model lists**: A provider adds/removes models between fetches. The DB may reference a model that no longer exists. → Mitigation: `models.listEnabled` filters by currently-reachable models at query time, or simply trusts the stored IDs and lets the API error naturally. Accept the latter for simplicity.
- **Provider down on tab open**: `models.list` fails for one provider. → Mitigation: `error` field in `ProviderModelList`; show provider row as "unavailable" with a Refresh button, don't block the rest of the tree.
- **OpenRouter 200+ models**: The tree scrolls but is long. → Mitigation: search/filter input at the top of the modal/tab, scoped to model name within expanded providers. Can be deferred to a follow-up.

## Migration Plan

1. Add `enabled_models` table in the next DB migration (non-destructive, additive)
2. Deploy — no data migration needed; table starts empty → empty state CTA guides users
3. No rollback complexity — disabling the feature just means the dropdown falls back to `listEnabled` returning nothing, showing the CTA
