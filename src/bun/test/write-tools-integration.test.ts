import { describe, expect, it, beforeEach, afterEach } from "vitest";
// Test utilities use real node:fs directly — fs-ops.ts is only for mocking tool calls.
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UndoStack } from "../engine/pi/harness/undo-stack.ts";
import { buildWriteTools } from "../engine/pi/tools/write.ts";
import type { HarnessContext } from "../engine/pi/harness/context.ts";
import type { FileDiffPayload } from "@shared/rpc-types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeHarness(dir: string): HarnessContext {
	return { undoStack: new UndoStack(), worktreePath: dir, loopDetector: {} as any, signal: new AbortController().signal };
}

/* ------------------------------------------------------------------ */
/*  write_file integration (WI)                                       */
/* ------------------------------------------------------------------ */

describe("write_file integration (WI)", () => {
	let dir: string;
	let ctx: HarnessContext;
	let toolList: ReturnType<typeof buildWriteTools>;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "railyn-wi-"));
		ctx = makeHarness(dir);
		toolList = buildWriteTools(ctx);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("WI-WF-1: creates a new file on disk with correct payload and is_new flag", async () => {
		const tool = toolList.find((t) => t.name === "write_file")!;
		const result = await tool.execute("tc-1", { path: "new.txt", content: "hello world\n" });

		expect(existsSync(join(dir, "new.txt"))).toBe(true);
		expect(readFileSync(join(dir, "new.txt"), "utf-8")).toBe("hello world\n");

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("(+1)"); // "hello world\n" → 1 line per splitLines

		const wf = (result.details as { writtenFiles?: FileDiffPayload[] }).writtenFiles;
		expect(wf).toHaveLength(1);
		expect(wf![0].operation).toBe("write_file");
		expect(wf![0].is_new).toBe(true);
		expect(wf![0].removed).toBe(0);
		expect(wf![0].added).toBeGreaterThan(0);
	});

	it("WI-WF-2: overwrites existing file with correct added/removed counts", async () => {
		writeFileSync(join(dir, "over.txt"), "line1\nline2\nline3\n");

		const tool = toolList.find((t) => t.name === "write_file")!;
		const result = await tool.execute("tc-2", {
			path: "over.txt",
			content: "line1\nchanged\nline3\n",
		});

		expect(readFileSync(join(dir, "over.txt"), "utf-8")).toBe("line1\nchanged\nline3\n");

		const wf = (result.details as { writtenFiles?: FileDiffPayload[] }).writtenFiles!;
		expect(wf[0].added).toBe(1);
		expect(wf[0].removed).toBe(1);
	});

	it("WI-WF-3: returns error on path traversal", async () => {
		const tool = toolList.find((t) => t.name === "write_file")!;
		const result = await tool.execute("tc-3", { path: "../../etc/passwd", content: "hack" });
		expect((result as any).isError).toBe(true);
	});
});

/* ------------------------------------------------------------------ */
/*  patch_file integration (WIP)                                      */
/* ------------------------------------------------------------------ */

