/**
 * workspace.test.ts — Pinia store tests for workspace store persistence
 *
 * Suites:
 *   WS-P — workspace persistence (localStorage)
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
