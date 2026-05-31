import { watch } from "vue";

export interface SessionSyncDeps {
  /** Register a callback invoked on each WS reconnect (not the first connect). */
  onWsReconnect: (cb: () => void) => void;
  /** Load sessions for the given workspace key. */
  loadSessions: (key: string | undefined) => void;
  /** Reactive getter for the active workspace key — `null` means no workspace selected. */
  watchKey: () => string | null;
}

/**
 * Handles chat-session list synchronisation in one place:
 * - loads sessions immediately for the current workspace key
 * - reloads when the active workspace switches
 * - reloads when the WebSocket reconnects after a drop
 */
export function useSessionSyncHandler(deps: SessionSyncDeps): void {
  watch(
    () => deps.watchKey(),
    (key) => {
      deps.loadSessions(key ?? undefined);
    },
    { immediate: true },
  );

  deps.onWsReconnect(() => {
    deps.loadSessions(deps.watchKey() ?? undefined);
  });
}
