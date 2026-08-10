## 1. Instruction Scanner Utility

- [x] 1.1 Create `src/bun/engine/dialects/instruction-scanner.ts` with `Instruction` interface and `ParsedFrontmatter` interface
- [x] 1.2 Implement `parseFrontmatter()` function to extract YAML frontmatter, return `ParsedFrontmatter | null`
- [x] 1.3 Implement `scanInstructionsFromDir()` function to scan directories for matching files, parse frontmatter, return `Instruction[]`
- [x] 1.4 Implement `getInstructionConvention()` function to map dialect names to convention objects
- [x] 1.5 Add structured JSON logging when instruction files are loaded

## 2. PiDialectResolver Extension

- [x] 2.1 Add `getInstructions(cwd: string, gitWorktreeRootPath: string): Instruction[]` method to `PiDialectResolver`
- [x] 2.2 Import instruction-scanner utilities into dialect-resolver.ts
- [x] 2.3 Implement convention resolution based on dialect type (copilot → .github/instructions/, cursor → .cursor/rules/)
- [x] 2.4 Scan both project root (cwd) and worktree root (gitWorktreeRootPath) with deduplication by instruction name
- [x] 2.5 Add structured JSON logging when instructions are loaded

## 3. Pi Engine Instruction Injection

- [x] 3.1 Call `this.dialectResolver.getInstructions(cwd, workingDirectory)` in `PiEngine.createManagedExecution()`
- [x] 3.2 Format `Instruction[]` as markdown blocks (name, description, content if autoApply)
- [x] 3.3 Append instruction blocks to `enrichedSystem` between taskBlock and systemInstructions
- [x] 3.4 Pass enriched system prompt to session manager

## 4. Copilot Engine Instruction Scanning

- [x] 4.1 Add projectPath resolution from DB in `CopilotEngine._run()` (same pattern as listCommands)
- [x] 4.2 Import instruction-scanner utilities into copilot/engine.ts
- [x] 4.3 Scan `.github/instructions/` at both projectPath and worktreePath for `.md` files
- [x] 4.4 Parse frontmatter and format instruction blocks as markdown
- [x] 4.5 Append instruction blocks to systemContent before systemMessage construction
- [x] 4.6 Add structured JSON logging when instructions are loaded

## 5. Cursor Engine Bug Fix

- [x] 5.1 Add projectPath resolution from DB in `CursorEngine._run()` (same pattern as listCommands)
- [x] 5.2 Pass projectPath to `this.dialect.getSkillPaths(workingDirectory, projectPath)`

## 6. Unit Tests: instruction-scanner.ts

**File:** `src/bun/test/instruction-scanner.test.ts` (33 tests)
**Pattern:** Pure function tests with temp directories (mirrors `cursor-dialect.test.ts`)

### 6.1 parseFrontmatter() (12 tests)

- [x] 6.1.1 Valid frontmatter with description — returns `{ description, autoApply: false }`
- [x] 6.1.2 Valid frontmatter with autoApply true — returns `{ autoApply: true }`
- [x] 6.1.3 Valid frontmatter with both fields — returns both
- [x] 6.1.4 No frontmatter (plain text) — returns `null`
- [x] 6.1.5 Malformed frontmatter (no closing `---`) — returns `null`
- [x] 6.1.6 Empty frontmatter — returns `{ description: undefined, autoApply: false }`
- [x] 6.1.7 Frontmatter with extra fields — ignores unknown fields
- [x] 6.1.8 autoApply: false explicit — returns `{ autoApply: false }`
- [x] 6.1.9 autoApply: true without description — returns `{ autoApply: true }`
- [x] 6.1.10 Description with special characters — correctly parsed
- [x] 6.1.11 Quoted description values — unquoted correctly
- [x] 6.1.12 Single-quoted description values — unquoted correctly

### 6.2 scanInstructionsFromDir() (12 tests)

- [x] 6.2.1 Scan directory with matching `.md` files — returns instructions for valid files
- [x] 6.2.2 Scan directory with `.mdc` extension — returns instruction
- [x] 6.2.3 Mixed extensions (.md, .mdc, .txt) — returns 2, ignores .txt
- [x] 6.2.4 Empty directory — returns `[]`
- [x] 6.2.5 Non-existent directory — returns `[]` (no error)
- [x] 6.2.6 Subdirectory ignored (flat scan) — returns `[]`
- [x] 6.2.7 autoApply true includes full content — `content` field populated
- [x] 6.2.8 autoApply false excludes content — `content: undefined`
- [x] 6.2.9 Instruction name from filename stem — `name: "my-conventions"`
- [x] 6.2.10 Instruction sourcePath is absolute — `sourcePath` is absolute
- [x] 6.2.11 Files without frontmatter skipped — excluded from results
- [x] 6.2.12 Files with malformed frontmatter skipped — excluded from results

### 6.3 getInstructionConvention() (4 tests)

- [x] 6.3.1 Copilot convention — returns `{ subdirectory: ".github/instructions", extensions: [".md"] }`
- [x] 6.3.2 Cursor convention — returns `{ subdirectory: ".cursor/rules", extensions: [".mdc", ".md"] }`
- [x] 6.3.3 Unknown dialect — returns `null`
- [x] 6.3.4 Empty string — returns `null`

### 6.4 Instruction interface (3 tests)

- [x] 6.4.1 Required fields present — `name`, `description`, `sourcePath` always present
- [x] 6.4.2 Optional field absent — `content` is `undefined` when autoApply is false
- [x] 6.4.3 Content populated — `content` contains body text when autoApply is true

