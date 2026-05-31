## 1. Add `buildToolAllowlist` helper

- [ ] 1.1 Add `import type { AgentTool } from "@earendil-works/pi-agent-core"` to `src/bun/engine/pi/constants.ts`
- [ ] 1.2 Add `buildToolAllowlist(tools: AgentTool<any>[]): string[]` function that returns `[...SDK_BUILTIN_TOOL_NAMES, ...tools.map(t => t.name)]`

## 2. Fix `defaultSessionFactory` allowlist

- [ ] 2.1 In `src/bun/engine/pi/engine.ts`, import `buildToolAllowlist` from `./constants.ts`
- [ ] 2.2 Replace the hardcoded `tools: [...]` array in `defaultSessionFactory` (the `createAgentSession` call, ~L125) with `tools: buildToolAllowlist(piTools)`

## 3. Update remaining call sites for consistency

- [ ] 3.1 In `src/bun/engine/pi/engine.ts`, update `setActiveToolsByName` call (~L741) to use `buildToolAllowlist(tools)` instead of the inline `[...SDK_BUILTIN_TOOL_NAMES, ...tools.map(t => t.name)]` expression
- [ ] 3.2 In `src/bun/engine/pi/child-session.ts`, import `buildToolAllowlist` from `./constants.ts` and replace the inline expression at `tools:` (~L115) with `buildToolAllowlist(tools)`

## 4. Fix `update_note` empty-content validation

- [ ] 4.1 In `src/bun/engine/common-tools.ts`, update the `update_note` branch to `.trim()` the `content` argument and return `"Error: content is required"` when it is empty or whitespace-only, consistent with the `create_note` guard
