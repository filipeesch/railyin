/**
 * Tests for buildShellTool()/buildShellTools() (run_command).
 *
 * Two tiers, per design.md Decision 8:
 *  - Fake-runner tests: orchestration logic (clamping, truncation wiring, signal
 *    wiring, description content) using an injected fake CommandRunner — instant,
 *    no real process spawned.
 *  - Real-process tests: actual Bun.spawn-based default runner, verifying the
 *    genuine SIGTERM -> grace period -> SIGKILL and process-group-kill behavior
 *    with short timeouts/grace periods to stay fast.
 */

import { describe, test, expect } from "bun:test";
import { buildShellTools } from "../../engine/pi/tools/shell.ts";
import { runCommand, type CommandRunner, type CommandRunResult } from "../../engine/pi/tools/shell-runner.ts";
import { truncateHeadTail } from "../../engine/pi/tools/truncate-output.ts";
import type { HarnessContext } from "../../engine/pi/harness/context.ts";
import { UndoStack } from "../../engine/pi/harness/undo-stack.ts";
import { ToolLoopDetector } from "../../engine/pi/harness/tool-loop-detector.ts";

function makeHarness(signal: AbortSignal = new AbortController().signal): HarnessContext {
  return {
    undoStack: new UndoStack(),
    worktreePath: process.cwd(),
    loopDetector: new ToolLoopDetector(),
    signal,
  };
}

function makeFakeRunner(result: Partial<CommandRunResult> = {}): {
  runner: CommandRunner;
  calls: Array<{ command: string; options: Parameters<CommandRunner>[1] }>;
} {
  const calls: Array<{ command: string; options: Parameters<CommandRunner>[1] }> = [];
  const runner: CommandRunner = async (command, options) => {
    calls.push({ command, options });
    return {
      stdout: "",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      aborted: false,
      ...result,
    };
  };
  return { runner, calls };
}

function getText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => c.text ?? "").join("\n");
}

// ─── Fake-runner orchestration tests ──────────────────────────────────────────

describe("run_command (fake runner)", () => {
  test("uses the canned result from the injected runner without spawning a real process", async () => {
    const { runner } = makeFakeRunner({ stdout: "hello\n", exitCode: 0 });
    const [tool] = buildShellTools(makeHarness(), runner);

    const result = await tool.execute("call-1", { command: "echo hello" });

    expect(getText(result)).toContain("hello");
    expect((result as any).details.exitCode).toBe(0);
  });

  test("uses the real default runner when no runner argument is passed", async () => {
    const [tool] = buildShellTools(makeHarness());
    const result = await tool.execute("call-1", { command: "echo real-runner-default" });
    expect(getText(result)).toContain("real-runner-default");
  });

  test("timeout_ms omitted defaults to 600000ms", async () => {
    const { runner, calls } = makeFakeRunner();
    const [tool] = buildShellTools(makeHarness(), runner);

    await tool.execute("call-1", { command: "true" });

    expect(calls[0].options.timeoutMs).toBe(600_000);
  });

  test("a valid timeout_ms value is passed through unchanged", async () => {
    const { runner, calls } = makeFakeRunner();
    const [tool] = buildShellTools(makeHarness(), runner);

    await tool.execute("call-1", { command: "true", timeout_ms: 5_000 });

    expect(calls[0].options.timeoutMs).toBe(5_000);
  });

  test("timeout_ms above the 3_600_000ms ceiling is silently clamped", async () => {
    const { runner, calls } = makeFakeRunner();
    const [tool] = buildShellTools(makeHarness(), runner);

    const result = await tool.execute("call-1", { command: "true", timeout_ms: 10_000_000 });

    expect(calls[0].options.timeoutMs).toBe(3_600_000);
    // Silent clamp: no error surfaced to the model.
    expect(getText(result)).not.toContain("error");
  });

  test("the harness's AbortSignal is passed through to the runner", async () => {
    const controller = new AbortController();
    const { runner, calls } = makeFakeRunner();
    const [tool] = buildShellTools(makeHarness(controller.signal), runner);

    await tool.execute("call-1", { command: "true" });

    expect(calls[0].options.signal).toBe(controller.signal);
  });

  test("reports timeout in the tool result when the runner reports timedOut", async () => {
    const { runner } = makeFakeRunner({ timedOut: true, exitCode: null });
    const [tool] = buildShellTools(makeHarness(), runner);

    const result = await tool.execute("call-1", { command: "sleep 100" });

    expect(getText(result)).toContain("timed out");
  });

  test("reports cancellation in the tool result when the runner reports aborted", async () => {
    const { runner } = makeFakeRunner({ aborted: true, exitCode: null });
    const [tool] = buildShellTools(makeHarness(), runner);

    const result = await tool.execute("call-1", { command: "sleep 100" });

    expect(getText(result)).toContain("cancelled");
  });

  test("tool description mentions timeout_ms behavior and file redirection, without platform-specific syntax", async () => {
    const [tool] = buildShellTools(makeHarness());

    expect(tool.description).toContain("timeout_ms");
    expect(tool.description.toLowerCase()).toContain("file");
    // Should not steer with a platform-specific redirect example.
    expect(tool.description).not.toContain(">/tmp");
    expect(tool.description).not.toContain("> /tmp");
  });
});

