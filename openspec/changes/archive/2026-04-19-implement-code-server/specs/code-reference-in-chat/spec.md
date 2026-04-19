## Purpose
Enables users to send structured code references from the code editor (code-server/VS Code) into the active task's chat input, preserving file path and line/character selection metadata.

## Requirements

### Requirement: User can send a code selection to chat from the editor
The system SHALL provide a "Send to Railyin" command in the VS Code extension that sends the current editor selection as a structured code reference to the active task's chat input.

#### Scenario: Sending a selection via command palette
- **WHEN** the user has text selected in the editor and runs "Send to Railyin" from the command palette
- **THEN** the system inserts a CodeRef block into the chat input of the task associated with this code-server instance

#### Scenario: Sending a selection via context menu
- **WHEN** the user right-clicks a selection in the editor
- **THEN** a "Send to Railyin" option appears in the editor context menu and triggers the same code reference insertion

#### Scenario: No selection results in no-op
- **WHEN** the user runs "Send to Railyin" with no text selected
- **THEN** the command does nothing (or shows a warning in VS Code's status bar)

### Requirement: Code references are displayed as visual chips in the chat input
The system SHALL render a CodeRef block in the chat input as a chip showing the file name and line range, not as raw text.

#### Scenario: CodeRef chip is visible in chat input
- **WHEN** a code reference is inserted into the chat input
- **THEN** the chat input shows a chip in the format `📎 <filename> L<start>–L<end>` above or inline with the text area

#### Scenario: Multiple code references can be queued
- **WHEN** the user sends multiple code selections before submitting the message
- **THEN** each CodeRef appears as a separate chip in the chat input

#### Scenario: Code reference chip can be dismissed
- **WHEN** the user clicks the × on a CodeRef chip
- **THEN** that reference is removed from the pending chat message

### Requirement: Code references are serialized as fenced code blocks when sent to the AI
The system SHALL serialize each CodeRef as a fenced code block with a `// ref:` header comment when the message is sent.

#### Scenario: Single CodeRef serialization
- **WHEN** a message with one CodeRef is sent
- **THEN** the message content includes a fenced code block in the format:
  ````
  ```<language>
  // ref: <file> L<startLine>:<startChar>–L<endLine>:<endChar>
  <selected text>
  ```
  ````

#### Scenario: Multiple CodeRefs are each serialized
- **WHEN** a message contains multiple CodeRefs
- **THEN** each is serialized as a separate fenced block, prepended to any typed text in the message

### Requirement: Code reference metadata is transmitted via backend push
The system SHALL route the "Send to Railyin" HTTP POST through the Bun backend, which broadcasts a `code.ref` WebSocket push message to the connected frontend.

#### Scenario: Extension POST reaches the frontend
- **WHEN** the VS Code extension POSTs to `/api/codeServer.sendRef`
- **THEN** the backend identifies the task from `RAILYIN_TASK_ID` env var and broadcasts `{ type: "code.ref", payload: CodeRef }` over WebSocket

#### Scenario: Frontend receives push and updates chat input
- **WHEN** the frontend receives a `code.ref` push message
- **THEN** the CodeRef is added to the pending refs list for the relevant task's chat input
