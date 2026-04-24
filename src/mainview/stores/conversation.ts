import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { api } from "../rpc";
import type { ConversationMessage, StreamError, StreamEvent, StreamEventType, StreamToken } from "@shared/rpc-types";

function tryParseJson(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s); } catch { return null; }
}

function extractToolResultText(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return raw;
    if (typeof parsed.detailedContent === "string" && parsed.detailedContent) return parsed.detailedContent;
    if (Array.isArray(parsed.contents)) {
      const texts = parsed
        .contents
        .filter((entry: Record<string, unknown>) => typeof entry.text === "string")
        .map((entry: Record<string, unknown>) => entry.text as string);
      if (texts.length > 0) return texts.join("\n");
    }
    if (typeof parsed.content === "string") return parsed.content;
    return raw;
  } catch {
    return raw;
  }
}

export interface StreamBlock {
  blockId: string;
  type: StreamEventType;
  content: string;
  metadata: string | null;
  parentBlockId: string | null;
  done: boolean;
  children: string[];
}

export interface ConversationStreamState {
  conversationId: number;
  executionId: number;
  roots: string[];
  blocks: Map<string, StreamBlock>;
  isDone: boolean;
  statusMessage: string;
}

interface LegacyStreamState {
  conversationId: number;
  executionId: number | null;
  token: string;
  reasoningToken: string;
  statusMessage: string;
  isStreamingReasoning: boolean;
}

interface ContextUsage {
  usedTokens: number;
  maxTokens: number;
  fraction: number;
}

interface ConversationHookContext {
  activeConversationId: number | null;
}

interface ConversationHooks {
  onStreamEvent?: (event: StreamEvent, context: ConversationHookContext) => void;
  onNewMessage?: (message: ConversationMessage, context: ConversationHookContext) => void;
}

function removeScopedLiveBlocks(
  state: ConversationStreamState,
  liveType: string,
  scopeParent: string | null,
): number {
  const toRemove: string[] = [];
  for (const [blockId, block] of state.blocks) {
    if (block.type === liveType && block.parentBlockId === scopeParent) {
      toRemove.push(blockId);
    }
  }
  if (toRemove.length === 0) return -1;

  const removeSet = new Set(toRemove);
  const list = scopeParent
    ? (state.blocks.get(scopeParent)?.children ?? [])
    : state.roots;

  let earliest = -1;
  for (let i = 0; i < list.length; i++) {
    if (removeSet.has(list[i])) {
      earliest = i;
      break;
    }
  }

  if (scopeParent) {
    const parent = state.blocks.get(scopeParent);
    if (parent) parent.children = parent.children.filter((id) => !removeSet.has(id));
  } else {
    state.roots = state.roots.filter((id) => !removeSet.has(id));
  }
  for (const blockId of toRemove) state.blocks.delete(blockId);

  return earliest;
}