describe("patch_file integration (WIP)", () => {
	let dir: string;
	let ctx: HarnessContext;
	let toolList: ReturnType<typeof buildWriteTools>;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "railyn-wip-"));
		ctx = makeHarness(dir);
		toolList = buildWriteTools(ctx);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("WI-PF-1: replace position substitutes anchor with correct counts", async () => {
		writeFileSync(join(dir, "replace.txt"), "first\nold line\nthird\n");
		const tool = toolList.find((t) => t.name === "patch_file")!;
		const result = await tool.execute("tc-1", {
			path: "replace.txt",
			anchor: "old line",
			position: "replace",
			content: "NEW LINE",
		});

		expect(readFileSync(join(dir, "replace.txt"), "utf-8")).toBe("first\nNEW LINE\nthird\n");

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("(+1 -1"); // 1 added, 1 removed

		const wf = (result.details as { writtenFiles?: FileDiffPayload[] }).writtenFiles!;
		expect(wf[0].operation).toBe("patch_file");
		expect(wf[0].added).toBe(1);
		expect(wf[0].removed).toBe(1);
	});

	it("WI-PF-2: before position inserts content without removing", async () => {
		writeFileSync(join(dir, "before.txt"), "anchor_text\n");
		const tool = toolList.find((t) => t.name === "patch_file")!;
		const result = await tool.execute("tc-2", {
			path: "before.txt",
			anchor: "anchor_text",
			position: "before",
			content: "inserted\n",
		});

		expect(readFileSync(join(dir, "before.txt"), "utf-8")).toBe("inserted\nanchor_text\n");

		const wf = (result.details as { writtenFiles?: FileDiffPayload[] }).writtenFiles!;
		expect(wf[0].added).toBeGreaterThan(0);
		expect(wf[0].removed).toBe(0);
	});

	it("WI-PF-3: rejects duplicate anchor", async () => {
		writeFileSync(join(dir, "dup.txt"), "same\nsame\n");
		const tool = toolList.find((t) => t.name === "patch_file")!;
		const result = await tool.execute("tc-3", {
			path: "dup.txt",
			anchor: "same",
			position: "replace",
			content: "replaced",
		});

		expect((result as any).isError).toBe(true);
		// File should be unchanged
		expect(readFileSync(join(dir, "dup.txt"), "utf-8")).toBe("same\nsame\n");
	});

	it("WI-PF-4: rejects missing anchor", async () => {
		writeFileSync(join(dir, "miss.txt"), "content here\n");
		const tool = toolList.find((t) => t.name === "patch_file")!;
		const result = await tool.execute("tc-4", {
			path: "miss.txt",
			anchor: "NOT_FOUND",
			position: "replace",
			content: "replaced",
		});

		expect((result as any).isError).toBe(true);
		expect(readFileSync(join(dir, "miss.txt"), "utf-8")).toBe("content here\n");
	});
});
/* ------------------------------------------------------------------ */
/*  delete_file integration (WID)                                     */
/* ------------------------------------------------------------------ */

describe("delete_file integration (WID)", () => {
	let dir: string;
	let ctx: HarnessContext;
	let toolList: ReturnType<typeof buildWriteTools>;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "railyn-wid-"));
		ctx = makeHarness(dir);
		toolList = buildWriteTools(ctx);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("WI-DIF-1: removes file and emits diff with all lines as 'removed'", async () => {
		const fileContent = "line1\nline2\nline3\n";
		writeFileSync(join(dir, "del.txt"), fileContent);

		const tool = toolList.find((t) => t.name === "delete_file")!;
		const result = await tool.execute("tc-1", { path: "del.txt" });

		expect(existsSync(join(dir, "del.txt"))).toBe(false);

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("(-"); // negative count format

		const wf = (result.details as { writtenFiles?: FileDiffPayload[] }).writtenFiles!;
		expect(wf[0].operation).toBe("delete_file");
		expect(wf[0].added).toBe(0);
		expect(wf[0].removed).toBe(3); // 3 lines in content
		expect(wf[0].hunks).toHaveLength(1);
		const allRemoved = wf[0].hunks![0].lines.filter((l: { type: string }) => l.type === "removed");
		expect(allRemoved.length).toBe(3);
	});

	it("WI-DIF-2: non-existent file returns error", async () => {
		const tool = toolList.find((t) => t.name === "delete_file")!;
		const result = await tool.execute("tc-2", { path: "nonexistent.txt" });
		expect((result as any).isError).toBe(true);
	});
});

/* ------------------------------------------------------------------ */
/*  rename_file integration (WIN)                                     */
/* ------------------------------------------------------------------ */

describe("rename_file integration (WIN)", () => {
	let dir: string;
	let ctx: HarnessContext;
	let toolList: ReturnType<typeof buildWriteTools>;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "railyn-win-"));
		ctx = makeHarness(dir);
		toolList = buildWriteTools(ctx);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("WI-RNF-1: moves file, original gone, destination has content", async () => {
		writeFileSync(join(dir, "a.txt"), "original content");

		const tool = toolList.find((t) => t.name === "rename_file")!;
		const result = await tool.execute("tc-1", { from: "a.txt", to: "b.txt" });

		expect(existsSync(join(dir, "a.txt"))).toBe(false);
		expect(existsSync(join(dir, "b.txt"))).toBe(true);
		expect(readFileSync(join(dir, "b.txt"), "utf-8")).toBe("original content");

		const wf = (result.details as { writtenFiles?: FileDiffPayload[] }).writtenFiles!;
		expect(wf[0].operation).toBe("rename_file");
		expect(wf[0].path).toBe("a.txt");
		expect(wf[0].to_path).toBe("b.txt");
		expect(wf[0].added).toBe(0);
		expect(wf[0].removed).toBe(0);
	});
});

