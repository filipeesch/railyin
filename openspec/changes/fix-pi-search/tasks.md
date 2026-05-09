## 1. Enable Pi SDK built-in search tools

- [ ] 1.1 Update `src/bun/engine/pi/engine.ts` — add `tools: ["grep", "find", "ls"]` to `createAgentSession` call alongside existing `noTools: "builtin"`
- [ ] 1.2 Verify SDK `grep` is exported from `@earendil-works/pi-coding-agent` and available via `createGrepTool`

## 2. Remove custom search from Pi tool harness

- [ ] 2.1 Remove `search` entry from `PI_TOOL_GROUPS` map in `src/bun/engine/pi/tools/index.ts`
- [ ] 2.2 Remove `search` from `DEFAULT_PI_TOOL_GROUPS` array in `src/bun/engine/pi/tools/index.ts`
- [ ] 2.3 Remove `import { buildSearchTools } from "./search.ts"` from `src/bun/engine/pi/tools/index.ts`
- [ ] 2.4 Delete `src/bun/engine/pi/tools/search.ts` — entire file, zero callers

## 3. Update workflow configuration

- [ ] 3.1 Remove `- search` from `plan` column tool groups in `config/workflows/delivery.yaml`
- [ ] 3.2 Remove `- search` from `in_progress` column tool groups in `config/workflows/delivery.yaml`

## 4. Verify

- [ ] 4.1 TypeScript compile check — `bun run build` (ensure no missing import errors)
- [ ] 4.2 Confirm `picomatch` is no longer imported anywhere (was only in search.ts)
- [ ] 4.3 Confirm `ContentHashCache` methods (`checkSearch`, `updateSearch`) are still used by `glob` in `read.ts`
- [ ] 4.4 Run `bun run test` — ensure no test failures from removed module
