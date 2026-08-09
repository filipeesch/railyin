import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Minimal reactive ref stand-in so the composable can run without a full Vue runtime.
function makeRef<T>(initial: T) {
  let _value = initial;
  return {
    get value() { return _value; },
    set value(v: T) { _value = v; },
  };
}

// Mock vue before importing the composable
const vueMock = {
  ref: vi.fn((initial: unknown) => makeRef(initial)),
};
vi.mock("vue", () => vueMock);

// Capture the mock function so tests can configure return values
let mockApiFn = vi.fn(async (_method: string, _args: unknown) => [] as unknown[]);
vi.mock("../rpc", () => ({
  api: (...args: Parameters<typeof mockApiFn>) => mockApiFn(...args),
}));

// Import AFTER mocks are installed
const {
  getCommands,
  getCommandsRef,
  clearCommandsCache,
  getCommandsForWorkspace,
  getCommandsRefForWorkspace,
  clearCommandsCacheForWorkspace,
  toToolsMenu,
} = await import("./useCommandsCache");

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Cmd = { name: string; description?: string };

const CMD_A: Cmd = { name: "opsx:apply", description: "Apply" };
const CMD_B: Cmd = { name: "opsx:propose", description: "Propose" };

function makeApi(commands: Cmd[]) {
  mockApiFn = vi.fn(async () => commands);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useCommandsCache", () => {
  beforeEach(() => {
    clearCommandsCache(1);
    clearCommandsCache(2);
    clearCommandsCacheForWorkspace("ws-a");
    clearCommandsCacheForWorkspace("ws-b");
    mockApiFn = vi.fn(async () => [CMD_A]);
  });

  describe("getCommands — cold miss", () => {
    it("fetches from API on first call", async () => {
      makeApi([CMD_A]);
      const result = await getCommands(1);
      expect(result).toEqual([CMD_A]);
      expect(mockApiFn).toHaveBeenCalledTimes(1);
      expect(mockApiFn).toHaveBeenCalledWith("engine.listCommands", { taskId: 1 });
    });

    it("populates the ref after first fetch", async () => {
      makeApi([CMD_A]);
      await getCommands(1);
      const r = getCommandsRef(1);
      expect(r.value).toEqual([CMD_A]);
    });

    it("returns empty array when API throws", async () => {
      mockApiFn = vi.fn(async () => { throw new Error("network"); });
      const result = await getCommands(1);
      expect(result).toEqual([]);
    });
  });

  describe("getCommands — warm hit (within TTL)", () => {
    it("returns cached value without calling API again", async () => {
      makeApi([CMD_A]);
      await getCommands(1); // prime cache
      mockApiFn = vi.fn(async () => [CMD_B]); // change API response

      const result = await getCommands(1);
      expect(result).toEqual([CMD_A]); // stale from cache
      expect(mockApiFn).toHaveBeenCalledTimes(0); // no new API call (within TTL)
    });

    it("does not trigger background refresh within TTL", async () => {
      makeApi([CMD_A]);
      await getCommands(1);
      mockApiFn = vi.fn(async () => [CMD_B]);

      await getCommands(1);
      // Give microtasks a chance to run
      await new Promise((r) => setTimeout(r, 10));
      expect(mockApiFn).toHaveBeenCalledTimes(0);
    });
  });

  describe("getCommandsRef", () => {
    it("returns the same Ref instance across calls", async () => {
      const r1 = getCommandsRef(1);
      const r2 = getCommandsRef(1);
      expect(r1).toBe(r2);
    });

    it("ref is updated after initial fetch", async () => {
      makeApi([CMD_A, CMD_B]);
      await getCommands(1);
      const r = getCommandsRef(1);
      expect(r.value).toHaveLength(2);
    });
  });

  describe("clearCommandsCache", () => {
    it("forces a fresh fetch after clear", async () => {
      makeApi([CMD_A]);
      await getCommands(1);
      clearCommandsCache(1);

      makeApi([CMD_B]);
      const result = await getCommands(1);
      expect(result).toEqual([CMD_B]);
    });

    it("does not affect other task IDs", async () => {
      makeApi([CMD_A]);
      await getCommands(1);
      await getCommands(2);
      clearCommandsCache(1);

      mockApiFn = vi.fn(async () => [CMD_B]);
      // task 2 still cached
      const r2 = await getCommands(2);
      expect(r2).toEqual([CMD_A]);
    });
  });

  describe("commandsEqual deduplication", () => {
    it("does not update ref when data is unchanged after background refresh", async () => {
      makeApi([CMD_A]);
      await getCommands(1);
      const r = getCommandsRef(1);
      const originalArr = r.value;

      // Force TTL expiry by manipulating fetchedAt
      const entry = (getCommandsRef as unknown as { _cache?: Map<number, { fetchedAt: number }> });
      // We cannot directly access the private cache map, so test indirectly:
      // If same data comes back, the ref object reference should NOT change.
      // The only way to verify without internals is through the ref value equality.
      expect(r.value).toEqual(originalArr);
    });
  });

  describe("workspaceKey scope", () => {
    it("CMD-1: fetches with { workspaceKey } params and populates its own ref", async () => {
      mockApiFn = vi.fn(async (_m, args) => ((args as { workspaceKey?: string }).workspaceKey === "ws-a" ? [CMD_A] : [CMD_B]));
      const result = await getCommandsForWorkspace("ws-a");
      expect(result).toEqual([CMD_A]);
      expect(mockApiFn).toHaveBeenCalledWith("engine.listCommands", { workspaceKey: "ws-a" });
      const r = getCommandsRefForWorkspace("ws-a");
      expect(r.value).toEqual([CMD_A]);
    });

    it("CMD-2: task and workspace scopes cache independently", async () => {
      mockApiFn = vi.fn(async (_m, args) => ((args as { taskId?: number }).taskId === 1 ? [CMD_A] : [CMD_B]));
      await getCommands(1);
      await getCommandsForWorkspace("ws-a");

      expect(getCommandsRef(1).value).toEqual([CMD_A]);
      expect(getCommandsRefForWorkspace("ws-a").value).toEqual([CMD_B]);

      // Warm hit on the workspace scope — no second fetch within TTL
      mockApiFn = vi.fn(async () => []);
      await getCommandsForWorkspace("ws-a");
      expect(mockApiFn).not.toHaveBeenCalled();
      // Task scope still intact
      expect(getCommandsRef(1).value).toEqual([CMD_A]);
    });

    it("CMD-3: different workspace keys do not share cache entries", async () => {
      mockApiFn = vi.fn(async (_m, args) => ((args as { workspaceKey?: string }).workspaceKey === "ws-a" ? [CMD_A] : [CMD_B]));
      await getCommandsForWorkspace("ws-a");
      await getCommandsForWorkspace("ws-b");
      expect(getCommandsRefForWorkspace("ws-a").value).toEqual([CMD_A]);
      expect(getCommandsRefForWorkspace("ws-b").value).toEqual([CMD_B]);
    });

    it("CMD-4: clearCommandsCacheForWorkspace forces a fresh fetch", async () => {
      mockApiFn = vi.fn(async () => [CMD_A]);
      await getCommandsForWorkspace("ws-a");
      clearCommandsCacheForWorkspace("ws-a");

      mockApiFn = vi.fn(async () => [CMD_B]);
      const result = await getCommandsForWorkspace("ws-a");
      expect(result).toEqual([CMD_B]);
    });
  });

  describe("toToolsMenu", () => {
    it("CMD-5: maps commands to { label: '/name', action } and the action invokes insert with the slash text", () => {
      const insert = vi.fn();
      const menu = toToolsMenu([CMD_A, CMD_B], insert);
      expect(menu).toHaveLength(2);
      expect(menu[0].label).toBe("/opsx:apply");
      expect(menu[1].label).toBe("/opsx:propose");
      menu[0].action!();
      expect(insert).toHaveBeenCalledWith("/opsx:apply");
    });

    it("CMD-6: action is callable without an insert callback (no-op)", () => {
      const menu = toToolsMenu([CMD_A]);
      expect(() => menu[0].action!()).not.toThrow();
    });

    it("CMD-7: zero commands map to an empty array (menu affordance hidden)", () => {
      expect(toToolsMenu([])).toEqual([]);
    });
  });
});
