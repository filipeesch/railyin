## ADDED Requirements

### Requirement: Registry defines supported languages with detection globs
The system SHALL maintain a static registry where each language entry defines a display name, one or more indicator file globs checked at the project root (depth 1 only), the LSP server binary name, the file extensions routed to that server, and one or more install options.

#### Scenario: Language detected by indicator file at project root
- **WHEN** the project root contains a file matching a language entry's detection glob (e.g. `tsconfig.json` for TypeScript)
- **THEN** that language is included in the detected languages list

#### Scenario: Language not detected when no indicator file present
- **WHEN** the project root contains no file matching any detection glob for a language
- **THEN** that language is not included in the detected languages list

#### Scenario: Detection is limited to project root depth
- **WHEN** an indicator file exists only in a subdirectory (not the project root)
- **THEN** the system does NOT detect that language (detection is root-depth-1 only)

### Requirement: Registry install options are platform-tagged
Each install option in the registry SHALL declare a `platforms` array (`"macos"`, `"linux"`, `"windows"`, or `"*"` for all). The system SHALL only surface install options whose platform tag matches the current runtime OS.

#### Scenario: Platform-specific options filtered at runtime
- **WHEN** the setup prompt is shown on macOS
- **THEN** only install options tagged `"macos"` or `"*"` are presented for each language

#### Scenario: Cross-platform option shown on all platforms
- **WHEN** an install option is tagged `"*"` (e.g. `npm install -g`)
- **THEN** it is shown on macOS, Linux, and Windows

### Requirement: Registry is extensible without code changes to the setup flow
All language-specific knowledge (detection, server binary name, install commands) SHALL reside exclusively in the registry module. The setup flow SHALL NOT contain hardcoded language names or install commands.

#### Scenario: New language added to registry is automatically covered
- **WHEN** a new entry is added to the registry constant
- **THEN** the setup flow detects, probes, and installs it without any changes to the flow logic
