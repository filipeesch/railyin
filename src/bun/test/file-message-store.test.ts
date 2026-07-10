import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "./helpers.ts";
import { FileConversationMessageStore } from "../conversation/file-message-store.ts";
import type { NewConversationMessageInput } from "../conversation/message-store.ts";

/**
 * Tests specific to `FileConversationMessageStore`'s on-disk representation — behavior that
 * has no equivalent in `LegacySqliteConversationMessageStore` and therefore isn't covered by
 * the shared contract suite (`conversation-message-store.contract.test.ts`): line-number-as-id
 * derivation, tombstone handling for corrupted lines, sidecar atomic write, sidecar self-heal
 * on drift, and compaction-anchor lookup via sidecar fields. Real tmpdir, no fakes, per the
 * locked decision for this store's concurrency/behavior tests.
 */
describe("FileConversationMessageStore — file-specific behavior", () => {
  let dir: string;
  let cleanup: () => void;
  const conversationId = 1;

  beforeEach(() => {
    const created = makeTempDir();
    dir = created.dir;
    cleanup = created.cleanup;
  });

  afterEach(() => cleanup());

  function msg(overrides: Partial<NewConversationMessageInput> = {}): NewConversationMessageInput {
    return {
      taskId: null,
      type: "user",
      role: "user",
      content: "hello",
      metadata: null,
      ...overrides,
    };
  }

  function jsonlPath(): string {
    return join(dir, `${conversationId}.jsonl`);
  }

  function metaPath(): string {
    return join(dir, `${conversationId}.meta.json`);
  }

  it("id = 1-based line number, derived from position rather than stored redundantly", async () => {
    const store = new FileConversationMessageStore(conversationId, dir);
    const first = await store.append(msg({ content: "one" }));
    const second = await store.append(msg({ content: "two" }));
    const third = await store.append(msg({ content: "three" }));

    expect([first.id, second.id, third.id]).toEqual([1, 2, 3]);

    const raw = await fs.readFile(jsonlPath(), "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(3);
    // The id itself is never present as a field in the stored JSON line.
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed.id).toBeUndefined();
    }
  });

  it("a corrupted line is treated as a tombstone: skipped on read, but later ids stay stable", async () => {
    const store = new FileConversationMessageStore(conversationId, dir);
    await store.append(msg({ content: "one" }));
    await store.append(msg({ content: "two" }));
    await store.append(msg({ content: "three" }));

    // Simulate a crash mid-write: corrupt line 2's JSON.
    const raw = await fs.readFile(jsonlPath(), "utf-8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    lines[1] = "{not valid json,,,";
    await fs.writeFile(jsonlPath(), `${lines.join("\n")}\n`, "utf-8");
    // Sidecar now disagrees with actual byte length — force a recompute on next read.
    await fs.rm(metaPath(), { force: true });

    const rows = await store.getAll();
    // Corrupted line 2 is skipped; line-number-as-id for line 3 is preserved (not renumbered).
    expect(rows.map((r) => r.id)).toEqual([1, 3]);
    expect(rows.map((r) => r.content)).toEqual(["one", "three"]);

    const byId2 = await store.getById(2);
    expect(byId2).toBeNull();
    const byId3 = await store.getById(3);
    expect(byId3?.content).toBe("three");
  });

  it("sidecar is written atomically via temp file + rename (no dangling .tmp file after append)", async () => {
    const store = new FileConversationMessageStore(conversationId, dir);
    await store.append(msg({ content: "one" }));

    const entries = await fs.readdir(dir);
    expect(entries).toContain(`${conversationId}.meta.json`);
    expect(entries.some((name) => name.endsWith(".tmp"))).toBe(false);

    const sidecar = JSON.parse(await fs.readFile(metaPath(), "utf-8")) as { lineCount: number; byteLength: number };
    expect(sidecar.lineCount).toBe(1);
    const actualSize = (await fs.stat(jsonlPath())).size;
    expect(sidecar.byteLength).toBe(actualSize);
  });

  it("self-heals when the sidecar byteLength drifts from the actual JSONL file", async () => {
    const store = new FileConversationMessageStore(conversationId, dir);
    await store.append(msg({ content: "one" }));
    await store.append(msg({ content: "two" }));

    // Simulate drift: sidecar reports a byteLength that no longer matches the file
    // (e.g. a crash that wrote the JSONL append but never got to persist the sidecar).
    await fs.writeFile(
      metaPath(),
      JSON.stringify({ lineCount: 1, byteLength: 1, lastCompactionSummaryId: null, lastCompactionSummaryByteOffset: null }),
      "utf-8",
    );

    // Any read path triggers a recompute-and-persist of the sidecar from the real JSONL file.
    const rows = await store.getAll();
    expect(rows).toHaveLength(2);

    const healedSidecar = JSON.parse(await fs.readFile(metaPath(), "utf-8")) as { lineCount: number; byteLength: number };
    expect(healedSidecar.lineCount).toBe(2);
    const actualSize = (await fs.stat(jsonlPath())).size;
    expect(healedSidecar.byteLength).toBe(actualSize);
  });

  it("getLastByType('compaction_summary') resolves via the sidecar anchor without a full scan", async () => {
    const store = new FileConversationMessageStore(conversationId, dir);
    await store.append(msg({ type: "user", content: "hi" }));
    await store.append(msg({ type: "assistant", content: "hello" }));
    await store.append(msg({ type: "compaction_summary", role: null, content: "summary-1" }));
    await store.append(msg({ type: "user", content: "more" }));

    const sidecar = JSON.parse(await fs.readFile(metaPath(), "utf-8")) as {
      lastCompactionSummaryId: number | null;
      lastCompactionSummaryByteOffset: number | null;
    };
    expect(sidecar.lastCompactionSummaryId).toBe(3);
    expect(sidecar.lastCompactionSummaryByteOffset).not.toBeNull();

    const anchor = await store.getLastByType("compaction_summary");
    expect(anchor?.id).toBe(3);
    expect(anchor?.content).toBe("summary-1");
  });

  it("getLastByType('compaction_summary') returns null when no compaction has occurred", async () => {
    const store = new FileConversationMessageStore(conversationId, dir);
    await store.append(msg({ type: "user", content: "hi" }));

    const anchor = await store.getLastByType("compaction_summary");
    expect(anchor).toBeNull();
  });

  it("compaction anchor tracks the MOST RECENT compaction_summary across multiple compactions", async () => {
    const store = new FileConversationMessageStore(conversationId, dir);
    await store.append(msg({ type: "compaction_summary", role: null, content: "summary-1" }));
    await store.append(msg({ type: "user", content: "more work" }));
    await store.append(msg({ type: "compaction_summary", role: null, content: "summary-2" }));

    const anchor = await store.getLastByType("compaction_summary");
    expect(anchor?.id).toBe(3);
    expect(anchor?.content).toBe("summary-2");
  });

  it("two concurrent appends to the same conversation do not interleave (real Promise.all, no fakes)", async () => {
    const store = new FileConversationMessageStore(conversationId, dir);

    // Fire both without awaiting the first, per the locked decision for this test.
    const p1 = store.append(msg({ content: "first" }));
    const p2 = store.append(msg({ content: "second" }));
    const [r1, r2] = await Promise.all([p1, p2]);

    // The per-conversation write queue guarantees issue order, not call-completion order —
    // since p1 was enqueued before p2, its write must land on line 1.
    expect(r1.id).toBe(1);
    expect(r2.id).toBe(2);

    const raw = await fs.readFile(jsonlPath(), "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    // Every line must be well-formed, individually parseable JSON — no interleaved/corrupted
    // writes from the two concurrent appends racing on the same file.
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    expect((JSON.parse(lines[0]) as { content: string }).content).toBe("first");
    expect((JSON.parse(lines[1]) as { content: string }).content).toBe("second");
  });
});
