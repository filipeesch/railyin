import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// In-memory localStorage polyfill for non-browser test environments
function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
    reset: () => { store = {}; },
  };
}

const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true, configurable: true });

const { useDraftStore } = await import("./draft");

describe("draftStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorageMock.reset();
  });


  it("DR-1: get returns null when no draft exists for key", () => {
    const store = useDraftStore();
    expect(store.get("task:1")).toBeNull();
    expect(store.get("session:99")).toBeNull();
  });

  it("DR-2: set then get returns stored text and savedAt close to now", () => {
    const store = useDraftStore();
    const before = Date.now();
    store.set("task:1", "hello world");
    const after = Date.now();
    const entry = store.get("task:1");
    expect(entry).not.toBeNull();
    expect(entry!.text).toBe("hello world");
    expect(entry!.savedAt).toBeGreaterThanOrEqual(before);
    expect(entry!.savedAt).toBeLessThanOrEqual(after);
  });

  it("DR-3: clear removes the draft entry", () => {
    const store = useDraftStore();
    store.set("task:1", "draft text");
    store.clear("task:1");
    expect(store.get("task:1")).toBeNull();
  });

  it("DR-4: clear for unknown key is a no-op (no error)", () => {
    const store = useDraftStore();
    expect(() => store.clear("task:999")).not.toThrow();
  });

  it("DR-5: stale entries older than 7 days are evicted on store init", () => {
    // Write a draft entry directly with savedAt 8 days ago
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const staleEntry = JSON.stringify({ text: "old draft", savedAt: eightDaysAgo });
    localStorageMock.setItem("railyn:draft:task:42", staleEntry);

    // Store init triggers _evictStale
    useDraftStore();

    expect(localStorageMock.getItem("railyn:draft:task:42")).toBeNull();
  });

  it("DR-6: entries within 7 days are not evicted on store init", () => {
    // Write a draft entry with savedAt 6 days ago
    const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000;
    const freshEntry = JSON.stringify({ text: "recent draft", savedAt: sixDaysAgo });
    localStorageMock.setItem("railyn:draft:task:7", freshEntry);

    useDraftStore();

    const raw = localStorageMock.getItem("railyn:draft:task:7");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.text).toBe("recent draft");
  });

  it("DR-7: set overwrites an existing draft for the same key", () => {
    const store = useDraftStore();
    store.set("task:1", "first");
    store.set("task:1", "second");
    expect(store.get("task:1")!.text).toBe("second");
  });

  it("DR-8: drafts for different keys are independent", () => {
    const store = useDraftStore();
    store.set("task:1", "task one");
    store.set("session:2", "session two");

    expect(store.get("task:1")!.text).toBe("task one");
    expect(store.get("session:2")!.text).toBe("session two");

    store.clear("task:1");
    expect(store.get("task:1")).toBeNull();
    expect(store.get("session:2")!.text).toBe("session two");
  });
});
