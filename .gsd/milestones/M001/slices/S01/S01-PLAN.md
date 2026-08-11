# S01: Engine list + detail panel skeleton

**Milestone:** M001
**Slice:** S01

**Goal:** RPC endpoint, Pinia store, dual-view overlay shell
**Demo:** Select engine from list, see form fields and YAML preview

## Must-Haves

- Engine list loads from RPC, sidebar shows selection, Monaco displays YAML

## Threat Surface

- **Verdict:** pass
- **Rationale:** Overlay structure uses proper Teleport-to-body pattern, accessible buttons with aria-labels, keyboard ESC to close, focus management with nextTick

## Requirement Impact

- **Verdict:** pass
- **Rationale:** Form fields use semantic HTML labels, inputs have proper types (number, text, password, select), focus states defined, keyboard navigable

## Verification

- Run the task and slice verification checks for this slice.

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
<!-- gsd:state-version=24:0 -->
