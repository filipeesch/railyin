## ADDED Requirements

### Requirement: CopilotEngine delivers text attachments to the model as selection attachments
The system SHALL map `Attachment` objects with a text media type (`text/*`, `application/json`, `application/yaml`) to Copilot SDK `selection` attachments. The mapped attachment SHALL include `filePath` pointing to a file that exists on disk containing the decoded text content, and SHALL also include the `text` field inline. The `filePath` SHALL use an extension derived from the attachment's `mediaType` using a static map; for unlisted media types, `.txt` SHALL be used as the fallback extension.

#### Scenario: Text file upload reaches the model as a selection attachment
- **WHEN** the user uploads a plain-text file (e.g., `README`, `mediaType: "text/plain"`) and sends the message
- **THEN** the Copilot engine maps it to a `selection` attachment with `filePath` ending in `.txt`, `displayName` matching the original label, and `text` containing the decoded file content

#### Scenario: JSON file upload gets correct extension
- **WHEN** the user uploads a file with `mediaType: "application/json"` and a label without an extension
- **THEN** the mapped `selection` attachment has `filePath` ending in `.json`

#### Scenario: File with extension in label keeps its extension
- **WHEN** the user uploads a file with a label that already contains an extension (e.g., `"config.yaml"`)
- **THEN** no additional extension is appended to the `filePath`

#### Scenario: Temp file is written to disk before being handed to the SDK
- **WHEN** the engine maps a text attachment to a `selection` attachment
- **THEN** the file at `selection.filePath` exists on disk and contains the decoded text content at the moment `session.send()` is called

### Requirement: CopilotEngine delivers #file chip references as selection attachments
The system SHALL map `Attachment` objects whose `data` field matches the `@file:<path>` pattern to Copilot SDK `selection` attachments by reading the referenced file from the working directory.

#### Scenario: Plain #file ref reaches the model
- **WHEN** the user inserts a `#src/foo.ts` chip and sends the message
- **THEN** the Copilot engine maps it to a `selection` attachment with `displayName` matching the chip label and `text` containing the full file contents

#### Scenario: Line-ranged #file ref delivers only the specified lines
- **WHEN** the user inserts a `#src/foo.ts:L2-L4` chip and sends the message
- **THEN** the Copilot engine maps it to a `selection` attachment whose `text` contains only lines 2 through 4 of the file (1-based, inclusive) and whose `selection` metadata reflects the start and end positions
