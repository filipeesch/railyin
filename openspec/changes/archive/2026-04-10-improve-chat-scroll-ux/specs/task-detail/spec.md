## MODIFIED Requirements

### Requirement: Task detail drawer auto-scroll is anchored to the live conversation timeline
The task detail drawer SHALL auto-scroll while the user remains near the bottom of the conversation. Anchored scrolling SHALL react to all live timeline growth, including streaming reasoning, streaming assistant output, and other live execution state rendered in the conversation.

#### Scenario: Streaming reasoning keeps the drawer anchored
- **WHEN** reasoning tokens extend the active reasoning bubble and the user is still at the bottom threshold
- **THEN** the drawer remains scrolled to the newest visible content

#### Scenario: User scrolling away pauses auto-scroll
- **WHEN** the user scrolls above the bottom threshold during an active execution
- **THEN** new live conversation content does not force the drawer back to the bottom

#### Scenario: Returning to the bottom resumes auto-scroll
- **WHEN** the user scrolls back within the bottom threshold while an execution is still producing live content
- **THEN** anchored auto-scroll resumes for subsequent timeline growth

### Requirement: Tool rows show a user-facing empty state when no output is available
The expanded body of a tool row SHALL render an explicit empty-state message when the tool produced no user-visible output and no diff content is available.

#### Scenario: Empty tool result shows placeholder text
- **WHEN** a tool call completes successfully but exposes neither diff content nor readable output text
- **THEN** the expanded tool row shows a placeholder such as "No output produced"

### Requirement: Standard chat bubbles use compact typography
Standard user and assistant chat bubbles SHALL use slightly smaller body text than the surrounding drawer defaults, improving message density without reducing readability of specialized technical views.

#### Scenario: Message bubbles use compact body size
- **WHEN** a normal `user` or `assistant` message is rendered in the task drawer
- **THEN** its bubble text uses the compact chat body size
