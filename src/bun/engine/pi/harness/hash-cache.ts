interface FileCacheEntry {
  hash: string;
  rangeKey: string;
  seenInWindow: boolean;
  turnNumber: number;
}

interface SearchCacheEntry {
  seenInWindow: boolean;
  turnNumber: number;
}

export class ContentHashCache {
  private fileCache = new Map<string, FileCacheEntry>();
  private searchCache = new Map<string, SearchCacheEntry>();

  private fileKey(path: string, rangeKey: string): string {
    return `${path}::${rangeKey}`;
  }

  checkFile(
    path: string,
    fullContentHash: string,
    rangeKey: string,
    turnNumber: number,
  ): { hit: boolean; message?: string } {
    const key = this.fileKey(path, rangeKey);
    const entry = this.fileCache.get(key);

    if (entry && entry.hash === fullContentHash) {
      const wasAlreadySeen = entry.seenInWindow;
      entry.seenInWindow = true;
      if (wasAlreadySeen) {
        return {
          hit: true,
          message: `[file unchanged since turn ${entry.turnNumber} — use your cached version]`,
        };
      }
    }

    return { hit: false };
  }

  updateFile(
    path: string,
    fullContentHash: string,
    rangeKey: string,
    turnNumber: number,
  ): void {
    const key = this.fileKey(path, rangeKey);
    this.fileCache.set(key, {
      hash: fullContentHash,
      rangeKey,
      seenInWindow: true,
      turnNumber,
    });
  }

  invalidate(path: string): void {
    for (const key of this.fileCache.keys()) {
      if (key.startsWith(`${path}::`)) {
        this.fileCache.delete(key);
      }
    }
  }

  checkSearch(key: string): { hit: boolean; message?: string } {
    const entry = this.searchCache.get(key);
    if (entry?.seenInWindow) {
      return {
        hit: true,
        message: `[search unchanged — same as turn ${entry.turnNumber}]`,
      };
    }
    return { hit: false };
  }

  updateSearch(key: string, turnNumber: number): void {
    this.searchCache.set(key, { seenInWindow: true, turnNumber });
  }

  invalidateSearch(key: string): void {
    this.searchCache.delete(key);
  }

  getSearchKeys(): string[] {
    return Array.from(this.searchCache.keys());
  }

  resetWindowFlags(): void {
    for (const entry of this.fileCache.values()) {
      entry.seenInWindow = false;
    }
    for (const entry of this.searchCache.values()) {
      entry.seenInWindow = false;
    }
  }
}
