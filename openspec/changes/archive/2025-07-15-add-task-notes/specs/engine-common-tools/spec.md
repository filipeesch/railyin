## MODIFIED Requirements

### Requirement: Common tool handlers receive a context object
Each common tool handler SHALL receive a `CommonToolContext` containing scoped sub-objects: `task` (containing `taskId`, `boardId`, `taskContext`), `repos` (containing `todos: TodoRepository`, `decisions: DecisionRepository`, `notes: NoteRepository`), `workflow` (containing `transition`, `humanTurn` callbacks), and `runtime` (containing `interview` suspension callback, `cancellation` signal). The context SHALL be constructed via constructor injection of the repository instances. No handler SHALL access global state.

#### Scenario: Context populated by Copilot engine
- **WHEN** the Copilot engine executes a common tool call
- **THEN** it passes a `CommonToolContext` with `repos.decisions` populated, `repos.notes` populated, and the interview suspension callback at `runtime.interview`

#### Scenario: Context populated by Claude engine
- **WHEN** the Claude engine executes a common tool call
- **THEN** it passes a `CommonToolContext` with `repos.decisions` populated, `repos.notes` populated, and the interview suspension callback at `runtime.interview`

## ADDED Requirements

### Requirement: Common tools include note management tools
The `COMMON_TOOL_DEFINITIONS` array SHALL include `create_note`, `list_notes`, and `update_note` alongside the existing task, todo, decision, and interaction tools. The `executeCommonToolText` switch SHALL handle all three note tool names by dispatching to `ctx.repos.notes`.

#### Scenario: Note tools registered alongside decision tools
- **WHEN** an engine registers common tool definitions
- **THEN** `create_note`, `list_notes`, and `update_note` appear in the tool list
