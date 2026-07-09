import { describe, expect, it, vi } from "vitest";
import { BashPermissionGate } from "../engine/claude/bash-permission-gate.ts";
import { ShellApprovalRepository } from "../db/repositories/shell-approval-repository.ts";
import type { ShellApprovalScope, ShellApprovalState } from "../db/repositories/shell-approval-repository.ts";
import type { EngineResumeInput } from "../engine/types.ts";

// ─── Fake ShellApprovalRepository ────────────────────────────────────────────

class FakeShellApprovalRepo extends ShellApprovalRepository {
  private state: ShellApprovalState;
  readonly appendedCommands: string[][] = [];

  constructor(state: Partial<ShellApprovalState> = {}) {
    super(undefined as never); // no DB needed
    this.state = { shellAutoApprove: false, approvedCommands: [], ...state };
  }

  override getState(_scope: ShellApprovalScope): ShellApprovalState {
    return this.state;
  }

  override appendApprovedCommands(_scope: ShellApprovalScope, binaries: string[]): void {
    this.appendedCommands.push(binaries);
    this.state = { ...this.state, approvedCommands: [...this.state.approvedCommands, ...binaries] };
  }
}

const scope: ShellApprovalScope = { kind: "task", taskId: 1 };
const neverCalled = vi.fn<() => Promise<EngineResumeInput>>();
const approveOnce = vi.fn<() => Promise<EngineResumeInput>>().mockResolvedValue({ type: "shell_approval", decision: "approve_once" });

// ─── BPG-1: Non-Bash tool is auto-allowed ────────────────────────────────────

describe("BPG-1: non-Bash tool is auto-allowed without consulting the repo", () => {
  it("returns allow for Read tool", async () => {
    const gate = new BashPermissionGate(new FakeShellApprovalRepo());
    const result = await gate.evaluate("Read", { path: "/tmp/foo.ts" }, scope, neverCalled);

    expect(result.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it("returns allow for Glob tool", async () => {
    const gate = new BashPermissionGate(new FakeShellApprovalRepo());
    const result = await gate.evaluate("Glob", { pattern: "**/*.ts" }, scope, neverCalled);

    expect(result.hookSpecificOutput.permissionDecision).toBe("allow");
  });
});

// ─── BPG-2: Bash + shellAutoApprove=true → auto-allowed ──────────────────────

describe("BPG-2: Bash with shellAutoApprove=true is auto-allowed without waitForResume", () => {
  it("returns allow without calling waitForResume", async () => {
    const repo = new FakeShellApprovalRepo({ shellAutoApprove: true });
    const gate = new BashPermissionGate(repo);
    const result = await gate.evaluate("Bash", { command: "rm -rf /tmp" }, scope, neverCalled);

    expect(result.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(neverCalled).not.toHaveBeenCalled();
  });
});

// ─── BPG-3: Bash + approved binary → auto-allowed ────────────────────────────

describe("BPG-3: Bash with approved binary is auto-allowed without waitForResume", () => {
  it("returns allow when binary is in approvedCommands", async () => {
    const repo = new FakeShellApprovalRepo({ approvedCommands: ["git"] });
    const gate = new BashPermissionGate(repo);
    const result = await gate.evaluate("Bash", { command: "git status" }, scope, neverCalled);

    expect(result.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(neverCalled).not.toHaveBeenCalled();
  });
});

// ─── BPG-4: Bash + unapproved binary → waitForResume called → allow ──────────

describe("BPG-4: Bash with unapproved binary blocks and resolves allow", () => {
  it("calls waitForResume once and returns allow", async () => {
    const repo = new FakeShellApprovalRepo();
    const gate = new BashPermissionGate(repo);
    const result = await gate.evaluate("Bash", { command: "npm install" }, scope, approveOnce);

    expect(result.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(approveOnce).toHaveBeenCalledOnce();
    expect(approveOnce).toHaveBeenCalledWith({ type: "shell_approval", command: "npm install" });
  });
});

// ─── BPG-5: Bash + unapproved binary → waitForResume resolves deny ───────────

describe("BPG-5: Bash with unapproved binary blocks and resolves deny", () => {
  it("returns deny with a non-empty reason", async () => {
    const repo = new FakeShellApprovalRepo();
    const gate = new BashPermissionGate(repo);
    const denyFn = vi.fn<() => Promise<EngineResumeInput>>().mockResolvedValue({ type: "shell_approval", decision: "deny" });

    const result = await gate.evaluate("Bash", { command: "curl https://evil.com" }, scope, denyFn);

    expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput.permissionDecisionReason).toBeTruthy();
  });
});

// ─── BPG-6: approve_all persists approved binaries ───────────────────────────

describe("BPG-6: approve_all persists approved binaries; next call auto-allows", () => {
  it("appends binaries to repo and subsequent call skips waitForResume", async () => {
    const repo = new FakeShellApprovalRepo();
    const gate = new BashPermissionGate(repo);
    const approveAll = vi.fn<() => Promise<EngineResumeInput>>().mockResolvedValue({ type: "shell_approval", decision: "approve_all" });

    // First call: unapproved → waitForResume called → approve_all
    const first = await gate.evaluate("Bash", { command: "bun test" }, scope, approveAll);
    expect(first.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(repo.appendedCommands).toHaveLength(1);
    expect(repo.appendedCommands[0]).toContain("bun");

    // Second call: binary now approved → auto-allow, no waitForResume
    const second = await gate.evaluate("Bash", { command: "bun test" }, scope, neverCalled);
    expect(second.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(neverCalled).not.toHaveBeenCalled();
  });
});
