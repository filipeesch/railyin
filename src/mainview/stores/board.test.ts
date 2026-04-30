/**
 * board.test.ts — Pinia store tests for board store
 *
 * Suites:
 *   SU — updateBoard
 *   SD — deleteBoard
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Board, WorkflowTemplate } from "@shared/rpc-types";

const apiMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => []);
vi.mock("../rpc", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
}));

const { useBoardStore } = await import("./board");

function makeBoard(overrides?: Partial<Board & { template: WorkflowTemplate }>): Board & { template: WorkflowTemplate } {
  return {
    id: 1,
    workspaceKey: "default",
    name: "Test Board",
    workflowTemplateId: "delivery",
    projectKeys: [],
    taskCount: 0,
    template: {
      id: "delivery",
      name: "Delivery",
      columns: [],
      groups: [],
    },
    ...overrides,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  apiMock.mockReset();
});

// ─── SU — updateBoard ─────────────────────────────────────────────────────────

describe("SU — updateBoard", () => {
  it("SU-1: calls boards.update with correct params", async () => {
    const store = useBoardStore();
    const updatedBoard = makeBoard({ name: "Renamed" });
    apiMock.mockImplementation(async (method: string, params: unknown) => {
      if (method === "boards.update") return updatedBoard;
      if (method === "boards.list") return [updatedBoard];
      return [];
    });

    await store.updateBoard(1, { name: "Renamed" });

    expect(apiMock).toHaveBeenCalledWith("boards.update", { id: 1, name: "Renamed" });
  });

  it("SU-2: calls boards.list to refresh after update", async () => {
    const store = useBoardStore();
    const updatedBoard = makeBoard({ name: "Renamed" });
    apiMock.mockImplementation(async (method: string) => {
      if (method === "boards.update") return updatedBoard;
      if (method === "boards.list") return [updatedBoard];
      return [];
    });

    await store.updateBoard(1, { name: "Renamed" });

    expect(apiMock).toHaveBeenCalledWith("boards.list", {});
  });

  it("SU-3: store reflects updated board name after update", async () => {
    const store = useBoardStore();
    // First load with original board
    apiMock.mockImplementation(async (method: string) => {
      if (method === "boards.list") return [makeBoard({ name: "Original" })];
      return makeBoard({ name: "Original" });
    });
    await store.loadBoards();
    expect(store.boards[0]?.name).toBe("Original");

    // Now update — list returns updated name
    apiMock.mockImplementation(async (method: string) => {
      if (method === "boards.update") return makeBoard({ name: "Renamed" });
      if (method === "boards.list") return [makeBoard({ name: "Renamed" })];
      return makeBoard({ name: "Renamed" });
    });
    await store.updateBoard(1, { name: "Renamed" });

    expect(store.boards[0]?.name).toBe("Renamed");
  });
});

// ─── SD — deleteBoard ─────────────────────────────────────────────────────────

describe("SD — deleteBoard", () => {
  it("SD-1: calls boards.delete with correct id", async () => {
    const store = useBoardStore();
    apiMock.mockResolvedValue({});

    await store.deleteBoard(5);

    expect(apiMock).toHaveBeenCalledWith("boards.delete", { id: 5 });
  });

  it("SD-2: removes board from store without calling boards.list again", async () => {
    const store = useBoardStore();
    store.boards = [makeBoard({ id: 1 }), makeBoard({ id: 2 })] as typeof store.boards;
    apiMock.mockResolvedValue({});

    await store.deleteBoard(1);

    expect(store.boards).toHaveLength(1);
    expect(store.boards[0]?.id).toBe(2);
    // boards.list should NOT be called (optimistic removal)
    expect(apiMock).not.toHaveBeenCalledWith("boards.list", {});
  });

  it("SD-3: resets activeBoardId when active board is deleted", async () => {
    const store = useBoardStore();
    store.boards = [makeBoard({ id: 1 }), makeBoard({ id: 2 })] as typeof store.boards;
    store.activeBoardId = 1;
    apiMock.mockResolvedValue({});

    await store.deleteBoard(1);

    expect(store.activeBoardId).toBe(2);
  });

  it("SD-4: sets activeBoardId to null when last board is deleted", async () => {
    const store = useBoardStore();
    store.boards = [makeBoard({ id: 1 })] as typeof store.boards;
    store.activeBoardId = 1;
    apiMock.mockResolvedValue({});

    await store.deleteBoard(1);

    expect(store.activeBoardId).toBeNull();
  });

  it("SD-5: does not mutate boards array before API call resolves", async () => {
    const store = useBoardStore();
    store.boards = [makeBoard({ id: 1 })] as typeof store.boards;

    let resolveDelete!: () => void;
    apiMock.mockReturnValue(new Promise<Record<string, never>>((r) => { resolveDelete = () => r({}); }));

    const pending = store.deleteBoard(1);
    // Before resolve, board should still be there
    expect(store.boards).toHaveLength(1);

    resolveDelete();
    await pending;

    expect(store.boards).toHaveLength(0);
  });
});
