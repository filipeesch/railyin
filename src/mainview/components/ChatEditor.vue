<script setup lang="ts">
/**
 * ChatEditor — CodeMirror 6 chat input with IntelliSense-style autocomplete.
 *
 * Sigils:
 *   /  → slash commands  (engine.listCommands)
 *   #  → files + LSP symbols  (workspace.listFiles + lsp.workspaceSymbol)
 *   @  → MCP agents / tools   (mcp.getStatus)
 *
 * Chip encoding in document:
 *   /name            — slash command (plain text, no chip)
 *   [#path/to/file.ts|file.ts]  — file reference chip
 *   [#path/to/file.ts:L10-L25|SymbolName] — symbol chip
 *   [@server:tool]   — MCP tool chip
 *
 * On send, chips are extracted from the doc and returned as attachments
 * alongside the human-readable plain text.
 */

import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder, ViewPlugin, Decoration, type DecorationSet, WidgetType, tooltips } from "@codemirror/view";
import { autocompletion, completionKeymap, completionStatus, type CompletionContext, type Completion, type CompletionResult, startCompletion } from "@codemirror/autocomplete";
import { api } from "../rpc";
import type { Attachment } from "@shared/rpc-types";
import { CHIP_PATTERN, extractChips } from "../utils/chat-chips";
import { useDarkMode } from "../composables/useDarkMode";

// ─── Props / Emits ────────────────────────────────────────────────────────────

const props = defineProps<{
  taskId: number;
  disabled?: boolean;
  placeholder?: string;
}>();

const emit = defineEmits<{
  send: [content: string, attachments: Attachment[]];
  textChange: [text: string];
}>();

// ─── DOM ref ──────────────────────────────────────────────────────────────────

const { isDark } = useDarkMode();

const editorEl = ref<HTMLElement | null>(null);
let editorView: EditorView | null = null;

// ─── Theme compartment (swapped on dark mode toggle) ─────────────────────────

const themeCompartment = new Compartment();

function buildTheme(dark: boolean): Extension {
  const bg = dark ? "var(--p-surface-900, #0f172a)" : "var(--p-surface-0, white)";
  const text = dark ? "var(--p-surface-100, #f1f5f9)" : "var(--p-surface-900, #0f172a)";
  const border = dark ? "var(--p-surface-700, #334155)" : "var(--p-surface-200, #e2e8f0)";
  const placeholder = dark ? "var(--p-surface-500, #64748b)" : "var(--p-surface-400, #94a3b8)";
  const tooltipBg = dark ? "var(--p-surface-800, #1e293b)" : "var(--p-surface-0, white)";
  const tooltipBorder = dark ? "var(--p-surface-600, #475569)" : "var(--p-surface-200, #e2e8f0)";
  const selectedBg = dark ? "var(--p-surface-700, #334155)" : "var(--p-surface-100, #f1f5f9)";
  const detail = dark ? "var(--p-surface-400, #94a3b8)" : "var(--p-surface-400, #94a3b8)";

  return EditorView.theme({
    "&": {
      fontSize: "inherit",
      fontFamily: "inherit",
    },
    ".cm-content": {
      padding: "8px 12px",
      minHeight: "36px",
      maxHeight: "200px",
      overflowY: "auto",
      caretColor: "var(--p-primary-color, #3b82f6)",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      color: text,
      background: bg,
      outline: "none",
    },
    ".cm-focused": {
      outline: "none",
    },
    ".cm-editor": {
      outline: "none",
    },
    ".cm-scroller": {
      outline: "none",
    },
    ".cm-line": {
      padding: "0",
    },
    ".cm-placeholder": {
      color: placeholder,
    },
    ".cm-tooltip-autocomplete": {
      background: tooltipBg,
      border: `1px solid ${tooltipBorder}`,
      borderRadius: "6px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
      maxHeight: "280px",
      overflowY: "auto",
      zIndex: "9999",
      minWidth: "280px",
    },
    ".cm-tooltip-autocomplete ul": {
      fontFamily: "inherit",
      fontSize: "inherit",
      listStyle: "none",
      margin: "0",
      padding: "4px",
    },
    ".cm-tooltip-autocomplete ul li": {
      padding: "5px 10px",
      borderRadius: "4px",
      cursor: "pointer",
      display: "flex",
      alignItems: "stretch",
      gap: "0",
      color: text,
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      background: selectedBg,
      color: text,
    },
    ".cm-completionMatchedText": {
      fontWeight: "700",
      textDecoration: "none",
      color: "var(--p-primary-color, #3b82f6)",
    },
    // Hide default CM6 label/detail — we render our own two-line layout
    ".cm-completionLabel": { display: "none" },
    ".cm-completionDetail": { display: "none" },
    // Custom two-line row
    ".ce-completion-row": {
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      minWidth: "0",
      flex: "1",
    },
    ".ce-completion-top": {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      minWidth: "0",
    },
    ".ce-completion-label": {
      fontSize: "0.92em",
      fontWeight: "500",
      color: text,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      flex: "1",
      minWidth: "0",
    },
    ".ce-completion-detail": {
      fontSize: "0.78em",
      color: detail,
      whiteSpace: "nowrap",
      overflow: "hidden",
      paddingLeft: "0",
    },
    // Ticker animation — only on the inner scrolling span
    ".ce-completion-detail-inner": {
      display: "inline-block",
    },
    ".ce-completion-detail-inner.is-scrollable": {
      animationName: "ce-ticker",
      animationDuration: "var(--ce-ticker-duration, 3s)",
      animationTimingFunction: "ease-in-out",
      animationDelay: "1s",
      animationIterationCount: "infinite",
      animationDirection: "alternate",
      animationFillMode: "both",
    },
  });
}

