---
estimated_steps: 1
estimated_files: 1
skills_used: []
---

# T02: Create Pinia engine store

Create src/mainview/stores/engine.ts with state: engines (EngineInfo[]), selectedId (string|null), yaml (string), yamlValid (boolean), validationError (string|null). Implement: loadEngines(), selectEngine(), refreshYaml(), setYaml(), validateYaml().

## Inputs

- `src/mainview/stores/workspace.ts`
- `src/mainview/rpc.ts`

## Expected Output

- `src/mainview/stores/engine.ts`

## Verification

TypeScript compiles: bun run typecheck. Verify store matches existing Pinia store patterns.
<!-- gsd:state-version=4:0 -->