export const useConversationStore = defineStore("conversation", () => {
  const activeConversationId = ref<number | null>(null);
  const messages = ref<ConversationMessage[]>([]);
  const messagesLoading = ref(false);

  const streamStates = ref(new Map<number, ConversationStreamState>());
  const liveStreams = ref(new Map<number, LegacyStreamState>());
  const streamVersion = ref(0);
  const contextUsageByConversation = ref(new Map<number, ContextUsage>());
  const hooks = ref(new Map<string, ConversationHooks>());

  const activeStreamState = computed(() =>
    activeConversationId.value != null
      ? streamStates.value.get(activeConversationId.value) ?? null
      : null,
  );
  const activeLegacyStream = computed(() =>
    activeConversationId.value != null
      ? liveStreams.value.get(activeConversationId.value) ?? null
      : null,
  );
  const streamingToken = computed(() => activeLegacyStream.value?.token ?? "");
  const streamingReasoningToken = computed(() => activeLegacyStream.value?.reasoningToken ?? "");
  const streamingStatusMessage = computed(() => activeLegacyStream.value?.statusMessage ?? "");
  const streamingConversationId = computed(() => activeLegacyStream.value?.conversationId ?? null);
  const contextUsage = computed(() =>
    activeConversationId.value != null
      ? contextUsageByConversation.value.get(activeConversationId.value) ?? null
      : null,
  );

  function registerHooks(name: string, value: ConversationHooks) {
    hooks.value = new Map(hooks.value).set(name, value);
    return () => {
      const next = new Map(hooks.value);
      next.delete(name);
      hooks.value = next;
    };
  }

  function notifyStreamEvent(event: StreamEvent) {
    const context = { activeConversationId: activeConversationId.value };
    for (const hook of hooks.value.values()) {
      hook.onStreamEvent?.(event, context);
    }
  }

  function notifyNewMessage(message: ConversationMessage) {
    const context = { activeConversationId: activeConversationId.value };
    for (const hook of hooks.value.values()) {
      hook.onNewMessage?.(message, context);
    }
  }

  function sortMessagesInPlace() {
    messages.value = [...messages.value].sort((a, b) => a.id - b.id);
  }

  function setActiveConversation(conversationId: number | null) {
    activeConversationId.value = conversationId;
    if (conversationId == null) {
      messages.value = [];
      messagesLoading.value = false;
    }
  }

  function appendMessage(message: ConversationMessage) {
    if (message.conversationId !== activeConversationId.value) return;
    if (messages.value.some((entry) => entry.id === message.id)) return;
    messages.value.push(message);
    sortMessagesInPlace();
  }

  async function loadMessages(params: { conversationId: number; taskId?: number }) {
    activeConversationId.value = params.conversationId;
    messagesLoading.value = true;
    try {
      const loaded = await api("conversations.getMessages", params);
      if (activeConversationId.value !== params.conversationId) return;
      messages.value = [...loaded].sort((a, b) => a.id - b.id);

      const existingState = streamStates.value.get(params.conversationId);
      if (existingState) {
        const persistedTypes: StreamEventType[] = ["assistant", "reasoning", "tool_call", "tool_result", "file_diff", "user", "system"];
        const toRemove = new Set<string>();

        for (const [blockId, block] of existingState.blocks) {
          if (persistedTypes.includes(block.type)) toRemove.add(blockId);
        }
        for (const blockId of toRemove) {
          existingState.blocks.delete(blockId);
        }

        existingState.roots = [];
        for (const [blockId, block] of existingState.blocks) {
          if (!block.parentBlockId) existingState.roots.push(blockId);
        }
        streamStates.value = new Map(streamStates.value);
      }
    } finally {
      if (activeConversationId.value === params.conversationId) {
        messagesLoading.value = false;
      }
    }
  }

  async function fetchContextUsage(params: { conversationId: number; taskId?: number }) {
    try {
      const usage = await api("conversations.contextUsage", params);
      const next = new Map(contextUsageByConversation.value);
      next.set(params.conversationId, usage);
      contextUsageByConversation.value = next;
    } catch {
      const next = new Map(contextUsageByConversation.value);
      next.delete(params.conversationId);
      contextUsageByConversation.value = next;
    }
  }

  function getOrCreateLiveState(conversationId: number, executionId: number | null): LegacyStreamState {
    const existing = liveStreams.value.get(conversationId);
    if (existing && (executionId == null || existing.executionId === executionId)) {
      return existing;
    }
    const created: LegacyStreamState = {
      conversationId,
      executionId,
      token: "",
      reasoningToken: "",
      statusMessage: "",
      isStreamingReasoning: false,
    };
    liveStreams.value = new Map(liveStreams.value).set(conversationId, created);
    return created;
  }

  function clearLiveState(conversationId: number) {
    if (!liveStreams.value.has(conversationId)) return;
    const next = new Map(liveStreams.value);
    next.delete(conversationId);
    liveStreams.value = next;
  }

  function onStreamToken(payload: StreamToken) {
    if (payload.conversationId == null) return;
    const liveState = getOrCreateLiveState(payload.conversationId, payload.executionId);

    if (payload.done) {
      clearLiveState(payload.conversationId);
      return;
    }

    if (payload.isStatus) {
      liveState.statusMessage = payload.token;
      liveStreams.value = new Map(liveStreams.value);
      return;
    }

    if (payload.isReasoning) {
      if (!liveState.isStreamingReasoning) {
        liveState.reasoningToken = "";
      }
      liveState.reasoningToken += payload.token;
      liveState.isStreamingReasoning = true;
      liveStreams.value = new Map(liveStreams.value);
      return;
    }

    if (liveState.isStreamingReasoning) {
      liveState.isStreamingReasoning = false;
    }
    liveState.statusMessage = "";
    liveState.token += payload.token;
    liveStreams.value = new Map(liveStreams.value);
  }

  function onStreamError(payload: StreamError) {
    if (payload.conversationId == null) return;
    clearLiveState(payload.conversationId);
    if (payload.conversationId !== activeConversationId.value) return;
    appendMessage({
      id: Date.now(),
      taskId: payload.taskId,
      conversationId: payload.conversationId,
      type: "system",
      role: null,
      content: `Error: ${payload.error}`,
      metadata: null,
      createdAt: new Date().toISOString(),
    });
  }

  function onStreamEvent(event: StreamEvent) {
    if (event.conversationId == null) return;
    streamVersion.value++;
    notifyStreamEvent(event);

    let state = streamStates.value.get(event.conversationId);
    if (!state) {
      state = {
        conversationId: event.conversationId,
        executionId: event.executionId,
        roots: [],
        blocks: new Map(),
        isDone: false,
        statusMessage: "",
      };
      streamStates.value.set(event.conversationId, state);
    } else if (state.executionId !== event.executionId) {
      state.roots = [];
      state.blocks = new Map();
      state.isDone = false;
      state.statusMessage = "";
      state.executionId = event.executionId;
    }

    if (event.type === "done") {
      state.isDone = true;
      state.statusMessage = "";
      const liveTypes = new Set(["text_chunk", "reasoning_chunk"]);
      for (const [, block] of state.blocks) {
        if (liveTypes.has(block.type)) block.done = true;
      }
      streamStates.value = new Map(streamStates.value);
      if (event.conversationId === activeConversationId.value) {
        loadMessages({
          conversationId: event.conversationId,
          ...(event.taskId != null ? { taskId: event.taskId } : {}),
        }).catch(console.error);
        fetchContextUsage({
          conversationId: event.conversationId,
          ...(event.taskId != null ? { taskId: event.taskId } : {}),
        }).catch(console.error);
      }
      return;
    }

    if (event.type === "status_chunk") {
      state.statusMessage = event.content;
      streamStates.value = new Map(streamStates.value);
      return;
    }

    if (event.type === "text_chunk" || event.type === "reasoning_chunk") {
      const blockType = event.type === "text_chunk" ? "text_chunk" : "reasoning_chunk";
      let lastBlockId: string | undefined;
      let lastBlock: StreamBlock | undefined;

      if (event.parentBlockId) {
        const parentBlock = state.blocks.get(event.parentBlockId);
        if (parentBlock) {
          lastBlockId = parentBlock.children.at(-1);
          lastBlock = lastBlockId ? state.blocks.get(lastBlockId) : undefined;
        }
      } else {
        lastBlockId = state.roots.at(-1);
        lastBlock = lastBlockId ? state.blocks.get(lastBlockId) : undefined;
      }

      if (lastBlock && lastBlock.type === blockType && !lastBlock.done) {
        lastBlock.content += event.content;
      } else {
        const newBlockId = `live-${blockType}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const newBlock: StreamBlock = {
          blockId: newBlockId,
          type: blockType,
          content: event.content,
          metadata: null,
          parentBlockId: event.parentBlockId ?? null,
          done: false,
          children: [],
        };
        state.blocks.set(newBlockId, newBlock);
        if (event.parentBlockId) {
          const parentBlock = state.blocks.get(event.parentBlockId);
          if (parentBlock) parentBlock.children.push(newBlockId);
        } else {
          state.roots.push(newBlockId);
        }
      }
      streamStates.value = new Map(streamStates.value);
      return;
    }

    const blockId = event.blockId || `${event.type}-${event.seq || Date.now()}`;
    const eventScope = event.parentBlockId ?? null;
    let insertIdx = -1;

    if (event.type === "tool_call") {
      insertIdx = removeScopedLiveBlocks(state, "reasoning_chunk", eventScope);
    }
    if (event.type === "assistant") {
      insertIdx = removeScopedLiveBlocks(state, "text_chunk", eventScope);
    }
    if (event.type === "reasoning") {
      insertIdx = removeScopedLiveBlocks(state, "reasoning_chunk", eventScope);
    }

    if (!state.blocks.has(blockId)) {
      const newBlock: StreamBlock = {
        blockId,
        type: event.type,
        content: event.content,
        metadata: event.metadata,
        parentBlockId: event.parentBlockId ?? null,
        done: true,
        children: [],
      };
      state.blocks.set(blockId, newBlock);

      if (event.parentBlockId) {
        const parentBlock = state.blocks.get(event.parentBlockId);
        if (parentBlock) {
          if (insertIdx >= 0) {
            parentBlock.children.splice(insertIdx, 0, blockId);
          } else {
            parentBlock.children.push(blockId);
          }
        } else if (insertIdx >= 0) {
          state.roots.splice(insertIdx, 0, blockId);
        } else {
          state.roots.push(blockId);
        }
      } else if (insertIdx >= 0) {
        state.roots.splice(insertIdx, 0, blockId);
      } else {
        state.roots.push(blockId);
      }
    } else if (event.type === "tool_result") {
      const existing = state.blocks.get(blockId)!;
      existing.done = true;
      const resultMeta = {
        ...(existing.metadata ? tryParseJson(existing.metadata) : {}),
        hasResult: true,
        resultContent: extractToolResultText(event.content),
        resultMetadata: event.metadata,
      };
      existing.metadata = JSON.stringify(resultMeta);
    }

    streamStates.value = new Map(streamStates.value);
  }

  function onNewMessage(message: ConversationMessage) {
    notifyNewMessage(message);
    if (message.conversationId !== activeConversationId.value) return;

    const streamState = streamStates.value.get(message.conversationId);
    if (streamState && !streamState.isDone) return;
    if (messages.value.some((entry) => entry.id === message.id)) return;

    const liveState = liveStreams.value.get(message.conversationId);
    if (message.type === "reasoning" && liveState) {
      liveState.reasoningToken = "";
      liveState.isStreamingReasoning = false;
      liveStreams.value = new Map(liveStreams.value);
    }
    if (message.type === "assistant" && liveState) {
      liveState.token = "";
      liveStreams.value = new Map(liveStreams.value);
    }

    messages.value.push(message);
    sortMessagesInPlace();
  }

  return {
    activeConversationId,
    messages,
    messagesLoading,
    streamStates,
    streamVersion,
    activeStreamState,
    streamingToken,
    streamingReasoningToken,
    streamingStatusMessage,
    streamingConversationId,
    contextUsage,
    contextUsageByConversation,
    registerHooks,
    setActiveConversation,
    appendMessage,
    loadMessages,
    fetchContextUsage,
    onStreamToken,
    onStreamError,
    onStreamEvent,
    onNewMessage,
  };
});
