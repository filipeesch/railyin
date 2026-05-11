## 1. Fix Tools Allowlist in Pi Engine

- [x] 1.1 In `src/bun/engine/pi/engine.ts`, `getOrCreateSession`: add `"read"` to the `tools` array passed to `createAgentSession`
- [x] 1.2 In the same `tools` array, remove `"read_file"` (retain the tool code in `src/bun/engine/pi/tools/read.ts` — only remove it from the allowlist)

## 2. Verify

- [x] 2.1 Run the backend test suite (`bun test src/bun/test --timeout 20000`) and confirm no regressions