// ─── Chip token widget ────────────────────────────────────────────────────────

class ChipWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "chat-editor__chip";
    span.textContent = this.label;
    span.setAttribute("aria-label", this.label);
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

// ─── Chip decoration plugin ───────────────────────────────────────────────────

const chipDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: import("@codemirror/view").ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => {
        return view.plugin(plugin)?.decorations ?? Decoration.none;
      }),
  },
);

function buildDecorations(view: EditorView): DecorationSet {
  const decorations: import("@codemirror/state").Range<Decoration>[] = [];
  const doc = view.state.doc.toString();
  let m: RegExpExecArray | null;
  CHIP_PATTERN.lastIndex = 0;
  while ((m = CHIP_PATTERN.exec(doc)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    const label = m[2];
    decorations.push(
      Decoration.replace({
        widget: new ChipWidget(label),
        inclusive: false,
      }).range(from, to),
    );
  }
  return Decoration.set(decorations, true);
}

// ─── Completion sources ───────────────────────────────────────────────────────

async function slashCompletions(context: CompletionContext): Promise<CompletionResult | null> {
  // Match "/" at start of line, after whitespace, or immediately after a chip token ("]")
  const match = context.matchBefore(/(?:^|[\s\]])\/([a-zA-Z0-9_:-]*)$/);
  if (!match && !context.explicit) return null;

  const typed = match ? match.text.replace(/^[\s\]]*\//, "") : "";

  let commands: { name: string; description?: string }[] = [];
  try {
    commands = await api("engine.listCommands", { taskId: props.taskId });
  } catch {
    return null;
  }

  const filtered = commands.filter((c) =>
    typed === "" || c.name.toLowerCase().includes(typed.toLowerCase()),
  );

  if (!filtered.length) return null;

  return {
    from: match ? match.from + match.text.indexOf("/") : context.pos,
    options: filtered.map((c) => ({
      label: `/${c.name}`,
      detail: c.description,
      type: "keyword",
      apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
        const chip = `[/${c.name}|${c.name}]`;
        view.dispatch({ changes: { from, to, insert: chip } });
      },
    })),
  };
}

