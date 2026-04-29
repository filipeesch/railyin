import { describe, test, expect, beforeEach } from "bun:test";
import { StreamEventEnricher } from "./stream-event-enricher.ts";

describe("StreamEventEnricher", () => {
  let enricher: StreamEventEnricher;

  beforeEach(() => {
    enricher = new StreamEventEnricher(100);
  });

  test("text chunks share the same blockId", () => {
    const a = enricher.enrich("text_chunk");
    const b = enricher.enrich("text_chunk");
    expect(a.blockId).toBe("100-t1");
    expect(b.blockId).toBe("100-t1");
  });

  test("reasoning then text produce different blockIds", () => {
    const r = enricher.enrich("reasoning_chunk");
    const t = enricher.enrich("text_chunk");
    expect(r.blockId).toBe("100-r1");
    expect(t.blockId).toBe("100-t1");
    expect(r.blockId).not.toBe(t.blockId);
  });

  test("interleaved reasoning and text produce separate blockIds per block", () => {
    const r1 = enricher.enrich("reasoning_chunk");
    const t1 = enricher.enrich("text_chunk");
    const r2 = enricher.enrich("reasoning_chunk");
    const t2 = enricher.enrich("text_chunk");
    expect(r1.blockId).toBe("100-r1");
    expect(t1.blockId).toBe("100-t1");
    expect(r2.blockId).toBe("100-r2");
    expect(t2.blockId).toBe("100-t2");
  });

  test("seq is monotonically increasing", () => {
    const a = enricher.enrich("text_chunk");
    const b = enricher.enrich("reasoning_chunk");
    const c = enricher.enrich("text_chunk");
    expect(a.seq).toBe(0);
    expect(b.seq).toBe(1);
    expect(c.seq).toBe(2);
  });

  test("tool_call with explicit blockId resets the current text block", () => {
    enricher.enrich("text_chunk");
    const tool = enricher.enrich("tool_call", "call_abc");
    expect(tool.blockId).toBe("call_abc");
    // next text_chunk should open a new block
    const t2 = enricher.enrich("text_chunk");
    expect(t2.blockId).toBe("100-t2");
  });

  test("done event gets its own blockId", () => {
    const done = enricher.enrich("done");
    expect(done.blockId).toBe("100-done");
  });

  test("status_chunk gets a fixed status blockId", () => {
    const s = enricher.enrich("status_chunk");
    expect(s.blockId).toBe("100-status");
  });
});
