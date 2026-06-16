/**
 * Subprocess-specific tests for SubprocessCursorAdapter (§6.4).
 *
 * These tests spawn a real Node subprocess but point it at a controllable
 * stub worker (`fixtures/test-worker.mjs`) that mirrors the wire protocol
 * without importing @cursor/sdk. Each test scripts a specific scenario via
 * the `prompt` field of `startRun`.
 *
 * Skipped when no `node` binary is available on PATH.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { SDKCustomTool } from "@cursor/sdk";
import type { EngineEvent } from "@bun/engine/types";
import { SubprocessCursorAdapter } from "@bun/engine/cursor/worker-client";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "test-worker.mjs");

function nodeAvailable(): boolean {
  try {
    execSync("node --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const HAS_NODE = nodeAvailable();
const describeOrSkip = HAS_NODE ? describe : describe.skip;

const adapters: SubprocessCursorAdapter[] = [];

function newAdapter(): SubprocessCursorAdapter {
  const adapter = new SubprocessCursorAdapter({ apiKey: "test-key", workerScriptPath: FIXTURE });
  adapters.push(adapter);
  return adapter;
}

async function collectRun(adapter: SubprocessCursorAdapter, prompt: string, customTools: Record<string, SDKCustomTool> = {}): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  for await (const event of adapter.run({
    executionId: 1,
    taskId: 0,
    prompt,
    workingDirectory: process.cwd(),
    sessionId: "cursor-test",
    customTools,
  })) {
    events.push(event);
  }
  return events;
}

afterEach(async () => {
  while (adapters.length > 0) {
    const adapter = adapters.pop()!;
    await adapter.shutdownAll();
  }
});

describeOrSkip("SubprocessCursorAdapter — subprocess tests (§6.4)", () => {
  beforeAll(() => {
    if (!HAS_NODE) {
      console.warn("[cursor worker-client test] skipping — `node` not on PATH");
    }
  });

  it("§6.4.1 — startRun is gated on the worker's `ready` handshake (delayed-ready worker still completes correctly)", async () => {
    const prev = process.env.RAILYIN_TEST_READY_DELAY_MS;
    process.env.RAILYIN_TEST_READY_DELAY_MS = "150";
    try {
      const adapter = newAdapter();
      const start = Date.now();
      const events = await collectRun(adapter, "emit-token-then-ok");
      const elapsed = Date.now() - start;
      // If startRun was sent before ready, the worker would have ignored it
      // (input is processed via readline after ready logic completes) — the
      // emit would not arrive. Verify both that we received the token AND
      // that the elapsed time covered the ready-delay window.
      expect(events).toContainEqual({ type: "token", content: "hello" });
      expect(events.at(-1)).toEqual({ type: "done" });
      expect(elapsed).toBeGreaterThanOrEqual(140);
    } finally {
      if (prev === undefined) delete process.env.RAILYIN_TEST_READY_DELAY_MS;
      else process.env.RAILYIN_TEST_READY_DELAY_MS = prev;
    }
  });

  it("§6.4.2 — worker crash mid-run surfaces a fatal EngineEvent and the next call respawns the worker", async () => {
    const adapter = newAdapter();

    // First run: scripted crash. Expect a fatal error event.
    let crashError: Error | null = null;
    try {
      for await (const _ of adapter.run({
        executionId: 1,
        taskId: 0,
        prompt: "crash-mid-run",
        workingDirectory: process.cwd(),
        sessionId: "cursor-test-crash",
      })) {
        // drain
      }
    } catch (err) {
      crashError = err as Error;
    }
    expect(crashError).not.toBeNull();
    expect(crashError!.message).toMatch(/worker exited/i);

    // Second run on the same adapter should respawn the worker and succeed.
    const events = await collectRun(adapter, "emit-token-then-ok");
    expect(events).toContainEqual({ type: "token", content: "hello" });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("§6.4.3 — toolCall from worker → customTool.execute on Bun → toolResult back to worker", async () => {
    const adapter = newAdapter();

    let invokedWith: unknown = null;
    const echoTool: SDKCustomTool = {
      description: "echo back",
      inputSchema: { type: "object", properties: { msg: { type: "string" } } },
      execute: async (args) => {
        invokedWith = args;
        return "pong";
      },
    };

    const events = await collectRun(adapter, "tool-roundtrip", { echo_tool: echoTool });

    expect(invokedWith).toEqual({ msg: "ping" });
    // The fixture echoes the result back as a token event.
    expect(events).toContainEqual({ type: "token", content: "tool-said:pong" });
    expect(events.at(-1)).toEqual({ type: "done" });
  });
});
