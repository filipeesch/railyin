## ADDED Requirements

### Requirement: User can attach files via clipboard paste
The system SHALL detect file data (any kind) in the clipboard when the user performs a paste action inside the chat compose area and SHALL create a pending attachment instead of pasting raw binary content. Text clipboard content SHALL be pasted normally into the Textarea without creating an attachment.

#### Scenario: Paste image from clipboard
- **WHEN** the user presses `Cmd+V` with image data in the clipboard while the Textarea is focused
- **THEN** the default paste behavior is suppressed, an Attachment object is created, and a chip appears above the Textarea

#### Scenario: Paste non-image file from clipboard
- **WHEN** the user presses `Cmd+V` with a file (e.g. PDF) in the clipboard
- **THEN** the default paste behavior is suppressed, an Attachment object is created, and a chip appears above the Textarea

#### Scenario: Paste text from clipboard
- **WHEN** the user presses `Cmd+V` with plain text in the clipboard
- **THEN** the text is inserted into the Textarea normally and no chip is created

#### Scenario: Multiple files pasted sequentially
- **WHEN** the user pastes a second file before sending
- **THEN** both chips are shown and both attachments are sent

### Requirement: User can attach any file via file picker
The system SHALL provide an attach button (📎) in the compose area that opens a native file picker accepting all file types, supporting multi-file selection.

#### Scenario: File picker opens on attach button click
- **WHEN** the user clicks the 📎 button
- **THEN** the native file picker opens accepting all file types

#### Scenario: Multiple files selected
- **WHEN** the user selects multiple files
- **THEN** each file appears as a separate chip above the Textarea

#### Scenario: Attachment size limit enforced
- **WHEN** the user selects or pastes an image exceeding 5 MB
- **THEN** the attachment is rejected and an error toast is shown

#### Scenario: Maximum attachment count enforced
- **WHEN** the user already has 3 pending attachments and attempts to add another
- **THEN** the new attachment is rejected and an error toast is shown

### Requirement: Pending attachment chips are shown and removable before send
The system SHALL display pending attachments as chips above the Textarea. Each chip SHALL show a 📎 icon, the filename label, and a ✕ remove button.

#### Scenario: Chip appears after attach
- **WHEN** an attachment is added via paste or file picker
- **THEN** a chip reading `📎 <label> ✕` appears above the Textarea

#### Scenario: Remove attachment before send
- **WHEN** the user clicks ✕ on a chip
- **THEN** the chip disappears and the attachment is removed from the pending list

#### Scenario: Chips cleared after send
- **WHEN** the user sends the message
- **THEN** all chips are cleared from the compose area

### Requirement: Attachments forwarded to Claude and Copilot providers with per-engine translation
When a sendMessage call includes attachments, each engine adapter SHALL translate attachments to the appropriate provider-specific format based on MIME type. The native engine SHALL silently ignore all attachments.

Each attachment carries `{ label, mediaType, data }`. The engine decides how to use it:

**Claude adapter** (`image/*` → `ImageBlockParam`, `application/pdf` → `DocumentBlockParam` base64, `text/*` → `DocumentBlockParam` plain-text, anything else → silently skipped):

#### Scenario: Image attachment forwarded to Claude
- **WHEN** a message includes an image attachment and the engine is Claude
- **THEN** the prompt content contains `{ type: "image", source: { type: "base64", media_type: "<type>", data: "<base64>" } }`

#### Scenario: PDF attachment forwarded to Claude
- **WHEN** a message includes a PDF attachment and the engine is Claude
- **THEN** the prompt content contains `{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "<base64>" } }`

#### Scenario: Text file attachment forwarded to Claude
- **WHEN** a message includes a text file and the engine is Claude
- **THEN** the prompt content contains `{ type: "document", source: { type: "text", media_type: "text/plain", data: "<decoded text>" } }`

#### Scenario: Unsupported type silently skipped by Claude
- **WHEN** a message includes a file with unsupported MIME type and the engine is Claude
- **THEN** the attachment is omitted from the prompt; no error is raised

**Copilot engine** (all types → `{ type: "blob", mimeType, data }` on first turn):

#### Scenario: Any attachment forwarded to Copilot as blob
- **WHEN** a message includes any attachment and the engine is Copilot
- **THEN** the session.send call includes `{ type: "blob", data: "<base64>", mimeType: "<type>", displayName: "<label>" }`

#### Scenario: Native engine ignores attachments
- **WHEN** a message includes attachments and the engine is native
- **THEN** only the text content is forwarded and no error is raised

### Requirement: Attachment bytes not persisted to the database
The system SHALL store only `{ label, type }` metadata in `conversation_messages.metadata`. Raw base64 bytes SHALL NOT be written to any database column.

#### Scenario: Metadata contains attachment labels only
- **WHEN** a message with attachments is persisted
- **THEN** `conversation_messages.metadata` contains `{ "attachments": [{ "label": "...", "type": "..." }] }` and `content` contains only the plain text

#### Scenario: No base64 in database
- **WHEN** a message with a pasted image is sent
- **THEN** no base64 data appears in any column of `conversation_messages`

### Requirement: Attachment chips rendered in conversation history
The system SHALL render a chip for each attachment in the message bubble for user messages with attachment metadata.

#### Scenario: Chip shown in history
- **WHEN** a user message with attachment metadata is displayed
- **THEN** each attachment renders as `📎 <label>` within the message bubble

#### Scenario: No chip for messages without attachments
- **WHEN** a user message has no attachments metadata
- **THEN** no chip is rendered
