/**
 * board.test.ts — Pinia store tests for board store
 *
 * Suites:
 *   SU — updateBoard
 *   SD — deleteBoard
 *   BP — board persistence (localStorage)
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Board, WorkflowTemplate } from "@shared/rpc-types";

const apiMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => []);
vi.mock("../rpc", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
}));

// ─── localStorage mock ────────────────────────────────────────────────────────

let fakeStorage: Record<string, string> = {};
const localStorageMock = {
    getItem: (key: string) => fakeStorage[key] ?? null,
    setItem: (key: string, value: string) => {
        fakeStorage[key] = value;
    },
    removeItem: (key: string) => {
        delete fakeStorage[key];
    },
    clear: () => {
        fakeStorage = {};
    },
    get length() {
        return Object.keys(fakeStorage).length;
    },
    key: (n: number) => Object.keys(fakeStorage)[n] ?? null,
} satisfies Storage;

beforeAll(() => {
    (globalThis as Record<string, unknown>).localStorage = localStorageMock;
});

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
  fakeStorage = {};
  setActivePinia(createPinia());
  apiMock.mockReset();
});

// ─── SU — updateBoard ─────────────────────────────────────────────────────────

describe("SU — updateBoard", () => {
  it("SU-1: calls boards.update with correct params", async () => {
    const store = useBoardStore();
    const updatedBoard = makeBoard({ name: "Renamed" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiMock.mockImplementation((async (method: string, params: unknown) => {
      void params;
      if (method === "boards.update") return updatedBoard;
      if (method === "boards.list") return [updatedBoard];
      return [];
    }) as any);

    await store.updateBoard(1, { name: "Renamed" });

    expect(apiMock).toHaveBeenCalledWith("boards.update", { id: 1, name: "Renamed" });
  });

  it("SU-2: calls boards.list to refresh after update", async () => {
    const store = useBoardStore();
    const updatedBoard = makeBoard({ name: "Renamed" });
    apiMock.mockImplementation((async (method: string) => {
      if (method === "boards.update") return updatedBoard;
      if (method === "boards.list") return [updatedBoard];
      return [];
    }) as any);

    await store.updateBoard(1, { name: "Renamed" });

    expect(apiMock).toHaveBeenCalledWith("boards.list", {});
  });

  it("SU-3: store reflects updated board name after update", async () => {
    const store = useBoardStore();
    // First load with original board
    apiMock.mockImplementation((async (method: string) => {
      if (method === "boards.list") return [makeBoard({ name: "Original" })];
      return makeBoard({ name: "Original" });
    }) as any);
    await store.loadBoards();
    expect(store.boards[0]?.name).toBe("Original");

    // Now update — list returns updated name
    apiMock.mockImplementation((async (method: string) => {
      if (method === "boards.update") return makeBoard({ name: "Renamed" });
      if (method === "boards.list") return [makeBoard({ name: "Renamed" })];
      return makeBoard({ name: "Renamed" });
    }) as any);
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

// ─── BP — board persistence ───────────────────────────────────────────────────

describe("BP — board persistence", () => {
  it("BP-1: activeBoardId starts null when nothing is stored", () => {
    const store = useBoardStore();
    expect(store.activeBoardId).toBeNull();
  });

  it("BP-2: activeBoardId is restored from localStorage on store init", () => {
    fakeStorage["railyn.activeBoardId"] = JSON.stringify(42);
    const store = useBoardStore();
    expect(store.activeBoardId).toBe(42);
  });

  it("BP-3: persisted board belonging to workspace is preserved after loadBoards(workspaceKey)", async () => {
    fakeStorage["railyn.activeBoardId"] = JSON.stringify(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiMock.mockImplementation((async (method: string) => {
      if (method === "boards.list") return [makeBoard({ id: 1, workspaceKey: "ws-a" })];
      return [];
    }) as any);

    const store = useBoardStore();
    await store.loadBoards("ws-a");

    expect(store.activeBoardId).toBe(1);
  });

  it("BP-4: persisted board from different workspace is replaced with first board of target workspace", async () => {
    fakeStorage["railyn.activeBoardId"] = JSON.stringify(99);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiMock.mockImplementation((async (method: string) => {
      if (method === "boards.list") {
        return [
          makeBoard({ id: 5, workspaceKey: "ws-target" }),
          makeBoard({ id: 99, workspaceKey: "ws-other" }),
        ];
      }
      return [];
    }) as any);

    const store = useBoardStore();
    await store.loadBoards("ws-target");

    expect(store.activeBoardId).toBe(5);
  });

  it("BP-5: persisted board id not in any board list falls back to first board", async () => {
    fakeStorage["railyn.activeBoardId"] = JSON.stringify(999);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiMock.mockImplementation((async (method: string) => {
      if (method === "boards.list") return [makeBoard({ id: 7, workspaceKey: "ws-a" })];
      return [];
    }) as any);

    const store = useBoardStore();
    await store.loadBoards("ws-a");

    expect(store.activeBoardId).toBe(7);
  });

  it("BP-6: selectBoard() persists id to localStorage", async () => {
    const { nextTick } = await import("vue");
    const store = useBoardStore();
    store.selectBoard(77);
    await nextTick();

    expect(fakeStorage["railyn.activeBoardId"]).toBe(JSON.stringify(77));
  });

  it("BP-7: loadBoards selects first board of target workspace when persisted activeBoardId belongs to different workspace", async () => {
    fakeStorage["railyn.activeBoardId"] = JSON.stringify(99);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiMock.mockImplementation((async (method: string) => {
      if (method === "boards.list") {
        return [
          makeBoard({ id: 10, workspaceKey: "ws-new" }),
          makeBoard({ id: 11, workspaceKey: "ws-new" }),
        ];
      }
      return [];
    }) as any);

    const store = useBoardStore();
    await store.loadBoards("ws-new");

    // Should select first board of ws-new, not the persisted ws-other board
    expect(store.activeBoardId).toBe(10);
  });

  it("BP-8: loadBoards(undefined) retains previously selected board if it still exists in the list", async () => {
    fakeStorage["railyn.activeBoardId"] = JSON.stringify(5);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiMock.mockImplementation((async (method: string) => {
      if (method === "boards.list") {
        return [
          makeBoard({ id: 5, workspaceKey: "ws-a" }),
          makeBoard({ id: 6, workspaceKey: "ws-a" }),
        ];
      }
      return [];
    }) as any);

    const store = useBoardStore();
    await store.loadBoards();

    // Should retain the persisted board id since it still exists
    expect(store.activeBoardId).toBe(5);
  });
});
