<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTerminalStore } from "../stores/terminal";

const props = defineProps<{ sessionId: string }>();

const container = ref<HTMLElement | null>(null);
const terminalStore = useTerminalStore();

let term: Terminal | null = null;
let ws: WebSocket | null = null;
let fitAddon: FitAddon | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let resizeObserver: ResizeObserver | null = null;
let destroyed = false;
let connected = false;

function connect(sessionId: string) {
  if (destroyed) return;
  const wsBase = window.location.origin.replace(/^http/, "ws");
  ws = new WebSocket(`${wsBase}/ws/pty/${sessionId}`);

  ws.onopen = () => {
    if (fitAddon && term) {
      fitAddon.fit();
      ws?.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    }
  };

  ws.onmessage = (evt) => {
    term?.write(typeof evt.data === "string" ? evt.data : new Uint8Array(evt.data as ArrayBuffer));
  };

  ws.onclose = (ev) => {
    // 4000 = process exited normally (typed `exit`, process finished, etc.)
    if (ev.code === 4000) {
      terminalStore.removeSession(props.sessionId);
      return;
    }
    // 4404 = session no longer exists on the backend (server restarted)
    if (ev.code === 4404) {
      terminalStore.removeSession(props.sessionId);
      return;
    }
    if (!destroyed) {
      reconnectTimer = setTimeout(() => connect(sessionId), 1500);
    }
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function disconnect() {
  destroyed = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close();
  ws = null;
}

// Keep attempting fit until the container has non-zero dimensions, then connect.
// This avoids xterm initializing with 0 rows when called before CSS layout is ready.
function fitThenConnect(sessionId: string, attempts = 0) {
  if (destroyed) return;
  const el = container.value;
  if (!el || !fitAddon) return;

  const h = el.clientHeight;
  const w = el.clientWidth;

  if (h === 0 || w === 0) {
    if (attempts < 20) {
      requestAnimationFrame(() => fitThenConnect(sessionId, attempts + 1));
    }
    return;
  }

  fitAddon.fit();
  if (!connected) {
    connected = true;
    connect(sessionId);
  }
}

onMounted(() => {
  if (!container.value) return;

  term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "Menlo, Monaco, 'Courier New', monospace",
    theme: {
      background: "#1e1e1e",
      foreground: "#d4d4d4",
    },
  });

  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.open(container.value);

  term.onData((data) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  term.onResize(({ cols, rows }) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  });

  // Observe parent for layout-driven resizes (panel drag, window resize).
  // We observe the parent — not the xterm container — so xterm's own DOM
  // mutations don't trigger spurious fit() calls during heavy output.
  const observeTarget = container.value.parentElement ?? container.value;
  let fitScheduled = false;
  resizeObserver = new ResizeObserver(() => {
    if (fitScheduled) return;
    fitScheduled = true;
    requestAnimationFrame(() => {
      fitScheduled = false;
      fitAddon?.fit();
    });
  });
  resizeObserver.observe(observeTarget);

  nextTick(() => fitThenConnect(props.sessionId));
});

watch(() => props.sessionId, (newId) => {
  connected = false;
  disconnect();
  destroyed = false;
  fitThenConnect(newId);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  disconnect();
  term?.dispose();
  term = null;
});
</script>

<template>
  <div ref="container" class="pty-terminal" />
</template>

<style scoped>
.pty-terminal {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #1e1e1e;
}
</style>
