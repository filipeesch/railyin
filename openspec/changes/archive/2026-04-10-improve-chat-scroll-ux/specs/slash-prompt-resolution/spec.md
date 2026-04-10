## MODIFIED Requirements

### Requirement: Slash references resolve to prompt files from the project worktree
The system SHALL preserve the original slash invocation as the user-visible chat content while using the resolved prompt body for execution.

#### Scenario: Visible chat shows slash invocation, engine receives resolved body
- **WHEN** the user sends `/my-prompt refine this function` and `.github/prompts/my-prompt.prompt.md` exists
- **THEN** the conversation timeline shows the original invocation `/my-prompt refine this function`, and the engine executes the resolved prompt body with `$input` substituted

#### Scenario: Resolved prompt body is not rendered as a normal user bubble
- **WHEN** a slash reference is resolved successfully
- **THEN** the resolved prompt body is kept out of standard user-facing chat bubbles unless explicitly rendered through a dedicated prompt marker

#### Scenario: Workflow/internal prompt entries may show compact display text
- **WHEN** the system records a workflow-driven prompt entry that has a display label distinct from its resolved prompt body
- **THEN** the chat timeline renders the display label or hides the entry, but it does not render the full resolved body as if the user typed it