async function hashCompletions(context: CompletionContext): Promise<CompletionResult | null> {
  // Stop at "]" so we don't greedily match backward through a chip token
  const match = context.matchBefore(/#([^\][\s]*)$/);
  if (!match && !context.explicit) return null;

  const query = match ? match.text.slice(1) : "";

  const [filesResult, symbolsResult] = await Promise.allSettled([
    api("workspace.listFiles", { taskId: props.taskId, query }),
    query.length >= 2 ? api("lsp.workspaceSymbol", { taskId: props.taskId, query }) : Promise.resolve([]),
  ]);

  const options: Completion[] = [];

  if (filesResult.status === "fulfilled") {
    for (const f of filesResult.value) {
      options.push({
        label: f.name,
        detail: f.path,
        type: "variable",
        apply: (view, _completion, _from, to) => {
          const chip = `[#${f.path}|${f.name}]`;
          // Replace from the '#' sigil position (match.from), not from after it
          const chipFrom = match ? match.from : _from;
          view.dispatch({ changes: { from: chipFrom, to, insert: chip } });
        },
      });
    }
  }

  if (symbolsResult.status === "fulfilled" && Array.isArray(symbolsResult.value)) {
    for (const sym of symbolsResult.value as Array<{ name: string; location?: { uri: string }; containerName?: string }>) {
      if (!sym?.name) continue;
      const uri = sym.location?.uri ?? "";
      const filePath = uri.startsWith("file://") ? uri.slice(7) : uri;
      const container = sym.containerName ? `${sym.containerName}.` : "";
      const label = `${container}${sym.name}`;
      options.push({
        label,
        detail: filePath || "symbol",
        type: "class",
        apply: (view, _completion, _from, to) => {
          const shortPath = filePath.split("/").slice(-1)[0] ?? filePath;
          const chip = `[#${filePath}|${sym.name}]`;
          void shortPath;
          // Replace from the '#' sigil position (match.from), not from after it
          const chipFrom = match ? match.from : _from;
          view.dispatch({ changes: { from: chipFrom, to, insert: chip } });
        },
      });
    }
  }

  if (!options.length) return null;

  return {
    // from points to just after '#' so CM6's filter string is the query text (not '#query')
    from: match ? match.from + 1 : context.pos,
    options,
  };
}

async function atCompletions(context: CompletionContext): Promise<CompletionResult | null> {
  // Stop at "]" so we don't greedily match backward through a chip token
  const match = context.matchBefore(/@([^\][\s]*)$/);
  if (!match && !context.explicit) return null;

  const query = match ? match.text.slice(1).toLowerCase() : "";

  let servers: { name: string; tools: { name: string; description?: string }[]; state: string }[] = [];
  try {
    const mcpStatus = await api("mcp.getStatus", {});
    servers = mcpStatus as typeof servers;
  } catch {
    return null;
  }

  const options: Completion[] = [];
  for (const server of servers) {
    if (server.state !== "running") continue;
    for (const tool of server.tools ?? []) {
      const label = `${server.name}:${tool.name}`;
      if (query && !label.toLowerCase().includes(query)) continue;
      options.push({
        label,
        detail: tool.description,
        type: "function",
        apply: (view, _completion, _from, to) => {
          const chip = `[@${server.name}:${tool.name}|${tool.name}]`;
          // Replace from the '@' sigil position (match.from), not from after it
          const chipFrom = match ? match.from : _from;
          view.dispatch({ changes: { from: chipFrom, to, insert: chip } });
        },
      });
    }
  }

  if (!options.length) return null;

  return {
    // from points to just after '@' so CM6's filter string is the query text (not '@query')
    from: match ? match.from + 1 : context.pos,
    options,
  };
}

// ─── Send helper — extract chips from document text ──────────────────────────

function extractAndSend() {
  if (!editorView || props.disabled) return;

  const doc = editorView.state.doc.toString();
  if (!doc.trim()) return;

  const { humanText, attachments } = extractChips(doc);
  emit("send", humanText, attachments);

  // Clear editor
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: "" },
  });
}

// ─── Two-line completion row renderer with ticker on overflow ────────────────

/**
 * Builds a two-line DOM node for a completion item:
 *   Line 1: label (the name / filename)
 *   Line 2: detail (path / description) — scrolls like a ticker if it overflows
 */
function renderCompletionRow(completion: Completion): Node | null {
  if (!completion.detail && !completion.label) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "ce-completion-row";

  const topLine = document.createElement("div");
  topLine.className = "ce-completion-top";

  const labelEl = document.createElement("span");
  labelEl.className = "ce-completion-label";
  labelEl.textContent = completion.label;
  topLine.appendChild(labelEl);

  wrapper.appendChild(topLine);

  if (completion.detail) {
    const detailOuter = document.createElement("div");
    detailOuter.className = "ce-completion-detail";

    const detailInner = document.createElement("span");
    detailInner.className = "ce-completion-detail-inner";
    detailInner.textContent = completion.detail;
    detailOuter.appendChild(detailInner);
    wrapper.appendChild(detailOuter);

    // After the element is in the DOM, check if detail text overflows.
    // If so, compute how far it needs to scroll and enable the ticker.
    requestAnimationFrame(() => {
      const overflow = detailInner.scrollWidth - detailOuter.clientWidth;
      if (overflow > 4) {
        // Duration scales with distance so speed feels consistent (~60px/s)
        const duration = Math.max(2, overflow / 60);
        detailInner.style.setProperty("--ce-ticker-duration", `${duration.toFixed(1)}s`);
        detailInner.style.setProperty("--ce-ticker-offset", `-${overflow}px`);
        detailInner.classList.add("is-scrollable");
      }
    });
  }

  return wrapper;
}



