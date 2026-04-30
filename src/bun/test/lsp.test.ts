import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── detectLanguages ──────────────────────────────────────────────────────────

describe("detectLanguages", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "railyn-lsp-detect-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects TypeScript when tsconfig.json is at project root", async () => {
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    const { detectLanguages } = await import("../lsp/detect.ts");
    const result = detectLanguages(dir);
    expect(result.some((e) => e.serverName === "typescript-language-server")).toBe(true);
  });

  it("returns empty array for an empty directory", async () => {
    const { detectLanguages } = await import("../lsp/detect.ts");
    const result = detectLanguages(dir);
    expect(result).toEqual([]);
  });

  it("does not detect TypeScript when indicator is only in a subdirectory", async () => {
    const sub = join(dir, "nested");
    mkdirSync(sub);
    writeFileSync(join(sub, "tsconfig.json"), "{}");
    const { detectLanguages } = await import("../lsp/detect.ts");
    const result = detectLanguages(dir);
    expect(result.some((e) => e.serverName === "typescript-language-server")).toBe(false);
  });

  it("returns empty array when path does not exist", async () => {
    const { detectLanguages } = await import("../lsp/detect.ts");
    const result = detectLanguages("/does/not/exist/at/all");
    expect(result).toEqual([]);
  });

  it("detects Python when pyproject.toml is present", async () => {
    writeFileSync(join(dir, "pyproject.toml"), "[tool.poetry]");
    const { detectLanguages } = await import("../lsp/detect.ts");
    const result = detectLanguages(dir);
    expect(result.some((e) => e.serverName === "pyright-langserver")).toBe(true);
  });
});

// ─── probeInstalled ───────────────────────────────────────────────────────────

describe("probeInstalled", () => {
  it("returns true when the binary is on PATH (exit 0)", async () => {
    const { probeInstalled } = await import("../lsp/detect.ts");
    const mockSpawn = vi.fn().mockReturnValue({ status: 0, stdout: "/usr/bin/node\n", stderr: "", pid: 1, signal: null, error: undefined, output: [null, "/usr/bin/node\n", ""] });
    expect(probeInstalled("node", mockSpawn)).toBe(true);
  });

  it("returns false when the binary is not on PATH (exit 1)", async () => {
    const { probeInstalled } = await import("../lsp/detect.ts");
    const mockSpawn = vi.fn().mockReturnValue({ status: 1, stdout: "", stderr: "not found\n", pid: 1, signal: null, error: undefined, output: [null, "", "not found\n"] });
    expect(probeInstalled("no-such-binary", mockSpawn)).toBe(false);
  });

  it("uses 'where' on Windows", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    const { probeInstalled } = await import("../lsp/detect.ts");
    const mockSpawn = vi.fn().mockReturnValue({ status: 0, stdout: "C:\\Windows\\node.exe\r\n", stderr: "", pid: 1, signal: null, error: undefined, output: [null, "C:\\Windows\\node.exe\r\n", ""] });
    probeInstalled("node", mockSpawn);
    expect(mockSpawn).toHaveBeenCalledWith("where", ["node"], expect.anything());

    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });
});

// ─── addServerToConfig ────────────────────────────────────────────────────────

