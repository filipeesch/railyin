import { defineStore } from "pinia";

export interface DraftEntry {
  text: string;
  savedAt: number;
}

const PREFIX = "railyn:draft:";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function _hasStorage(): boolean {
  return typeof localStorage !== "undefined";
}

export const useDraftStore = defineStore("draft", () => {
  _evictStale();

  function _storageKey(key: string): string {
    return `${PREFIX}${key}`;
  }

  function _evictStale(): void {
    if (!_hasStorage()) return;
    const now = Date.now();
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i);
      if (storageKey && storageKey.startsWith(PREFIX)) {
        try {
          const raw = localStorage.getItem(storageKey);
          if (raw) {
            const entry = JSON.parse(raw) as DraftEntry;
            if (now - entry.savedAt > TTL_MS) {
              keysToRemove.push(storageKey);
            }
          }
        } catch {
          keysToRemove.push(storageKey!);
        }
      }
    }
    for (const k of keysToRemove) {
      localStorage.removeItem(k);
    }
  }

  function get(key: string): DraftEntry | null {
    if (!_hasStorage()) return null;
    try {
      const raw = localStorage.getItem(_storageKey(key));
      if (!raw) return null;
      return JSON.parse(raw) as DraftEntry;
    } catch {
      return null;
    }
  }

  function set(key: string, text: string): void {
    if (!_hasStorage()) return;
    const entry: DraftEntry = { text, savedAt: Date.now() };
    localStorage.setItem(_storageKey(key), JSON.stringify(entry));
  }

  function clear(key: string): void {
    if (!_hasStorage()) return;
    localStorage.removeItem(_storageKey(key));
  }

  return { get, set, clear, _evictStale };
});
