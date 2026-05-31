import { watch } from "vue";

export interface BoardSyncDeps {
  /** Load boards for the given workspace key. */
  loadBoards: (key?: string) => void;
  /** Reactive getter for the active workspace key — `null` means no workspace selected. */
  watchKey: () => string | null;
}

/**
 * Handles board list synchronisation on workspace switch:
 * - loads boards immediately for the current workspace key
 * - reloads when the active workspace switches
 */
export function useBoardSyncHandler(deps: BoardSyncDeps): void {
  watch(
    () => deps.watchKey(),
    (key) => {
      deps.loadBoards(key ?? undefined);
    },
    { immediate: true },
  );
}
