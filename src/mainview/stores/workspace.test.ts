/**
 * workspace.test.ts — Pinia store tests for workspace store persistence
 *
 * Suites:
 *   WS-P — workspace persistence (localStorage)
 *   WS-SW — workspace switch
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";

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

// ─── RPC mock ─────────────────────────────────────────────────────────────────

const apiMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => []);

vi.mock("../rpc", () => ({
    api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
}));

const { useWorkspaceStore } = await import("./workspace");

// ─── WS-P — workspace persistence ────────────────────────────────────────────

describe("WS-P — workspace persistence", () => {
    beforeEach(() => {
        fakeStorage = {};
        setActivePinia(createPinia());
        apiMock.mockReset();
    });

    it("WS-P-1: activeWorkspaceKey starts null when nothing is stored", () => {
        const store = useWorkspaceStore();
        expect(store.activeWorkspaceKey).toBeNull();
    });

    it("WS-P-2: persisted key that matches list is preserved after loadWorkspaces()", async () => {
        fakeStorage["railyn.activeWorkspaceKey"] = JSON.stringify("ws-2");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        apiMock.mockImplementation((async (method: string) => {
            if (method === "workspace.list") {
                return [
                    { key: "test", name: "Test" },
                    { key: "ws-2", name: "WS 2" },
                ];
            }
            return [];
        }) as any);

        const store = useWorkspaceStore();
        await store.loadWorkspaces();

        expect(store.activeWorkspaceKey).toBe("ws-2");
    });

    it("WS-P-3: persisted key not in list falls back to first workspace", async () => {
        fakeStorage["railyn.activeWorkspaceKey"] = JSON.stringify("nonexistent");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        apiMock.mockImplementation((async (method: string) => {
            if (method === "workspace.list") {
                return [{ key: "first", name: "First" }];
            }
            return [];
        }) as any);

        const store = useWorkspaceStore();
        await store.loadWorkspaces();

        expect(store.activeWorkspaceKey).toBe("first");
    });

    it("WS-P-4: selectWorkspace() persists key to localStorage", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        apiMock.mockImplementation((async (method: string) => {
            if (method === "workspace.list") return [{ key: "new-ws", name: "New WS" }];
            if (method === "workspace.getConfig") return { key: "new-ws", name: "New WS", workflows: [] };
            return [];
        }) as any);

        const store = useWorkspaceStore();
        await store.selectWorkspace("new-ws");
        await nextTick();

        expect(fakeStorage["railyn.activeWorkspaceKey"]).toBe(JSON.stringify("new-ws"));
    });
});

// ─── WS-SW — workspace switch ────────────────────────────────────────────────

describe("WS-SW — workspace switch", () => {
    beforeEach(() => {
        fakeStorage = {};
        setActivePinia(createPinia());
        apiMock.mockReset();
    });

    it("WS-SW-1: selectWorkspace() triggers workspace.getConfig with new key", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        apiMock.mockImplementation((async (method: string, params: unknown) => {
            if (method === "workspace.getConfig") {
                return { key: (params as { workspaceKey?: string }).workspaceKey, name: "Test", workflows: [] };
            }
            return [];
        }) as any);

        const store = useWorkspaceStore();
        await store.selectWorkspace("ws-new");

        expect(apiMock).toHaveBeenCalledWith("workspace.getConfig", { workspaceKey: "ws-new" });
    });

    it("WS-SW-2: selectWorkspace() persists key AND loads config in sequence", async () => {
        let configCalled = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        apiMock.mockImplementation((async (method: string, params: unknown) => {
            if (method === "workspace.getConfig") {
                configCalled = true;
                return { key: (params as { workspaceKey?: string }).workspaceKey, name: "Test", workflows: [] };
            }
            return [];
        }) as any);

        const store = useWorkspaceStore();
        await store.selectWorkspace("ws-new");

        // Key should be persisted to localStorage
        expect(fakeStorage["railyn.activeWorkspaceKey"]).toBe(JSON.stringify("ws-new"));
        // Config should have been loaded
        expect(configCalled).toBe(true);
    });

    it("WS-SW-3: rapid selectWorkspace() calls converge — last key wins", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        apiMock.mockImplementation((async (method: string, params: unknown) => {
            if (method === "workspace.getConfig") {
                return { key: (params as { workspaceKey?: string }).workspaceKey, name: "Test", workflows: [] };
            }
            return [];
        }) as any);

        const store = useWorkspaceStore();
        // Rapid calls without awaiting between each
        store.selectWorkspace("ws-a");
        store.selectWorkspace("ws-b");
        await store.selectWorkspace("ws-c");

        // Final key should be "ws-c"
        expect(store.activeWorkspaceKey).toBe("ws-c");
        expect(fakeStorage["railyn.activeWorkspaceKey"]).toBe(JSON.stringify("ws-c"));
    });
});
