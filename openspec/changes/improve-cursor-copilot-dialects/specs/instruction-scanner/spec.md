## ADDED Requirements

### Requirement: Instruction scanner parses YAML frontmatter from instruction files
The system SHALL provide a `parseFrontmatter()` function that extracts YAML frontmatter from instruction files. The function SHALL return a `ParsedFrontmatter` object with `description` (optional string) and `autoApply` (boolean, default false) fields. The function SHALL return `null` when no frontmatter is found.

#### Scenario: Valid frontmatter with description
- **WHEN** a file contains `---\ndescription: My rule\nautoApply: false\n---\nRule content`
- **THEN** `parseFrontmatter()` returns `{ description: "My rule", autoApply: false }`

#### Scenario: Valid frontmatter with autoApply true
- **WHEN** a file contains `---\nautoApply: true\n---\nFull rule content`
- **THEN** `parseFrontmatter()` returns `{ description: undefined, autoApply: true }`

#### Scenario: No frontmatter
- **WHEN** a file contains plain text without `---` delimiters
- **THEN** `parseFrontmatter()` returns `null`

#### Scenario: Malformed frontmatter
- **WHEN** a file contains `---\nno closing delimiter`
- **THEN** `parseFrontmatter()` returns `null`

### Requirement: Instruction scanner scans directories for matching files
The system SHALL provide a `scanInstructionsFromDir()` function that scans a directory for files matching given extensions. The function SHALL perform a flat scan (no subdirectory recursion). For each matching file, the function SHALL parse frontmatter and return an `Instruction` object. Files without frontmatter SHALL be silently skipped.

#### Scenario: Scan directory with matching files
- **WHEN** `scanInstructionsFromDir("/path/to/dir", [".md"])` is called
- **AND** the directory contains `rule1.md` with frontmatter and `rule2.txt` without frontmatter
- **THEN** the function returns an `Instruction[]` with one entry for `rule1.md`
- **AND** `rule2.txt` is excluded (wrong extension)

#### Scenario: Skip files without frontmatter
- **WHEN** a directory contains `no-frontmatter.md` with plain text and no `---` delimiters
- **THEN** `scanInstructionsFromDir()` returns `[]` for that file
- **AND** no error is thrown

#### Scenario: autoApply includes full content
- **WHEN** a file has `autoApply: true` in frontmatter
- **THEN** the returned `Instruction` includes `content` with the full file body (after frontmatter)
- **AND** `description` is extracted from frontmatter

#### Scenario: autoApply false excludes content
- **WHEN** a file has `autoApply: false` (or missing) in frontmatter
- **THEN** the returned `Instruction` has `content: undefined`
- **AND** only `description` and `name` are populated

### Requirement: Convention mapping returns correct paths and extensions per dialect
The system SHALL provide a `getInstructionConvention()` function that maps dialect names to instruction conventions. The function SHALL return an `InstructionConvention` object with `subdirectory` (relative path) and `extensions` (array of file extensions) for known dialects. The function SHALL return `null` for unknown dialects.

#### Scenario: Copilot convention
- **WHEN** `getInstructionConvention("copilot")` is called
- **THEN** it returns `{ subdirectory: ".github/instructions", extensions: [".md"] }`

#### Scenario: Cursor convention
- **WHEN** `getInstructionConvention("cursor")` is called
- **THEN** it returns `{ subdirectory: ".cursor/rules", extensions: [".mdc", ".md"] }`

#### Scenario: Unknown dialect
- **WHEN** `getInstructionConvention("unknown")` is called
- **THEN** it returns `null`

### Requirement: Instruction interface provides structured data
The system SHALL define an `Instruction` interface with fields: `name` (string, filename stem), `description` (string, from frontmatter), `content` (optional string, full file content if autoApply), and `sourcePath` (string, absolute file path).

#### Scenario: Instruction object structure
- **WHEN** an instruction is returned from `scanInstructionsFromDir()`
- **THEN** it has `name: "conventions"` (from filename `conventions.md`)
- **AND** `description: "Project conventions"` (from frontmatter)
- **AND** `content: undefined` (when autoApply is false)
- **AND** `sourcePath: "/absolute/path/to/conventions.md"`
