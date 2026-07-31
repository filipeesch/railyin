## 1. Instruction Scanner Utility

- [ ] 1.1 Create `src/bun/engine/dialects/instruction-scanner.ts` with `Instruction` interface and `ParsedFrontmatter` interface
- [ ] 1.2 Implement `parseFrontmatter()` function to extract YAML frontmatter, return `ParsedFrontmatter | null`
- [ ] 1.3 Implement `scanInstructionsFromDir()` function to scan directories for matching files, parse frontmatter, return `Instruction[]`
- [ ] 1.4 Implement `getInstructionConvention()` function to map dialect names to convention objects
- [ ] 1.5 Add structured JSON logging when instruction files are loaded

## 2. PiDialectResolver Extension

- [ ] 2.1 Add `getInstructions(cwd: string, gitWorktreeRootPath: string): Instruction[]` method to `PiDialectResolver`
- [ ] 2.2 Import instruction-scanner utilities into dialect-resolver.ts
- [ ] 2.3 Implement convention resolution based on dialect type (copilot → .github/instructions/, cursor → .cursor/rules/)
- [ ] 2.4 Scan both project root (cwd) and worktree root (gitWorktreeRootPath) with deduplication by instruction name
- [ ] 2.5 Add structured JSON logging when instructions are loaded

## 3. Pi Engine Instruction Injection

- [ ] 3.1 Call `this.dialectResolver.getInstructions(cwd, workingDirectory)` in `PiEngine.createManagedExecution()`
- [ ] 3.2 Format `Instruction[]` as markdown blocks (name, description, content if autoApply)
- [ ] 3.3 Append instruction blocks to `enrichedSystem` between taskBlock and systemInstructions
- [ ] 3.4 Pass enriched system prompt to session manager

## 4. Copilot Engine Instruction Scanning

- [ ] 4.1 Add projectPath resolution from DB in `CopilotEngine._run()` (same pattern as listCommands)
- [ ] 4.2 Import instruction-scanner utilities into copilot/engine.ts
- [ ] 4.3 Scan `.github/instructions/` at both projectPath and worktreePath for `.md` files
- [ ] 4.4 Parse frontmatter and format instruction blocks as markdown
- [ ] 4.5 Append instruction blocks to systemContent before systemMessage construction
- [ ] 4.6 Add structured JSON logging when instructions are loaded

## 5. Cursor Engine Bug Fix

- [ ] 5.1 Add projectPath resolution from DB in `CursorEngine._run()` (same pattern as listCommands)
- [ ] 5.2 Pass projectPath to `this.dialect.getSkillPaths(workingDirectory, projectPath)`

## 6. Unit Tests: instruction-scanner.ts

**File:** `src/bun/test/instruction-scanner.test.ts` (~28 tests)
**Pattern:** Pure function tests with temp directories (mirrors `cursor-dialect.test.ts`)

### 6.1 parseFrontmatter() (~10 tests)

- [ ] 6.1.1 Valid frontmatter with description — returns `{ description, autoApply: false }`
- [ ] 6.1.2 Valid frontmatter with autoApply true — returns `{ autoApply: true }`
- [ ] 6.1.3 Valid frontmatter with both fields — returns both
- [ ] 6.1.4 No frontmatter (plain text) — returns `null`
- [ ] 6.1.5 Malformed frontmatter (no closing `---`) — returns `null`
- [ ] 6.1.6 Empty frontmatter — returns `{ description: undefined, autoApply: false }`
- [ ] 6.1.7 Frontmatter with extra fields — ignores unknown fields
- [ ] 6.1.8 autoApply: false explicit — returns `{ autoApply: false }`
- [ ] 6.1.9 autoApply: true without description — returns `{ autoApply: true }`
- [ ] 6.1.10 Description with special characters — correctly parsed

### 6.2 scanInstructionsFromDir() (~11 tests)

- [ ] 6.2.1 Scan directory with matching `.md` files — returns instructions for valid files
- [ ] 6.2.2 Scan directory with `.mdc` extension — returns instruction
- [ ] 6.2.3 Mixed extensions (.md, .mdc, .txt) — returns 2, ignores .txt
- [ ] 6.2.4 Empty directory — returns `[]`
- [ ] 6.2.5 Non-existent directory — returns `[]` (no error)
- [ ] 6.2.6 Subdirectory ignored (flat scan) — returns `[]`
- [ ] 6.2.7 autoApply true includes full content — `content` field populated
- [ ] 6.2.8 autoApply false excludes content — `content: undefined`
- [ ] 6.2.9 Instruction name from filename stem — `name: "my-conventions"`
- [ ] 6.2.10 Instruction sourcePath is absolute — `sourcePath` is absolute
- [ ] 6.2.11 Multiple files deduplicated by name — only first occurrence

### 6.3 getInstructionConvention() (~4 tests)

- [ ] 6.3.1 Copilot convention — returns `{ subdirectory: ".github/instructions", extensions: [".md"] }`
- [ ] 6.3.2 Cursor convention — returns `{ subdirectory: ".cursor/rules", extensions: [".mdc", ".md"] }`
- [ ] 6.3.3 Unknown dialect — returns `null`
- [ ] 6.3.4 Empty string — returns `null`

### 6.4 Instruction interface (~3 tests)

- [ ] 6.4.1 Required fields present — `name`, `description`, `sourcePath` always present
- [ ] 6.4.2 Optional field absent — `content` is `undefined` when autoApply is false
- [ ] 6.4.3 Content populated — `content` contains body text when autoApply is true