// ─── truncateHeadTail (pure helper) ────────────────────────────────────────────

describe("truncateHeadTail", () => {
  test("returns text unmodified when within the combined limit", () => {
    const { text, truncated } = truncateHeadTail("short text", 10, 10);
    expect(text).toBe("short text");
    expect(truncated).toBe(false);
  });

  test("keeps head and tail and inserts a marker when over the limit", () => {
    const long = "A".repeat(100) + "MIDDLE" + "B".repeat(100);
    const { text, truncated } = truncateHeadTail(long, 10, 10);

    expect(truncated).toBe(true);
    expect(text.startsWith("A".repeat(10))).toBe(true);
    expect(text.endsWith("B".repeat(10))).toBe(true);
    expect(text).not.toContain("MIDDLE");
    expect(text).toMatch(/omitted/);
  });

  test("stdout and stderr are truncated independently with their own budgets", async () => {
    const bigStdout = "O".repeat(20_000);
    const bigStderr = "E".repeat(20_000);
    const { runner } = makeFakeRunner({ stdout: bigStdout, stderr: bigStderr, exitCode: 1 });
    const [tool] = buildShellTools(makeHarness(), runner);

    const result = await tool.execute("call-1", { command: "noisy" });
    const text = getText(result);

    // Both streams should be present but truncated (far shorter than their raw 20_000 length each).
    expect(text.length).toBeLessThan(bigStdout.length);
    expect(text).toContain("STDERR:");
  });
});

// ─── Real-process tests ────────────────────────────────────────────────────────
// These use the genuine default runner (real Bun.spawn) with short timeouts/grace
// periods to verify actual OS-level SIGTERM -> grace -> SIGKILL and process-group
// kill behavior without making the suite slow.

describe("runCommand (real process)", () => {
  test("a process that exits cleanly on SIGTERM does not require SIGKILL", async () => {
    // Traps SIGTERM and exits immediately; sleeps far longer than the timeout so
    // the only way it exits before the sleep finishes is via the SIGTERM handler.
    const script = "trap 'exit 0' TERM; sleep 5 & wait";

    const result = await runCommand(script, {
      cwd: process.cwd(),
      timeoutMs: 50,
      gracePeriodMs: 2_000, // long enough that a passing test proves SIGKILL wasn't needed
    });

    expect(result.timedOut).toBe(true);
  }, 10_000);

  test("a process that ignores SIGTERM is force-killed via SIGKILL after the grace period", async () => {
    // Ignores SIGTERM entirely; only SIGKILL (unblockable) can terminate it.
    const script = "trap '' TERM; sleep 5";

    const start = Date.now();
    const result = await runCommand(script, {
      cwd: process.cwd(),
      timeoutMs: 50,
      gracePeriodMs: 100,
    });
    const elapsed = Date.now() - start;

    expect(result.timedOut).toBe(true);
    // Should have waited roughly the grace period before SIGKILL, not returned instantly.
    expect(elapsed).toBeGreaterThanOrEqual(100);
  }, 10_000);

  test("kills the whole process group, not just the direct shell process", async () => {
    // Direct child ignores TERM; forks a grandchild that also ignores TERM and writes
    // a marker file in a loop. If only the direct child were killed, the grandchild
    // would keep running and keep writing after the test completes.
    const { mkdtempSync, existsSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = mkdtempSync(join(tmpdir(), "shell-runner-pgroup-"));
    const marker = join(dir, "marker.txt");
    const script = `trap '' TERM; (trap '' TERM; while true; do echo tick >> "${marker}"; sleep 0.05; done) & wait`;

    try {
      await runCommand(script, {
        cwd: process.cwd(),
        timeoutMs: 100,
        gracePeriodMs: 100,
      });

      // Give any surviving orphaned grandchild a moment to write more ticks, if it exists.
      const sizeAfterKill = existsSync(marker) ? readFileSync(marker, "utf-8").length : 0;
      await new Promise((resolve) => setTimeout(resolve, 300));
      const sizeLater = existsSync(marker) ? readFileSync(marker, "utf-8").length : 0;

      // No further growth once the process group has been killed — a surviving
      // orphan would have appended several more "tick\n" lines during this wait.
      expect(sizeLater).toBe(sizeAfterKill);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 10_000);

  test("a long-running command exceeding timeout_ms is terminated and reported as timed out", async () => {
    const result = await runCommand("sleep 5", {
      cwd: process.cwd(),
      timeoutMs: 50,
      gracePeriodMs: 100,
    });

    expect(result.timedOut).toBe(true);
    expect(result.aborted).toBe(false);
  }, 10_000);

  test("AbortSignal cancellation terminates the process and is reported as aborted", async () => {
    const controller = new AbortController();
    const promise = runCommand("sleep 5", {
      cwd: process.cwd(),
      timeoutMs: 60_000,
      gracePeriodMs: 100,
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 20);

    const result = await promise;
    expect(result.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
  }, 10_000);
});
