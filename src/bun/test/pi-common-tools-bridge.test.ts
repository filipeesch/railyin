import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildCommonTools } from "../engine/pi/tools/common.ts";
import { ContentHashCache } from "../engine/pi/harness/hash-cache.ts";
import { UndoStack } from "../engine/pi/harness/undo-stack.ts";
import type { HarnessContext } from "../engine/pi/harness/context.ts";
import type { CommonToolContext } from "../engine/types.ts";
import type { ToolExecutionResult } from "../engine/common-tools.ts";
import type { AIToolDefinition } from "../ai/types.ts";

// ---------------------------------------------------------------------------
// Minimal tool definitions — injected via DI to avoid vi.mock() contamination
// ---------------------------------------------------------------------------

const FAKE_TOOL_DEFS: AIToolDefinition[] = [
  {
    name: "lsp_rename",
    description: "Rename a symbol via LSP",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "lsp_hover",
    description: "Get hover info",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

function makeHarness(dir: string): HarnessContext {
  return {
    hashCache: new ContentHashCache(),
    undoStack: new UndoStack(),
    worktreePath: dir,
  };
}

function makeCtx(): CommonToolContext {
  return {} as CommonToolContext;
}

describe("Pi common-tools bridge (PCB)", () => {
  let dir: string;
  let mockExecutor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "railyn-pcb-"));
    mockExecutor = vi.fn();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("PCB-1: lsp_rename result with beforeFiles pushes snapshot to UndoStack and appends [op:XXXX]", async () => {
    const harness = makeHarness(dir);

    const fakeResult: ToolExecutionResult = {
      type: "result",
      text: "Renamed foo → bar in 1 file",
      writtenFiles: [],
      beforeFiles: { "/a.ts": "old content" },
    };
    mockExecutor.mockResolvedValueOnce(fakeResult);

    const tools = buildCommonTools(makeCtx(), harness, FAKE_TOOL_DEFS, mockExecutor);
    const lspRename = tools.find((t) => t.name === "lsp_rename")!;
    const result = await lspRename.execute("id", {});

    expect(harness.undoStack.size).toBe(1);
    expect(result.content[0].text).toMatch(/\[op:[0-9a-f]{4}\]/);
    expect(result.content[0].text).toContain("Renamed foo");
  });

  it("PCB-2: result without beforeFiles does not push to UndoStack", async () => {
    const harness = makeHarness(dir);

    const fakeResult: ToolExecutionResult = {
      type: "result",
      text: "Hover info here",
    };
    mockExecutor.mockResolvedValueOnce(fakeResult);

    const tools = buildCommonTools(makeCtx(), harness, FAKE_TOOL_DEFS, mockExecutor);
    const lspHover = tools.find((t) => t.name === "lsp_hover")!;
    const result = await lspHover.execute("id", {});

    expect(harness.undoStack.size).toBe(0);
    expect(result.content[0].text).toBe("Hover info here");
  });

  it("PCB-3: without harnessCtx, beforeFiles result does not push to UndoStack", async () => {
    const fakeResult: ToolExecutionResult = {
      type: "result",
      text: "Renamed",
      beforeFiles: { "/a.ts": "old" },
    };
    mockExecutor.mockResolvedValueOnce(fakeResult);

    // No harnessCtx passed
    const tools = buildCommonTools(makeCtx(), undefined, FAKE_TOOL_DEFS, mockExecutor);
    const lspRename = tools.find((t) => t.name === "lsp_rename")!;
    const result = await lspRename.execute("id", {});

    // Text should NOT have [op:XXXX] appended
    expect(result.content[0].text).not.toMatch(/\[op:/);
    expect(result.content[0].text).toBe("Renamed");
  });

  it("PCB-4: writtenFiles are forwarded in tool details", async () => {
    const harness = makeHarness(dir);

    const fakeResult: ToolExecutionResult = {
      type: "result",
      text: "Done",
      writtenFiles: [{ path: "a.ts", added: 1, removed: 0, chunks: [] }],
      beforeFiles: { "/a.ts": "old" },
    };
    mockExecutor.mockResolvedValueOnce(fakeResult);

    const tools = buildCommonTools(makeCtx(), harness, FAKE_TOOL_DEFS, mockExecutor);
    const lspRename = tools.find((t) => t.name === "lsp_rename")!;
    const result = await lspRename.execute("id", {});

    expect(result.details.writtenFiles).toBeDefined();
    expect(result.details.writtenFiles).toHaveLength(1);
    expect(result.details.writtenFiles[0].path).toBe("a.ts");
  });
});
