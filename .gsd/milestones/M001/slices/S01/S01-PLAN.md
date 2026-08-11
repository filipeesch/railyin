# S01: Engine list + detail panel skeleton

**Milestone:** M001
**Slice:** S01

**Goal:** Structured engine list RPC endpoint, Pinia store, sidebar list, dual-view overlay shell with Monaco preview. Proves the full data flow: load → select → display YAML.
**Demo:** Select an engine from the list, see its basic fields (id, name, type) in form fields and a synchronized Monaco YAML preview

## Must-Haves

- RPC endpoint returns parsed EngineEntry[] via listEngines()
- Pinia store loads engines, manages selection, syncs YAML
- Overlay shows engine list (id, name, type) and Monaco YAML preview on selection
- Dark mode applies to Monaco preview
- TypeScript compiles without errors

## Threat Surface

- **Verdict:** pass
- **Rationale:** Overlay structure uses proper Teleport-to-body pattern, accessible buttons with aria-labels, keyboard ESC to close, focus management with nextTick

## Proof Level

- This slice proves: integration

## Integration Closure

Full: RPC → store → UI data flow proven end-to-end

## Verification

- No new observability needed beyond existing

<tasks>
- [ ] **T01**: Add engines.list RPC endpoint _(1h)_
  Create 'engines.list' RPC handler in src/bun/handlers/config.ts that returns parsed EngineEntry[] via loadEnginesConfig(). Add type entry in src/shared/rpc-types.ts (RailynAPI['engines.list']). Add client function listEngines() in src/mainview/rpc.ts.
  - Files: `src/bun/handlers/config.ts`, `src/shared/rpc-types.ts`, `src/mainview/rpc.ts`
  - Verify: bun test src/bun/test/engines-config.test.ts. Check TypeScript compiles: bun run typecheck.
- [ ] **T02**: Create Pinia engine store _(45m)_
  Create src/mainview/stores/engine.ts with state: engines (EngineInfo[]), selectedId (string|null), yaml (string), yamlValid (boolean), validationError (string|null). Implement: loadEngines(), selectEngine(), refreshYaml(), setYaml(), validateYaml().
  - Files: `src/mainview/stores/engine.ts`
  - Verify: TypeScript compiles: bun run typecheck. Verify store matches existing Pinia store patterns.
- [ ] **T03**: Build dual-view overlay skeleton _(2h)_
  Create EngineManagementOverlay.vue with: left sidebar showing engine list (id, name, type) via PrimeVue Listbox, right side Monaco YAML preview area. Wire up engine store. Replace in BoardView.vue. Show 'No engine selected' when no selection.
  - Files: `src/mainview/components/EngineManagementOverlay.vue`, `src/mainview/components/EngineListSidebar.vue`, `src/mainview/views/BoardView.vue`
  - Verify: bun run typecheck. Manual test: open overlay from BoardView menu, verify list loads, click engine → YAML preview shows. Dark mode applies.
</tasks>

## Files Likely Touched

- src/bun/handlers/config.ts
- src/shared/rpc-types.ts
- src/mainview/rpc.ts
- src/mainview/stores/engine.ts
- src/mainview/components/EngineManagementOverlay.vue
- src/mainview/components/EngineListSidebar.vue
- src/mainview/views/BoardView.vue
<!-- gsd:state-version=11:0 -->
