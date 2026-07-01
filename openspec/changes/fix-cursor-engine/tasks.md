## 1. CursorDialect

- [ ] 1.1 Create `src/bun/engine/dialects/cursor-dialect.ts` implementing `SlashCommandDialect` — `listCommands()` scanning `.cursor/commands/*.md` recursively with colon-namespaced subdirectory support (mirrors `ClaudeDialect.collectFromDir()` pattern), `resolvePrompt()` with colon→slash path mapping + `$input` substitution + XML-wrapping (frontmatter preserved, same as `ClaudeDialect`), `getSkillPaths()` returning existing `.cursor/skills/` directories — no home scope
- [ ] 1.2 Register `"cursor"` in `createDefaultDialectRegistry()` in `src/bun/engine/dialects/registry.ts`

## 2. CursorEngine — dialect integration and path fix

- [ ] 2.1 Inject `CursorDialect` into `CursorEngine` constructor (with default instance, injectable for tests)
- [ ] 2.2 Fix `CursorEngine.listCommands()` — replace `adapter.listCommands(process.cwd())` with DB lookup of `task_git_context.worktree_path` and `getLoadedProjectByKey` for project path, then delegate to `dialect.listCommands(worktreePath, projectPath)` (mirrors `CopilotEngine.listCommands()` and `ClaudeEngine.listCommands()` pattern)
- [ ] 2.3 Add slash-command resolution in `CursorEngine._run()` — call `dialect.resolvePrompt(prompt, workingDirectory)` and use the resolved content instead of the raw prompt

## 3. CursorEngine — skill injection

- [ ] 3.1 In `CursorEngine._run()`, call `dialect.getSkillPaths(workingDirectory, projectPath)` and read each skill directory's `SKILL.md`
- [ ] 3.2 Prepend skill contents (with directory name headers) to the `systemBlock` in the prompt prefix — skip silently when no skill directories exist

## 4. Worker — settingSources and AgentBusyError

- [ ] 4.1 Extract `buildBaseOptions()` pure function in `worker.mjs` — always includes `settingSources: ["project"]` in `local`; used by both `Agent.resume` and `Agent.create` paths in `handleStartRun()`
- [ ] 4.2 Extract `sendWithBusyRetry(agent, prompt)` pure function in `worker.mjs` — first call direct; on `AgentBusyError` retry once with `{ local: { force: true } }`; any other error re-thrown immediately
- [ ] 4.3 Replace direct `agent.send(prompt)` call in `handleStartRun()` with `sendWithBusyRetry(agent, prompt)`

## 5. Tests — CursorDialect unit tests

- [ ] 5.1 Create `src/bun/test/cursor-dialect.test.ts` mirroring `claude-dialect.test.ts` — listCommands (flat `.md`, colon-namespaced subdirs, non-`.md` files skipped, duplicate deduplication, missing dirs), resolvePrompt ($input substitution, XML-wrapping, frontmatter preserved), getSkillPaths (returns existing dirs, skips missing)

## 6. Tests — registry and listCommands integration

- [ ] 6.1 Add `"cursor"` to dialect registry test in `src/bun/test/slash-command-dialect-registry.test.ts`
- [ ] 6.2 Add `CursorEngine.listCommands` section to `src/bun/test/list-commands.test.ts` mirroring the `ClaudeEngine` section (worktree path from `task_git_context`, project path from config, delegates to dialect)

## 7. Tests — engine dialect injection and skill injection

- [ ] 7.1 Add SpyDialect tests to `src/bun/test/cursor/engine.test.ts` mirroring `pi-harness.test.ts` — default dialect is `CursorDialect`; injected dialect is used; slash resolution in `_run()`; skill content prepended to prompt prefix; empty skills no-op; pre-aborted run skips dialect

## 8. Tests — RPC slash resolution

- [ ] 8.1 Add slash-resolution scenario to `src/bun/test/cursor/rpc-scenarios.test.ts` mirroring `copilot-rpc-scenarios.test.ts` L218 — write `.cursor/commands/opsx-propose.md` in `runtime.gitDir`; assert resolved body in `adapter.trace.runConfigs[0].prompt`, raw chip stored in `conversation_messages`

## 9. Tests — worker pure function unit tests

- [ ] 9.1 Create `src/bun/test/cursor/worker-options.test.ts` for `buildBaseOptions()` — always includes `settingSources: ["project"]`; forwards all relevant options
- [ ] 9.2 Create `src/bun/test/cursor/worker-send-retry.test.ts` for `sendWithBusyRetry()` — success path (no retry); `AgentBusyError` → retry with `force: true` → success; non-`AgentBusyError` re-thrown; second `AgentBusyError` propagates