### 6.5 logInstructionsLoaded() (2 tests)

- [x] 6.5.1 Does not log when instructions array is empty
- [x] 6.5.2 Logs JSON with correct format when instructions loaded

## 7. Unit Tests: PiDialectResolver.getInstructions()

**File:** `src/bun/test/pi-dialect-resolver.test.ts` (14 tests)
**Pattern:** Inject `CopilotDialect`/`CursorDialect`/`NullDialect` via DI (mirrors `pi-harness.test.ts` `SpyDialect`)

- [x] 7.1 Copilot dialect scans .github/instructions/ — returns instruction from cwd
- [x] 7.2 Cursor dialect scans .cursor/rules/ — returns instruction from cwd
- [x] 7.3 NullDialect returns empty array — returns `[]`
- [x] 7.4 ProjectPath (cwd) files have priority — cwd version wins over worktree
- [x] 7.5 Worktree files included when different — returns both (different names)
- [x] 7.6 Worktree path same as cwd — no duplication, single scan
- [x] 7.7 No instruction directory exists — returns `[]`
- [x] 7.8 Files without frontmatter skipped — excluded from results
- [x] 7.9 autoApply includes full content — `content` field populated
- [x] 7.10 Logging emitted — console log with JSON structure
- [x] 7.11 Multiple files from both paths — correct order (cwd first, then worktree)
- [x] 7.12 Deduplication across paths — same name in both paths, only cwd version

## 8. Unit Tests: PiEngine Instruction Injection

**File:** `src/bun/test/pi-instruction-injection.test.ts` (10 tests)
**Pattern:** Test `formatInstructionBlocks()` and system prompt construction

- [x] 8.1 Instructions injected into system prompt — `enrichedSystem` contains formatted blocks
- [x] 8.2 No instructions found — `enrichedSystem` constructed without instructions
- [x] 8.3 Instruction formatting — name and description — `### name\n\n**description**` format
- [x] 8.4 Instruction formatting — with content (autoApply) — `### name\n\n**description**\n\ncontent`
- [x] 8.5 Instruction formatting — without content — `### name\n\n**description**` (no content)
- [x] 8.6 Multiple instructions joined — blocks joined with `\n\n`
- [x] 8.7 Instructions between taskBlock and systemInstructions — correct ordering

## 9. Unit Tests: CopilotEngine Instruction Scanning

**File:** `src/bun/test/copilot-instruction-scanning.test.ts` (12 tests)
**Pattern:** Mock SDK adapter + temp directories (mirrors `cursor/engine.test.ts`)

- [x] 9.1 ProjectPath resolved from DB — `projectPath` used for scanning
- [x] 9.2 Instructions scanned at project root — file included in instruction blocks
- [x] 9.3 Instructions scanned at worktree root — file included in instruction blocks
- [x] 9.4 Deduplication by name — projectPath version wins
- [x] 9.5 No instructions found — system message without instruction content
- [x] 9.6 Instructions appended to systemMessage — `systemMessage: { mode: "append", content: "..." }`
- [x] 9.7 Files without frontmatter skipped — excluded from results
- [x] 9.8 Logging emitted — JSON log with `engine: "copilot"`

## 10. Unit Tests: CursorEngine getSkillPaths Bug Fix

**File:** `src/bun/test/cursor/engine.test.ts` (extend existing)
**Pattern:** Inject `SpyDialect` via DI (mirrors existing `cursor/engine.test.ts`)

- [x] 10.1 projectPath passed to getSkillPaths — `getSkillPaths(workingDirectory, projectPath)` called
- [x] 10.2 projectPath equals worktreePath — no duplication in skill paths
- [x] 10.3 No projectPath available — `getSkillPaths(workingDirectory)` called

## 11. Integration Tests (In-Memory DB)

**Pattern:** `initDb()` + `seedProjectAndTask()` + real engines with mocked adapters

### 11.1 Pi Engine Integration (5 tests)

**File:** `src/bun/test/integration/instruction-loading.test.ts` (new)

- [x] 11.1.1 Full execution with instructions — session created with instruction blocks
- [x] 11.1.2 Monorepo projectPath resolution — instructions scanned at both paths
- [x] 11.1.3 Dialect config = copilot — scans `.github/instructions/`
- [x] 11.1.4 Dialect config = cursor — scans `.cursor/rules/`
- [x] 11.1.5 Dialect config = none — no instruction scanning

### 11.2 Copilot Engine Integration (3 tests)

**File:** `src/bun/test/integration/instruction-loading.test.ts` (new)

- [x] 11.2.1 Full execution with instructions — instructions in systemMessage content
- [x] 11.2.2 Monorepo projectPath resolution — both paths scanned
- [x] 11.2.3 No instructions directory — system message without instruction content

### 11.3 Cursor Engine Integration (2 tests)

**File:** `src/bun/test/integration/instruction-loading.test.ts` (new)

- [x] 11.3.1 Skills loaded from projectPath — skills from both paths loaded
- [x] 11.3.2 Skills deduplicated by path — no duplication when projectPath = worktreePath

## 12. Verification

- [x] 12.1 Verify no TypeScript compilation errors
- [x] 12.2 Verify existing tests still pass
- [x] 12.3 Verify all new tests pass (`bun test src/bun`)
- [x] 12.4 Verify instruction files are loaded when present
- [x] 12.5 Verify files without frontmatter are silently skipped
- [x] 12.6 Verify autoApply files include full content, non-autoApply include only frontmatter
- [x] 12.7 Verify structured JSON logs are emitted when instructions are loaded
- [x] 12.8 Verify no Playwright test changes needed (feature is server-side)
