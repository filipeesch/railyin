## ADDED Requirements

### Requirement: Pi tool groups are configurable per workflow column
The `PI_TOOL_GROUPS` map in `src/bun/engine/pi/tools/index.ts` SHALL include tool groups: `read`, `write`, `shell`, `web`. The `read` group SHALL return an empty tool list — file discovery is delegated entirely to the Pi SDK built-in `find` tool. Tool descriptions SHALL NOT reference tools that no longer exist — specifically `search_text`, `find_files`, and `glob`. The `run_command` tool description SHALL direct the model to use `grep` and `find` (Pi SDK built-in names) for file content search and file pattern matching respectively.

#### Scenario: Column configured with read+shell groups gets only those tools
- **WHEN** a column has `tools: ["read", "shell"]` and the Pi engine builds tools for an execution
- **THEN** `buildAllTools` returns only `run_command` from harness tools (plus board/interaction common tools)
- **AND** no `glob` tool is returned
- **AND** no `search_text` is returned

#### Scenario: Column with no tools config gets full default tool set
- **WHEN** a column has no `tools:` config
- **THEN** `buildAllTools` returns the default tool set: `read`, `write`, `shell`
- **AND** no `search` group is included
- **AND** no `glob` tool is included

#### Scenario: run_command description references only current SDK tools
- **WHEN** the `run_command` tool definition is inspected
- **THEN** its description does NOT contain the string `search_text`
- **AND** its description does NOT contain the string `glob`
- **AND** its description directs the model to prefer `grep` for searching file content and `find` for finding files by pattern

### Requirement: HarnessContext exposes a ToolLoopDetector
`HarnessContext` SHALL include a `loopDetector: ToolLoopDetector` field. This field SHALL be initialized when `getOrCreateHarnessContext()` creates a new context entry.

### Requirement: HarnessContext loopDetector initialization is tested
`src/bun/test/pi-harness.test.ts` SHALL contain the following additional test cases:

- **HLC-1** `getOrCreateHarnessContext()` returns a context with a non-null `loopDetector` instance on first call
- **HLC-2** Second call for the same `conversationId` returns the same `loopDetector` instance (not a new one)
- **HLC-3** Fresh `loopDetector` has clean state — calling `record()` once returns `false`
