---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T01: Add engines.list RPC endpoint

Create 'engines.list' RPC handler in src/bun/handlers/config.ts that returns parsed EngineEntry[] via loadEnginesConfig(). Add type entry in src/shared/rpc-types.ts (RailynAPI['engines.list']). Add client function listEngines() in src/mainview/rpc.ts.

## Inputs

- `src/bun/config/index.ts`
- `src/bun/handlers/config.ts`

## Expected Output

- `src/bun/handlers/config.ts`
- `src/shared/rpc-types.ts`
- `src/mainview/rpc.ts`

## Verification

bun test src/bun/test/engines-config.test.ts. Check TypeScript compiles: bun run typecheck.
<!-- gsd:state-version=3:0 -->
