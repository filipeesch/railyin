import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref, nextTick } from "vue";
import { useBoardSyncHandler } from "./useBoardSyncHandler";

function makeStubs() {
  const loadBoards = vi.fn();
  const keyRef = ref<string | null>("ws-1");

  return {
    loadBoards,
    keyRef,
  };
}

describe("useBoardSyncHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("BS-1: loadBoards is called on setup (immediate watch)", () => {
    const { loadBoards, keyRef } = makeStubs();
    useBoardSyncHandler({ loadBoards, watchKey: () => keyRef.value });
    expect(loadBoards).toHaveBeenCalledTimes(1);
    expect(loadBoards).toHaveBeenCalledWith("ws-1");
  });

  it("BS-2: loadBoards is called with new key when workspace key changes", async () => {
    const { loadBoards, keyRef } = makeStubs();
    useBoardSyncHandler({ loadBoards, watchKey: () => keyRef.value });
    loadBoards.mockClear();

    keyRef.value = "ws-2";
    await nextTick();

    expect(loadBoards).toHaveBeenCalledTimes(1);
    expect(loadBoards).toHaveBeenCalledWith("ws-2");
  });

  it("BS-3: loadBoards is called with undefined when key changes to null", async () => {
    const { loadBoards, keyRef } = makeStubs();
    useBoardSyncHandler({ loadBoards, watchKey: () => keyRef.value });
    loadBoards.mockClear();

    keyRef.value = null;
    await nextTick();

    expect(loadBoards).toHaveBeenCalledWith(undefined);
  });

  it("BS-4: each workspace switch triggers exactly one loadBoards call with correct key", async () => {
    const { loadBoards, keyRef } = makeStubs();
    useBoardSyncHandler({ loadBoards, watchKey: () => keyRef.value });
    loadBoards.mockClear();

    keyRef.value = "ws-a";
    await nextTick();
    keyRef.value = "ws-b";
    await nextTick();
    keyRef.value = "ws-c";
    await nextTick();

    expect(loadBoards).toHaveBeenCalledTimes(3);
    expect(loadBoards).toHaveBeenNthCalledWith(1, "ws-a");
    expect(loadBoards).toHaveBeenNthCalledWith(2, "ws-b");
    expect(loadBoards).toHaveBeenNthCalledWith(3, "ws-c");
  });

  it("BS-5: loadBoards receives undefined on initial setup when key is null", () => {
    const loadBoards = vi.fn();
    useBoardSyncHandler({ loadBoards, watchKey: () => null });
    expect(loadBoards).toHaveBeenCalledTimes(1);
    expect(loadBoards).toHaveBeenCalledWith(undefined);
  });
});
