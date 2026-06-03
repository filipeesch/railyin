import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UndoStack } from "../engine/pi/harness/undo-stack.ts";
import { buildUndoTool } from "../engine/pi/tools/undo.ts";
import type { HarnessContext } from "../engine/pi/harness/context.ts";

function makeHarness(dir: string): HarnessContext {
  return {
    undoStack: new UndoStack(),
    worktreePath: dir,
    loopDetector: {} as any,
  };
}

describe("undo_write — lsp_rename support (UW)", () => {
  let dir: string;
  let ctx: HarnessContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "railyn-uw-"));
    ctx = makeHarness(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("UW-1: reverts modified files to their before-content", async () => {
    const file = join(dir, "a.ts");
    writeFileSync(file, "new content");

    const opId = ctx.undoStack.push({ type: "lsp_rename", beforeFiles: { [file]: "old content" } });
    const [tool] = buildUndoTool(ctx);

    await tool.execute("id", { operationId: opId });

    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf-8")).toBe("old content");
  });

  it("UW-2: deletes a newly-created file when beforeContent is null", async () => {
    const file = join(dir, "new.ts");
    writeFileSync(file, "brand new");

    const opId = ctx.undoStack.push({ type: "lsp_rename", beforeFiles: { [file]: null } });
    const [tool] = buildUndoTool(ctx);

    await tool.execute("id", { operationId: opId });

    expect(existsSync(file)).toBe(false);
  });

  it("UW-3: returns OK message with correct file count", async () => {
    const a = join(dir, "a.ts");
    const b = join(dir, "b.ts");
    writeFileSync(a, "a-new");
    writeFileSync(b, "b-new");

    const opId = ctx.undoStack.push({ type: "lsp_rename", beforeFiles: { [a]: "a-old", [b]: "b-old" } });
    const [tool] = buildUndoTool(ctx);

    const result = await tool.execute("id", { operationId: opId });
    expect((result.content[0] as { text: string }).text).toContain("restored 2 files");
  });

  it("UW-4: returns error when operationId is unknown", async () => {
    const [tool] = buildUndoTool(ctx);
    const result = await tool.execute("id", { operationId: "op:dead" });
    expect((result as any).isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("no longer in undo history");
  });

  it("UW-5: returns error when neither operationId nor path provided", async () => {
    const [tool] = buildUndoTool(ctx);
    const result = await tool.execute("id", {});
    expect((result as any).isError).toBe(true);
  });


  it("UW-7: snapshot is removed from stack after successful undo", async () => {
    const file = join(dir, "z.ts");
    writeFileSync(file, "new");

    const opId = ctx.undoStack.push({ type: "lsp_rename", beforeFiles: { [file]: "old" } });
    const [tool] = buildUndoTool(ctx);

    await tool.execute("id", { operationId: opId });

    // Stack should be empty — the snapshot was consumed
    expect(ctx.undoStack.size).toBe(0);
  });
});