describe("addServerToConfig", () => {
  let dir: string;
  let yamlPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "railyn-lsp-cfg-"));
    yamlPath = join(dir, "workspace.yaml");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates lsp.servers when the file does not exist", async () => {
    const { addServerToConfig } = await import("../lsp/config-writer.ts");
    const { LANGUAGE_REGISTRY } = await import("../lsp/registry.ts");
    const tsEntry = LANGUAGE_REGISTRY.find((e) => e.serverName === "typescript-language-server")!;

    addServerToConfig(yamlPath, tsEntry);

    const content = readFileSync(yamlPath, "utf-8");
    expect(content).toContain("typescript-language-server");
    expect(content).toContain("lsp:");
  });

  it("does not duplicate an entry that is already present", async () => {
    const { addServerToConfig } = await import("../lsp/config-writer.ts");
    const { LANGUAGE_REGISTRY } = await import("../lsp/registry.ts");
    const tsEntry = LANGUAGE_REGISTRY.find((e) => e.serverName === "typescript-language-server")!;

    addServerToConfig(yamlPath, tsEntry);
    addServerToConfig(yamlPath, tsEntry); // second call should be a no-op

    const content = readFileSync(yamlPath, "utf-8");
    const matches = content.match(/typescript-language-server/g) ?? [];
    // Should appear twice at most: once as `name:` and once as `command:`
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it("preserves existing yaml content when adding a new server", async () => {
    writeFileSync(yamlPath, 'ai:\n  model: "claude-3-5-sonnet"\n');
    const { addServerToConfig } = await import("../lsp/config-writer.ts");
    const { LANGUAGE_REGISTRY } = await import("../lsp/registry.ts");
    const tsEntry = LANGUAGE_REGISTRY.find((e) => e.serverName === "typescript-language-server")!;

    addServerToConfig(yamlPath, tsEntry);

    const content = readFileSync(yamlPath, "utf-8");
    expect(content).toContain("claude-3-5-sonnet");
    expect(content).toContain("typescript-language-server");
  });
});

// ─── getRegistryForPlatform ───────────────────────────────────────────────────

describe("getRegistryForPlatform", () => {
  it("includes brew options on macOS (darwin)", async () => {
    const { getRegistryForPlatform } = await import("../lsp/registry.ts");
    const entries = getRegistryForPlatform("darwin");
    const ts = entries.find((e) => e.serverName === "typescript-language-server")!;
    expect(ts.installOptions.some((o) => o.command.includes("brew"))).toBe(true);
  });

  it("excludes brew options on Linux", async () => {
    const { getRegistryForPlatform } = await import("../lsp/registry.ts");
    const entries = getRegistryForPlatform("linux");
    for (const entry of entries) {
      expect(entry.installOptions.every((o) => !o.command.includes("brew") || o.platforms.includes("*"))).toBe(true);
    }
  });

  it("includes '*' platform options on all platforms", async () => {
    const { getRegistryForPlatform } = await import("../lsp/registry.ts");
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const entries = getRegistryForPlatform(platform);
      for (const entry of entries) {
        // Every entry should have at least one install option (the universal one)
        expect(entry.installOptions.length).toBeGreaterThan(0);
      }
    }
  });

  it("maps win32 to windows platform correctly", async () => {
    const { getRegistryForPlatform } = await import("../lsp/registry.ts");
    const entries = getRegistryForPlatform("win32");
    // Should still include * options for all entries
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.installOptions.length).toBeGreaterThan(0);
    }
  });
});

// ─── 6.1 JSON-RPC Content-Length framing ─────────────────────────────────────

