import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { api } from "../rpc";
import type { ConversationMessage, StreamError, StreamEvent, StreamEventType } from "@shared/rpc-types";

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

interface ContextUsage {
  usedTokens: number;
  maxTokens: number;
  fraction: number;
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
  const hasMoreBefore = ref(false);
  const isLoadingOlder = ref(false);

  const streamStates = ref(new Map<number, ConversationStreamState>());
  const contextUsageByConversation = ref(new Map<number, ContextUsage>());

  const activeStreamState = computed(() =>
    activeConversationId.value != null
      ? streamStates.value.get(activeConversationId.value) ?? null
      : null,
  );
  const contextUsage = computed(() =>
    activeConversationId.value != null
      ? contextUsageByConversation.value.get(activeConversationId.value) ?? null
      : null,
  );


  function sortMessagesInPlace() {
    messages.value = [...messages.value].sort((a, b) => a.id - b.id);
  }

  function setActiveConversation(conversationId: number | null) {
    const previousId = activeConversationId.value;
    activeConversationId.value = conversationId;
    if (previousId != null && previousId !== conversationId) {
      contextUsageByConversation.value.delete(previousId);
    }
    if (conversationId == null) {
      messages.value = [];
      messagesLoading.value = false;
      hasMoreBefore.value = false;
      isLoadingOlder.value = false;
    }
  }

  function appendMessage(message: ConversationMessage) {
    if (message.conversationId !== activeConversationId.value) return;
    if (messages.value.some((entry) => entry.id === message.id)) return;
    messages.value.push(message);
    sortMessagesInPlace();
  }

  async function loadMessages(params: { conversationId: number }) {
    activeConversationId.value = params.conversationId;
    messagesLoading.value = true;
    try {
      const loaded = await api("conversations.getMessages", params);
      if (activeConversationId.value !== params.conversationId) return;
      messages.value = [...loaded.messages].sort((a, b) => a.id - b.id);
      hasMoreBefore.value = loaded.hasMore;

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
        streamStates.value.set(params.conversationId, existingState);
      }
      if (activeConversationId.value === params.conversationId) {
        messagesLoading.value = false;
      }
    } catch {
      if (activeConversationId.value === params.conversationId) {
        messagesLoading.value = false;
      }
    }
  }

  async function loadOlderMessages(params: { conversationId: number }) {
    if (isLoadingOlder.value || !hasMoreBefore.value) return;
    if (activeConversationId.value !== params.conversationId) return;
    const oldest = messages.value[0]?.id;
    if (oldest == null) return;
    isLoadingOlder.value = true;
    try {
      const loaded = await api("conversations.getMessages", {
        conversationId: params.conversationId,
        beforeMessageId: oldest,
      });
      if (activeConversationId.value !== params.conversationId) return;
      messages.value = [...loaded.messages, ...messages.value];
      hasMoreBefore.value = loaded.hasMore;
    } finally {
      isLoadingOlder.value = false;
    }
  }

  async function refreshLatestPage(params: { conversationId: number }) {
    try {
      const loaded = await api("conversations.getMessages", { conversationId: params.conversationId });
      if (activeConversationId.value !== params.conversationId) return;
      const pivot = loaded.messages[0]?.id ?? 0;
      const oldHistory = messages.value.filter((m) => m.id < pivot);
      messages.value = [...oldHistory, ...loaded.messages];
      hasMoreBefore.value = loaded.hasMore || oldHistory.length > 0;

      const existingState = streamStates.value.get(params.conversationId);
      if (existingState) {
        const persistedTypes: StreamEventType[] = ["assistant", "reasoning", "tool_call", "tool_result", "file_diff", "user", "system"];
        const toRemove = new Set<string>();
        for (const [blockId, block] of existingState.blocks) {
          if (persistedTypes.includes(block.type)) toRemove.add(blockId);
        }
        for (const blockId of toRemove) existingState.blocks.delete(blockId);
        existingState.roots = [];
        for (const [blockId, block] of existingState.blocks) {
          if (!block.parentBlockId) existingState.roots.push(blockId);
        }
        streamStates.value.set(params.conversationId, existingState);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function fetchContextUsage(params: { conversationId: number }) {
    try {
      const usage = await api("conversations.contextUsage", params);
      contextUsageByConversation.value.set(params.conversationId, usage);
    } catch {
      contextUsageByConversation.value.delete(params.conversationId);
    }
  }

  function onStreamError(payload: StreamError) {
    if (payload.conversationId == null) return;
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
      if (event.conversationId !== activeConversationId.value) {
        state.blocks.clear();
        state.roots = [];
      }
      streamStates.value.set(event.conversationId, state);
      if (event.conversationId === activeConversationId.value) {
        refreshLatestPage({ conversationId: event.conversationId }).catch(console.error);
        fetchContextUsage({ conversationId: event.conversationId }).catch(console.error);
      }
      return;
    }

    if (event.type === "status_chunk") {
      state.statusMessage = event.content;
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

  }

  function onNewMessage(message: ConversationMessage) {
    if (message.conversationId !== activeConversationId.value) return;

    const streamState = streamStates.value.get(message.conversationId);
    if (streamState && !streamState.isDone) return;
    if (messages.value.some((entry) => entry.id === message.id)) return;

    messages.value.push(message);
    sortMessagesInPlace();
  }

  return {
    activeConversationId,
    messages,
    messagesLoading,
    hasMoreBefore,
    isLoadingOlder,
    streamStates,
    activeStreamState,
    contextUsage,
    contextUsageByConversation,
    setActiveConversation,
    appendMessage,
    loadMessages,
    loadOlderMessages,
    refreshLatestPage,
    fetchContextUsage,
    onStreamError,
    onStreamEvent,
    onNewMessage,
  };
});
