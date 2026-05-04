## MODIFIED Requirements

### Requirement: CommonToolContext carries injected board tool executor
`CommonToolContext` (in `src/bun/engine/types.ts`) SHALL include a `boardTools: IBoardToolExecutor` field. The `executeCommonToolText` function in `common-tools.ts` SHALL dispatch board/task tool calls via `ctx.boardTools.*` instead of directly calling the free functions from `board-tools.ts`.

#### Scenario: Board tool dispatch uses injected executor
- **WHEN** `executeCommonToolText("get_task", args, ctx)` is called
- **THEN** it calls `ctx.boardTools.getTask(args, ctx)` — not the free function `execGetTask`

#### Scenario: CommonToolContext construction requires boardTools
- **WHEN** code constructs a `CommonToolContext` object
- **THEN** TypeScript requires a `boardTools` field of type `IBoardToolExecutor`

#### Scenario: Engine builds context with BoardToolExecutor
- **WHEN** `ClaudeEngine` or `CopilotEngine` builds a `CommonToolContext` for execution
- **THEN** it passes `new BoardToolExecutor(this.db, this.wsRepo)` as the `boardTools` field