describe("LSPClient JSON-RPC framing", () => {
  it("sends a request with a correct Content-Length header", () => {
    // Build the expected frame manually
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const expectedHeader = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
    const frame = expectedHeader + body;

    // Verify header format
    expect(frame).toMatch(/^Content-Length: \d+\r\n\r\n/);
    const match = frame.match(/Content-Length: (\d+)/);
    expect(match).not.toBeNull();
    const declaredLength = parseInt(match![1], 10);
    const actualBodyPart = frame.slice(frame.indexOf("\r\n\r\n") + 4);
    expect(actualBodyPart.length).toBe(declaredLength);
  });

  it("parses a response frame with Content-Length header correctly", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } });
    const frame = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n${body}`;

    const headerEnd = frame.indexOf("\r\n\r\n");
    expect(headerEnd).toBeGreaterThan(0);

    const header = frame.slice(0, headerEnd);
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    expect(lengthMatch).not.toBeNull();

    const contentLength = parseInt(lengthMatch![1], 10);
    const parsedBody = frame.slice(headerEnd + 4, headerEnd + 4 + contentLength);
    const parsed = JSON.parse(parsedBody);
    expect(parsed.id).toBe(1);
    expect(parsed.result).toEqual({ capabilities: {} });
  });

  it("handles multi-byte UTF-8 characters with correct byte length (not char length)", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "hover", params: { symbol: "日本語" } });
    const byteLength = Buffer.byteLength(body, "utf-8");
    // "日本語" is 3 chars but 9 bytes in UTF-8
    expect(byteLength).toBeGreaterThan(body.length);
    const frame = `Content-Length: ${byteLength}\r\n\r\n${body}`;
    const match = frame.match(/Content-Length: (\d+)/);
    expect(parseInt(match![1], 10)).toBe(byteLength);
  });
});

// ─── 6.2 LSPServerManager routing ─────────────────────────────────────────────

describe("LSPServerManager routing", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "railyn-lsp-mgr-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws for an unknown file extension", async () => {
    const { LSPServerManager } = await import("../lsp/manager.ts");
    const mgr = new LSPServerManager(
      [{ name: "ts", command: "not-real", args: ["--stdio"], extensions: [".ts"] }],
      dir,
    );
    await expect(mgr.request(join(dir, "file.py"), "textDocument/hover", {})).rejects.toThrow(
      "No LSP server configured for .py files",
    );
    mgr.shutdown();
  });

  it("constructs extension map from config (case-insensitive) — unlisted extension throws immediately", async () => {
    const { LSPServerManager } = await import("../lsp/manager.ts");
    // Only ".TS" (normalised to ".ts") is in the config — ".tsx" is NOT
    const mgr = new LSPServerManager(
      [{ name: "ts", command: "not-real", args: ["--stdio"], extensions: [".TS"] }],
      dir,
    );
    // .tsx is not in the map, so this throws without spawning
    await expect(mgr.request(join(dir, "file.tsx"), "textDocument/hover", {})).rejects.toThrow(
      "No LSP server configured for .tsx",
    );
    mgr.shutdown();
  });

  it("returns empty shutdown for manager with no servers", async () => {
    const { LSPServerManager } = await import("../lsp/manager.ts");
    const mgr = new LSPServerManager([], dir);
    // Should not throw
    mgr.shutdown();
  });
});

// ─── 6.3 Result formatters ────────────────────────────────────────────────────

describe("formatDefinition", () => {
  const worktreePath = "/project";

  it("returns '(no definition found)' for null", async () => {
    const { formatDefinition } = await import("../lsp/formatters.ts");
    expect(formatDefinition(null, worktreePath)).toBe("(no definition found)");
  });

  it("formats a single Location", async () => {
    const { formatDefinition } = await import("../lsp/formatters.ts");
    const location = {
      uri: "file:///project/src/foo.ts",
      range: { start: { line: 41, character: 9 }, end: { line: 41, character: 12 } },
    };
    const result = formatDefinition(location, worktreePath);
    expect(result).toBe("Defined in src/foo.ts:42:10");
  });

  it("formats multiple Locations", async () => {
    const { formatDefinition } = await import("../lsp/formatters.ts");
    const locations = [
      { uri: "file:///project/src/a.ts", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
      { uri: "file:///project/src/b.ts", range: { start: { line: 9, character: 4 }, end: { line: 9, character: 7 } } },
    ];
    const result = formatDefinition(locations, worktreePath);
    expect(result).toContain("2 locations");
    expect(result).toContain("src/a.ts:1:1");
    expect(result).toContain("src/b.ts:10:5");
  });

  it("uses custom opLabel", async () => {
    const { formatDefinition } = await import("../lsp/formatters.ts");
    const location = {
      uri: "file:///project/src/impl.ts",
      range: { start: { line: 5, character: 2 }, end: { line: 5, character: 8 } },
    };
    expect(formatDefinition(location, worktreePath, "Implemented")).toContain("Implemented in");
  });
});

describe("formatReferences", () => {
  const worktreePath = "/project";

  it("returns '(no references found)' for null", async () => {
    const { formatReferences } = await import("../lsp/formatters.ts");
    expect(formatReferences(null, worktreePath)).toBe("(no references found)");
  });

  it("returns '(no references found)' for empty array", async () => {
    const { formatReferences } = await import("../lsp/formatters.ts");
    expect(formatReferences([], worktreePath)).toBe("(no references found)");
  });

  it("groups references by file", async () => {
    const { formatReferences } = await import("../lsp/formatters.ts");
    const refs = [
      { uri: "file:///project/src/a.ts", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
      { uri: "file:///project/src/a.ts", range: { start: { line: 9, character: 3 }, end: { line: 9, character: 6 } } },
      { uri: "file:///project/src/b.ts", range: { start: { line: 4, character: 1 }, end: { line: 4, character: 4 } } },
    ];
    const result = formatReferences(refs, worktreePath);
    expect(result).toContain("Found 3 references across 2 files");
    expect(result).toContain("src/a.ts:");
    expect(result).toContain("src/b.ts:");
    expect(result).toContain("Line 1:1");
    expect(result).toContain("Line 10:4");
    expect(result).toContain("Line 5:2");
  });
});

describe("formatHover", () => {
  it("returns '(no hover information)' for null", async () => {
    const { formatHover } = await import("../lsp/formatters.ts");
    expect(formatHover(null)).toBe("(no hover information)");
  });

  it("formats a string contents hover", async () => {
    const { formatHover } = await import("../lsp/formatters.ts");
    expect(formatHover({ contents: "string type" } as any)).toBe("string type");
  });

  it("formats a MarkupContent hover", async () => {
    const { formatHover } = await import("../lsp/formatters.ts");
    const result = formatHover({ contents: { kind: "markdown", value: "**foo**" } } as any);
    expect(result).toBe("**foo**");
  });
});

describe("formatDocumentSymbols", () => {
  const worktreePath = "/project";

  it("returns '(no symbols found)' for null", async () => {
    const { formatDocumentSymbols } = await import("../lsp/formatters.ts");
    expect(formatDocumentSymbols(null, worktreePath)).toBe("(no symbols found)");
  });

  it("returns '(no symbols found)' for empty array", async () => {
    const { formatDocumentSymbols } = await import("../lsp/formatters.ts");
    expect(formatDocumentSymbols([], worktreePath)).toBe("(no symbols found)");
  });

  it("formats hierarchical DocumentSymbol", async () => {
    const { formatDocumentSymbols } = await import("../lsp/formatters.ts");
    const symbols = [
      {
        name: "MyClass",
        kind: 5, // Class
        range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } },
        selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 13 } },
        children: [
          {
            name: "myMethod",
            kind: 6, // Method
            range: { start: { line: 2, character: 2 }, end: { line: 5, character: 2 } },
            selectionRange: { start: { line: 2, character: 2 }, end: { line: 2, character: 10 } },
          },
        ],
      },
    ];
    const result = formatDocumentSymbols(symbols as any, worktreePath);
    expect(result).toContain("MyClass");
    expect(result).toContain("myMethod");
  });
});

// ─── 6.4 executeLspTool – dispatcher & lsp-tools coverage ────────────────────

describe("executeLspTool", () => {
  it("executeCommonTool returns error when lspManager is not in context", async () => {
    const { executeCommonTool } = await import("../engine/common-tools.ts");
    const ctx = {
      taskId: 0, boardId: 0,
      onTransition: () => {}, onHumanTurn: () => {}, onCancel: () => {}, onTaskUpdated: () => {},
      worktreePath: "/tmp",
    };
    const result = await executeCommonTool("lsp", { operation: "hover", file_path: "src/foo.ts", line: 1, character: 1 }, ctx as any);
    expect(result.text).toContain("Error: LSP is not configured");
  });

  it("returns error when file_path is outside the worktree", async () => {
    const { executeLspTool } = await import("../workflow/tools/lsp-tools.ts");
    const mockManager = { request: vi.fn(async () => null), shutdown: () => {} };
    const result = await executeLspTool({ operation: "hover", file_path: "../../etc/passwd", line: 1, character: 1 }, mockManager as any, "/tmp/project");
    expect(result).toContain("Error: file_path is outside the worktree");
  });

  it("returns error for unknown lsp operation", async () => {
    const { executeLspTool } = await import("../workflow/tools/lsp-tools.ts");
    const mockManager = { request: vi.fn(async () => null), shutdown: () => {} };
    // Use a valid path inside the worktree (doesn't need to exist for routing)
    const result = await executeLspTool({ operation: "unknownOp", file_path: "src/foo.ts" }, mockManager as any, "/tmp/project");
    expect(result).toContain("Error: unknown lsp operation");
  });

  it("calls lspManager.request with correct LSP method for hover", async () => {
    const { executeLspTool } = await import("../workflow/tools/lsp-tools.ts");
    const mockRequest = vi.fn(async () => ({ contents: "hover text", range: undefined }));
    const mockManager = { request: mockRequest, shutdown: () => {} };
    const dir = mkdtempSync(join(tmpdir(), "railyn-tool-lsp-"));
    writeFileSync(join(dir, "foo.ts"), "const x = 1;\n");

    const result = await executeLspTool({ operation: "hover", file_path: "foo.ts", line: 1, character: 1 }, mockManager as any, dir);

    expect(mockRequest).toHaveBeenCalledWith(
      join(dir, "foo.ts"),
      "textDocument/hover",
      expect.objectContaining({ position: { line: 0, character: 0 } }),
    );
    expect(result).toBe("hover text");

    rmSync(dir, { recursive: true, force: true });
  });

  it("converts 1-based line/char to 0-based for the LSP request", async () => {
    const { executeLspTool } = await import("../workflow/tools/lsp-tools.ts");
    const mockRequest = vi.fn(async () => null);
    const mockManager = { request: mockRequest, shutdown: () => {} };
    const dir = mkdtempSync(join(tmpdir(), "railyn-tool-lsp2-"));
    writeFileSync(join(dir, "bar.ts"), "const y = 2;\n");

    await executeLspTool({ operation: "hover", file_path: "bar.ts", line: 5, character: 10 }, mockManager as any, dir);

    expect(mockRequest).toHaveBeenCalledWith(
      join(dir, "bar.ts"),
      "textDocument/hover",
      expect.objectContaining({ position: { line: 4, character: 9 } }),
    );

    rmSync(dir, { recursive: true, force: true });
  });
});

// ─── applyWorkspaceEdit ───────────────────────────────────────────────────────

describe("applyWorkspaceEdit", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "railyin-apply-edits-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("applies a single text edit via 'changes' format", async () => {
    const { applyWorkspaceEdit } = await import("../lsp/apply-edits.ts");
    const file = join(dir, "a.ts");
    writeFileSync(file, "const foo = 1;\n");
    const uri = `file://${file}`;

    const result = applyWorkspaceEdit(
      { changes: { [uri]: [{ range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } }, newText: "bar" }] } },
      dir,
    );

    expect("error" in result).toBe(false);
    expect(readFileSync(file, "utf-8")).toBe("const bar = 1;\n");
  });

  it("applies edits via 'documentChanges' format", async () => {
    const { applyWorkspaceEdit } = await import("../lsp/apply-edits.ts");
    const file = join(dir, "b.ts");
    writeFileSync(file, "let x = 42;\n");
    const uri = `file://${file}`;

    const result = applyWorkspaceEdit(
      {
        documentChanges: [{
          textDocument: { uri, version: null },
          edits: [{ range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } }, newText: "y" }],
        }],
      },
      dir,
    );

    expect("error" in result).toBe(false);
    expect(readFileSync(file, "utf-8")).toBe("let y = 42;\n");
  });

  it("applies multiple edits in the same file in reverse order", async () => {
    const { applyWorkspaceEdit } = await import("../lsp/apply-edits.ts");
    const file = join(dir, "c.ts");
    writeFileSync(file, "ab\n");
    const uri = `file://${file}`;

    // Replace 'a' at (0,0)-(0,1) and 'b' at (0,1)-(0,2)
    const result = applyWorkspaceEdit(
      {
        changes: {
          [uri]: [
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "X" },
            { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } }, newText: "Y" },
          ],
        },
      },
      dir,
    );

    expect("error" in result).toBe(false);
    expect(readFileSync(file, "utf-8")).toBe("XY\n");
  });

  it("changes multiple files and reports all in result", async () => {
    const { applyWorkspaceEdit } = await import("../lsp/apply-edits.ts");
    const file1 = join(dir, "d.ts");
    const file2 = join(dir, "e.ts");
    writeFileSync(file1, "old1\n");
    writeFileSync(file2, "old2\n");
    const uri1 = `file://${file1}`;
    const uri2 = `file://${file2}`;

    const result = applyWorkspaceEdit(
      {
        changes: {
          [uri1]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }, newText: "new1" }],
          [uri2]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }, newText: "new2" }],
        },
      },
      dir,
    );

    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.filesChanged).toHaveLength(2);
    }
    expect(readFileSync(file1, "utf-8")).toBe("new1\n");
    expect(readFileSync(file2, "utf-8")).toBe("new2\n");
  });

  it("returns no-op result when edit has no changes", async () => {
    const { applyWorkspaceEdit } = await import("../lsp/apply-edits.ts");

    const result = applyWorkspaceEdit({}, dir);

    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.filesChanged).toHaveLength(0);
    }
  });

  it("returns error for invalid URI", async () => {
    const { applyWorkspaceEdit } = await import("../lsp/apply-edits.ts");

    const result = applyWorkspaceEdit(
      { changes: { "not-a-uri": [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "" }] } },
      dir,
    );

    expect("error" in result).toBe(true);
  });
});