function buildExtensions(): Extension[] {
  return [
    tooltips({ position: "fixed", parent: document.body }),
    cmPlaceholder(props.placeholder ?? "Send a message… (Shift+Enter for newline)"),
    autocompletion({
      override: [slashCompletions, hashCompletions, atCompletions],
      closeOnBlur: false,
      activateOnTyping: true,
      interactionDelay: 0,
      addToOptions: [
        {
          render: renderCompletionRow,
          position: 20, // after the default label slot (position 50) — we hide label/detail via CSS
        },
      ],
    }),
    keymap.of([
      ...completionKeymap,
      {
        key: "Enter",
        run: (view) => {
          // Only block Enter when the autocomplete dropdown is actively showing.
          // "pending" means a fetch is in-flight but nothing is visible — allow send.
          if (completionStatus(view.state) === "active") return false;
          extractAndSend();
          return true;
        },
      },
      {
        key: "Shift-Enter",
        run: () => false, // allow natural newline insertion
      },
      {
        key: "Mod-/",
        run: (view) => {
          // Ctrl+/ or Cmd+/ — trigger slash completion
          view.dispatch(view.state.update({
            changes: { from: view.state.selection.main.head, insert: "/" },
            selection: { anchor: view.state.selection.main.head + 1 },
          }));
          startCompletion(view);
          return true;
        },
      },
    ]),
    chipDecorationPlugin,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        emit("textChange", update.state.doc.toString());
      }
    }),
    themeCompartment.of(buildTheme(isDark.value)),
    EditorView.editable.of(!props.disabled),
  ];
}

onMounted(() => {
  if (!editorEl.value) return;

  editorView = new EditorView({
    state: EditorState.create({
      doc: "",
      extensions: buildExtensions(),
    }),
    parent: editorEl.value,
  });
});

onBeforeUnmount(() => {
  editorView?.destroy();
  editorView = null;
});

// Rebuild extensions when disabled changes
watch(
  () => props.disabled,
  () => {
    if (!editorView) return;
    editorView.dispatch({
      effects: EditorView.editable.reconfigure(!props.disabled),
    });
  },
);

// Swap theme when dark mode changes
watch(isDark, (dark) => {
  if (!editorView) return;
  editorView.dispatch({
    effects: themeCompartment.reconfigure(buildTheme(dark)),
  });
});

// ─── Exposed API ──────────────────────────────────────────────────────────────

defineExpose({
  /** Insert text or a chip at current cursor position */
  insert(text: string) {
    if (!editorView) return;
    const { from } = editorView.state.selection.main;
    editorView.dispatch({
      changes: { from, insert: text },
      selection: { anchor: from + text.length },
    });
    editorView.focus();
  },
  /** Focus the editor */
  focus() {
    editorView?.focus();
  },
  /** Get current plain text value */
  getValue(): string {
    return editorView?.state.doc.toString() ?? "";
  },
  /** Clear the editor */
  clear() {
    if (!editorView) return;
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: "" },
    });
  },
  /** Programmatically trigger send */
  send: extractAndSend,
});
</script>

<template>
  <div
    ref="editorEl"
    class="chat-editor"
    :class="{ 'chat-editor--disabled': disabled }"
  />
</template>

<style scoped>
.chat-editor {
  flex: 1;
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 6px;
  background: var(--p-surface-0, white);
  transition: border-color 0.15s;
  overflow: visible;
}

.chat-editor:focus-within {
  border-color: var(--p-primary-500, #3b82f6);
  box-shadow: 0 0 0 2px var(--p-primary-100, #dbeafe);
}

.chat-editor--disabled {
  opacity: 0.6;
  pointer-events: none;
}

/* Chip token style */
:deep(.chat-editor__chip) {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  margin: 0 2px;
  background: var(--p-primary-100, #dbeafe);
  color: var(--p-primary-800, #1e40af);
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: 500;
  white-space: nowrap;
  cursor: default;
  user-select: none;
}
</style>

<!-- Non-scoped block so html.dark-mode selector isn't stripped of the data-v hash -->
<style>
/* Suppress all browser-default outlines on CM6 editor elements */
.chat-editor .cm-editor,
.chat-editor .cm-editor.cm-focused,
.chat-editor .cm-scroller,
.chat-editor .cm-content {
  outline: none !important;
}

html.dark-mode .chat-editor {
  border-color: var(--p-surface-700, #334155);
  background: var(--p-surface-900, #0f172a);
}

html.dark-mode .chat-editor:focus-within {
  border-color: var(--p-primary-400, #60a5fa);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--p-primary-500, #3b82f6) 25%, transparent);
}

html.dark-mode .chat-editor .chat-editor__chip {
  background: color-mix(in srgb, var(--p-primary-500, #3b82f6) 25%, transparent);
  color: var(--p-primary-300, #93c5fd);
}

@keyframes ce-ticker {
  0%   { transform: translateX(0); }
  100% { transform: translateX(var(--ce-ticker-offset, 0px)); }
}
</style>
