import { defineStore } from "pinia";
import { ref } from "vue";

const DRAWER_WIDTH_KEY = "railyn.drawerWidth";
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 400;
const MAX_WIDTH = 1400;

export const useDrawerStore = defineStore("drawer", () => {
  const mode = ref<"task" | "session" | null>(null);
  const taskId = ref<number | null>(null);
  const sessionId = ref<number | null>(null);
  const conversationId = ref<number | null>(null);

  const storedWidth = parseInt(localStorage.getItem(DRAWER_WIDTH_KEY) ?? "", 10);
  const width = ref(
    isNaN(storedWidth) ? DEFAULT_WIDTH : Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, storedWidth)),
  );

  function openForTask(tId: number, convId: number) {
    taskId.value = tId;
    sessionId.value = null;
    conversationId.value = convId;
    mode.value = "task";
  }

  function openForSession(sId: number, convId: number) {
    sessionId.value = sId;
    taskId.value = null;
    conversationId.value = convId;
    mode.value = "session";
  }

  function close() {
    mode.value = null;
    taskId.value = null;
    sessionId.value = null;
    conversationId.value = null;
  }

  function setWidth(w: number) {
    width.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
    localStorage.setItem(DRAWER_WIDTH_KEY, String(width.value));
  }

  return { mode, taskId, sessionId, conversationId, width, openForTask, openForSession, close, setWidth };
});