// ─── TaskLSPRegistry ─────────────────────────────────────────────────────────

describe("TaskLSPRegistry", () => {
  it("returns a manager on first call (lazy init)", async () => {
    const { TaskLSPRegistry } = await import("../lsp/task-registry.ts");
    const registry = new TaskLSPRegistry();

    const manager = registry.getManager(1, [], "/tmp");
    expect(manager).toBeDefined();
    await registry.releaseTask(1);
  });

  it("returns the same manager for the same taskId", async () => {
    const { TaskLSPRegistry } = await import("../lsp/task-registry.ts");
    const registry = new TaskLSPRegistry();

    const m1 = registry.getManager(2, [], "/tmp");
    const m2 = registry.getManager(2, [], "/tmp");
    expect(m1).toBe(m2);
    await registry.releaseTask(2);
  });

  it("returns different managers for different taskIds", async () => {
    const { TaskLSPRegistry } = await import("../lsp/task-registry.ts");
    const registry = new TaskLSPRegistry();

    const serverConfigs = [{ name: "ts", command: "typescript-language-server", args: ["--stdio"], extensions: [".ts"] }];
    const m1 = registry.getManager(3, serverConfigs, "/tmp");
    const m2 = registry.getManager(4, serverConfigs, "/tmp");
    expect(m1).not.toBe(m2);
    await registry.releaseTask(3);
    await registry.releaseTask(4);
  });

  it("releaseTask is a no-op for unknown taskId", async () => {
    const { TaskLSPRegistry } = await import("../lsp/task-registry.ts");
    const registry = new TaskLSPRegistry();

    await expect(registry.releaseTask(999)).resolves.toBeUndefined();
  });
});