## 7. Unit Tests: PiDialectResolver.getInstructions()

**File:** `src/bun/test/pi-dialect-resolver.test.ts` (~12 tests)
**Pattern:** Inject `CopilotDialect`/`CursorDialect`/`NullDialect` via DI (mirrors `pi-harness.test.ts` `SpyDialect`)

- [ ] 7.1 Copilot dialect scans .github/instructions/ — returns instruction from cwd
- [ ] 7.2 Cursor dialect scans .cursor/rules/ — returns instruction from cwd
- [ ] 7.3 NullDialect returns empty array — returns `[]`
- [ ] 7.4 ProjectPath (cwd) files have priority — cwd version wins over worktree
- [ ] 7.5 Worktree files included when different — returns both (different names)
- [ ] 7.6 Worktree path same as cwd — no duplication, single scan
- [ ] 7.7 No instruction directory exists — returns `[]`
- [ ] 7.8 Files without frontmatter skipped — excluded from results
- [ ] 7.9 autoApply includes full content — `content` field populated
- [ ] 7.10 Logging emitted — console log with JSON structure
- [ ] 7.11 Multiple files from both paths — correct order (cwd first, then worktree)
- [ ] 7.12 Deduplication across paths — same name in both paths, only cwd version

## 8. Unit Tests: PiEngine Instruction Injection

**File:** `src/bun/test/pi-engine.test.ts` (extend existing)
**Pattern:** Inject `MockAgentSession` via `sessionFactory` parameter (mirrors existing tests)

- [ ] 8.1 Instructions injected into system prompt — `enrichedSystem` contains formatted blocks
- [ ] 8.2 No instructions found — `enrichedSystem` constructed without instructions
- [ ] 8.3 Instruction formatting — name and description — `### name\n\n**description**` format
- [ ] 8.4 Instruction formatting — with content (autoApply) — `### name\n\n**description**\n\ncontent`
- [ ] 8.5 Instruction formatting — without content — `### name\n\n**description**` (no content)
- [ ] 8.6 Multiple instructions joined — blocks joined with `\n\n`
- [ ] 8.7 Instructions between taskBlock and systemInstructions — correct ordering

## 9. Unit Tests: CopilotEngine Instruction Scanning

**File:** `src/bun/test/copilot-engine.test.ts` (new)
**Pattern:** Mock SDK adapter + temp directories (mirrors `cursor/engine.test.ts`)

- [ ] 9.1 ProjectPath resolved from DB — `projectPath` used for scanning
- [ ] 9.2 Instructions scanned at project root — file included in instruction blocks
- [ ] 9.3 Instructions scanned at worktree root — file included in instruction blocks
- [ ] 9.4 Deduplication by name — projectPath version wins
- [ ] 9.5 No instructions found — system message without instruction content
- [ ] 9.6 Instructions appended to systemMessage — `systemMessage: { mode: "append", content: "..." }`
- [ ] 9.7 Files without frontmatter skipped — excluded from results
- [ ] 9.8 Logging emitted — JSON log with `engine: "copilot"`

## 10. Unit Tests: CursorEngine getSkillPaths Bug Fix

**File:** `src/bun/test/cursor/engine.test.ts` (extend existing)
**Pattern:** Inject `SpyDialect` via DI (mirrors existing `cursor/engine.test.ts`)

- [ ] 10.1 projectPath passed to getSkillPaths — `getSkillPaths(workingDirectory, projectPath)` called
- [ ] 10.2 projectPath equals worktreePath — no duplication in skill paths
- [ ] 10.3 No projectPath available — `getSkillPaths(workingDirectory)` called

## 11. Integration Tests (In-Memory DB)

**Pattern:** `initDb()` + `seedProjectAndTask()` + real engines with mocked adapters

### 11.1 Pi Engine Integration (~5 tests)

**File:** `src/bun/test/integration/pi-instructions.test.ts` (new)

- [ ] 11.1.1 Full execution with instructions — session created with instruction blocks
- [ ] 11.1.2 Monorepo projectPath resolution — instructions scanned at both paths
- [ ] 11.1.3 Dialect config = copilot — scans `.github/instructions/`
- [ ] 11.1.4 Dialect config = cursor — scans `.cursor/rules/`
- [ ] 11.1.5 Dialect config = none — no instruction scanning

### 11.2 Copilot Engine Integration (~3 tests)

**File:** `src/bun/test/integration/copilot-instructions.test.ts` (new)

- [ ] 11.2.1 Full execution with instructions — instructions in systemMessage content
- [ ] 11.2.2 Monorepo projectPath resolution — both paths scanned
- [ ] 11.2.3 No instructions directory — system message without instruction content

### 11.3 Cursor Engine Integration (~2 tests)

**File:** `src/bun/test/integration/cursor-skills.test.ts` (new)

- [ ] 11.3.1 Skills loaded from projectPath — skills from both paths loaded
- [ ] 11.3.2 Skills deduplicated by path — no duplication when projectPath = worktreePath

## 12. Verification

- [ ] 12.1 Verify no TypeScript compilation errors
- [ ] 12.2 Verify existing tests still pass
- [ ] 12.3 Verify all new tests pass (`bun test src/bun`)
- [ ] 12.4 Verify instruction files are loaded when present
- [ ] 12.5 Verify files without frontmatter are silently skipped
- [ ] 12.6 Verify autoApply files include full content, non-autoApply include only frontmatter
- [ ] 12.7 Verify structured JSON logs are emitted when instructions are loaded
- [ ] 12.8 Verify no Playwright test changes needed (feature is server-side)
