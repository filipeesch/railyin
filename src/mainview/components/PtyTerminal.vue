<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

const props = defineProps<{ sessionId: string }>();

const container = ref<HTMLElement | null>(null);

let term: Terminal | null = null;
let ws: WebSocket | null = null;
let fitAddon: FitAddon | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let destroyed = false;

function connect(sessionId: string) {
  if (destroyed) return;
  const wsBase = window.location.origin.replace(/^http/, "ws");
  ws = new WebSocket(`${wsBase}/ws/pty/${sessionId}`);

  ws.onopen = () => {
    // Notify terminal of current size on (re)connect
    if (fitAddon && term) {
      fitAddon.fit();
      ws?.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    }
  };

  ws.onmessage = (evt) => {
    term?.write(typeof evt.data === "string" ? evt.data : new Uint8Array(evt.data as ArrayBuffer));
  };

  ws.onclose = () => {
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

  // Defer fit() until after the Dialog has fully painted — onMounted fires
  // before the Dialog's CSS layout is committed, leaving the xterm viewport at 0.
  nextTick(() => {
    requestAnimationFrame(() => {
      fitAddon?.fit();
      connect(props.sessionId);
    });
  });

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

  const resizeObserver = new ResizeObserver(() => fitAddon?.fit());
  resizeObserver.observe(container.value);

  // Store observer so we can disconnect it later
  (container.value as HTMLElement & { _resizeObs?: ResizeObserver })._resizeObs = resizeObserver;
});

watch(() => props.sessionId, (newId) => {
  disconnect();
  destroyed = false;
  connect(newId);
});

onUnmounted(() => {
  const el = container.value as (HTMLElement & { _resizeObs?: ResizeObserver }) | null;
  el?._resizeObs?.disconnect();
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
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #1e1e1e;
}
</style>
