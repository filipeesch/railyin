import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref, nextTick } from "vue";
import { useSessionSyncHandler } from "./useSessionSyncHandler";

function makeStubs() {
  let reconnectCb: (() => void) | null = null;
  const onWsReconnect = vi.fn((cb: () => void) => {
    reconnectCb = cb;
  });
  const loadSessions = vi.fn();
  const keyRef = ref<string | null>("ws-1");

  return {
    onWsReconnect,
    loadSessions,
    keyRef,
    fireReconnect: () => reconnectCb?.(),
  };
}

describe("useSessionSyncHandler", () => {
  it("SS-1: registers a reconnect callback on setup", () => {
    const { onWsReconnect, loadSessions, keyRef } = makeStubs();
    useSessionSyncHandler({ onWsReconnect, loadSessions, watchKey: () => keyRef.value });
    expect(onWsReconnect).toHaveBeenCalledTimes(1);
  });

  it("SS-2: calling the reconnect callback once triggers loadSessions with current key", () => {
    const { onWsReconnect, loadSessions, keyRef, fireReconnect } = makeStubs();
    useSessionSyncHandler({ onWsReconnect, loadSessions, watchKey: () => keyRef.value });
    loadSessions.mockClear();

    fireReconnect();
    expect(loadSessions).toHaveBeenCalledTimes(1);
    expect(loadSessions).toHaveBeenCalledWith("ws-1");
  });

  it("SS-3: calling the reconnect callback twice triggers loadSessions twice", () => {
    const { onWsReconnect, loadSessions, keyRef, fireReconnect } = makeStubs();
    useSessionSyncHandler({ onWsReconnect, loadSessions, watchKey: () => keyRef.value });
    loadSessions.mockClear();

    fireReconnect();
    fireReconnect();
    expect(loadSessions).toHaveBeenCalledTimes(2);
  });

  it("SS-4: reconnect with null watchKey calls loadSessions with undefined", () => {
    const { onWsReconnect, loadSessions, keyRef, fireReconnect } = makeStubs();
    keyRef.value = null;
    useSessionSyncHandler({ onWsReconnect, loadSessions, watchKey: () => keyRef.value });
    loadSessions.mockClear();

    fireReconnect();
    expect(loadSessions).toHaveBeenCalledWith(undefined);
  });

  it("SS-5: changing watchKey to a new non-null value triggers loadSessions with new key", async () => {
    const { onWsReconnect, loadSessions, keyRef } = makeStubs();
    useSessionSyncHandler({ onWsReconnect, loadSessions, watchKey: () => keyRef.value });
    loadSessions.mockClear();

    keyRef.value = "ws-2";
    await nextTick();
    expect(loadSessions).toHaveBeenCalledWith("ws-2");
  });

  it("SS-6: changing watchKey to null calls loadSessions with undefined", async () => {
    const { onWsReconnect, loadSessions, keyRef } = makeStubs();
    useSessionSyncHandler({ onWsReconnect, loadSessions, watchKey: () => keyRef.value });
    loadSessions.mockClear();

    keyRef.value = null;
    await nextTick();
    expect(loadSessions).toHaveBeenCalledWith(undefined);
  });

  it("SS-7: loadSessions is called on setup (immediate watch)", () => {
    const { onWsReconnect, loadSessions, keyRef } = makeStubs();
    useSessionSyncHandler({ onWsReconnect, loadSessions, watchKey: () => keyRef.value });
    expect(loadSessions).toHaveBeenCalledTimes(1);
    expect(loadSessions).toHaveBeenCalledWith("ws-1");
  });

  it("SS-8: reconnect and key change independently each trigger loadSessions", async () => {
    const { onWsReconnect, loadSessions, keyRef, fireReconnect } = makeStubs();
    useSessionSyncHandler({ onWsReconnect, loadSessions, watchKey: () => keyRef.value });
    loadSessions.mockClear();

    fireReconnect();
    keyRef.value = "ws-3";
    await nextTick();

    expect(loadSessions).toHaveBeenCalledTimes(2);
    expect(loadSessions).toHaveBeenNthCalledWith(1, "ws-1");
    expect(loadSessions).toHaveBeenNthCalledWith(2, "ws-3");
  });
});
