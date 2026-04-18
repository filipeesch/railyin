import { defineStore } from "pinia";
import { ref, watch } from "vue";

export interface TerminalSession {
  sessionId: string;
  label: string;
  cwd: string;
}

const STORAGE_KEY_HEIGHT = "terminal-panel-height";
const STORAGE_KEY_SESSIONS = "terminal-sessions";
const STORAGE_KEY_ACTIVE = "terminal-active-session";
const STORAGE_KEY_OPEN = "terminal-panel-open";
const DEFAULT_HEIGHT = 300;
const MIN_HEIGHT = 120;

function readStorage<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const useTerminalStore = defineStore("terminal", () => {
  const sessions = ref<TerminalSession[]>(readStorage<TerminalSession[]>(STORAGE_KEY_SESSIONS, []));
  const activeSessionId = ref<string | null>(readStorage<string | null>(STORAGE_KEY_ACTIVE, null));
  const isPanelOpen = ref(readStorage<boolean>(STORAGE_KEY_OPEN, false));

  const storedHeight = typeof localStorage !== "undefined" ? parseInt(localStorage.getItem(STORAGE_KEY_HEIGHT) ?? "", 10) : NaN;
  const panelHeight = ref(isNaN(storedHeight) ? DEFAULT_HEIGHT : Math.max(MIN_HEIGHT, storedHeight));

  // Keep all state in sync with localStorage
  watch(panelHeight, (h) => localStorage.setItem(STORAGE_KEY_HEIGHT, String(h)));
  watch(sessions, (s) => localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(s)), { deep: true });
  watch(activeSessionId, (id) => localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(id)));
  watch(isPanelOpen, (open) => localStorage.setItem(STORAGE_KEY_OPEN, JSON.stringify(open)));

  function addSession(sessionId: string, label: string, cwd: string) {
    if (!sessions.value.find((s) => s.sessionId === sessionId)) {
      sessions.value.push({ sessionId, label, cwd });
    }
    activeSessionId.value = sessionId;
    isPanelOpen.value = true;
  }

  function removeSession(sessionId: string) {
    sessions.value = sessions.value.filter((s) => s.sessionId !== sessionId);
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = sessions.value[0]?.sessionId ?? null;
    }
    if (sessions.value.length === 0) {
      isPanelOpen.value = false;
    }
  }

  function setActive(sessionId: string) {
    activeSessionId.value = sessionId;
    isPanelOpen.value = true;
  }

  function openPanel(sessionId?: string) {
    isPanelOpen.value = true;
    if (sessionId) {
      activeSessionId.value = sessionId;
    }
  }

  function closePanel() {
    isPanelOpen.value = false;
  }

  function togglePanel() {
    isPanelOpen.value = !isPanelOpen.value;
  }

  function setHeight(h: number) {
    panelHeight.value = Math.max(MIN_HEIGHT, h);
  }

  return {
    sessions,
    activeSessionId,
    isPanelOpen,
    panelHeight,
    addSession,
    removeSession,
    setActive,
    openPanel,
    closePanel,
    togglePanel,
    setHeight,
  };
});
