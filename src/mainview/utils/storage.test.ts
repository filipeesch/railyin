/**
 * storage.test.ts — Unit tests for readStorage / writeStorage utilities
 *
 * Suites:
 *   RS — readStorage
 *   WS — writeStorage
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readStorage, writeStorage } from "./storage";

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

// ─── RS — readStorage ─────────────────────────────────────────────────────────

describe("RS — readStorage", () => {
    describe("with localStorage available", () => {
        beforeAll(() => {
            (globalThis as Record<string, unknown>).localStorage = localStorageMock;
        });

        beforeEach(() => {
            fakeStorage = {};
        });

        it("RS-1: returns parsed value for a stored key", () => {
            fakeStorage["my.key"] = JSON.stringify({ x: 42 });
            const result = readStorage<{ x: number }>("my.key", { x: 0 });
            expect(result).toEqual({ x: 42 });
        });

        it("RS-2: returns fallback for a missing key", () => {
            const result = readStorage<string>("missing.key", "default");
            expect(result).toBe("default");
        });

        it("RS-3: returns fallback for malformed JSON without throwing", () => {
            fakeStorage["bad.key"] = "not-valid-json{{{";
            let result!: string;
            expect(() => {
                result = readStorage<string>("bad.key", "fallback");
            }).not.toThrow();
            expect(result).toBe("fallback");
        });
    });

    describe("without localStorage", () => {
        let savedStorage: unknown;

        beforeEach(() => {
            savedStorage = (globalThis as Record<string, unknown>).localStorage;
            delete (globalThis as Record<string, unknown>).localStorage;
        });

        afterEach(() => {
            if (savedStorage !== undefined) {
                (globalThis as Record<string, unknown>).localStorage = savedStorage;
            }
        });

        it("RS-4: returns fallback when localStorage is undefined", () => {
            const result = readStorage<string>("any.key", "ssrFallback");
            expect(result).toBe("ssrFallback");
        });
    });
});

// ─── WS — writeStorage ───────────────────────────────────────────────────────

describe("WS — writeStorage", () => {
    beforeAll(() => {
        (globalThis as Record<string, unknown>).localStorage = localStorageMock;
    });

    beforeEach(() => {
        fakeStorage = {};
    });

    it("WS-1: writes JSON-serialised value to localStorage", () => {
        writeStorage("test.key", { a: 1 });
        expect(fakeStorage["test.key"]).toBe(JSON.stringify({ a: 1 }));
    });

    it("WS-2: overwrites an existing key", () => {
        fakeStorage["test.key"] = JSON.stringify("old");
        writeStorage("test.key", "new");
        expect(fakeStorage["test.key"]).toBe(JSON.stringify("new"));
    });

    it("WS-3: does not throw when localStorage is undefined", () => {
        const saved = (globalThis as Record<string, unknown>).localStorage;
        delete (globalThis as Record<string, unknown>).localStorage;
        try {
            expect(() => writeStorage("test.key", "value")).not.toThrow();
        } finally {
            (globalThis as Record<string, unknown>).localStorage = saved;
        }
    });
});
