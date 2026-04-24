import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api } from "../rpc";
import { useDrawerStore } from "./drawer";
import type { ChatSession, ConversationMessage, StreamToken, StreamError, StreamEvent } from "@shared/rpc-types";
import { useConversationStore } from "./conversation";

export const useChatStore = defineStore("chat", () => {
  const conversationStore = useConversationStore();
  const sessions = ref<ChatSession[]>([]);
  const activeChatSessionId = ref<number | null>(null);
  const messages = computed(() => conversationStore.messages);
  const messagesLoading = computed(() => conversationStore.messagesLoading);
  const unreadSessionIds = ref(new Set<number>());

  const streamingToken = computed(() => conversationStore.streamingToken);
  const streamingConversationId = computed(() => conversationStore.streamingConversationId);
  const isStreaming = computed(() => streamingConversationId.value != null);

  const activeSession = computed(() =>
    activeChatSessionId.value != null
      ? sessions.value.find(s => s.id === activeChatSessionId.value) ?? null
      : null
  );

  function updateSession(sessionId: number, patch: Partial<ChatSession>) {
    const idx = sessions.value.findIndex((session) => session.id === sessionId);
    if (idx === -1) return;
    sessions.value[idx] = { ...sessions.value[idx], ...patch };
    sessions.value = [...sessions.value].sort(
      (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    );
  }

  function sessionIdForConversation(conversationId: number): number | null {
    return sessions.value.find((session) => session.conversationId === conversationId)?.id ?? null;
  }

  function onChatSessionUpdated(session: ChatSession) {
    const idx = sessions.value.findIndex(s => s.id === session.id);
    if (idx !== -1) {
      sessions.value[idx] = session;
    } else {
      sessions.value.push(session);
    }
    // Re-sort by lastActivityAt DESC
    sessions.value = [...sessions.value].sort(
      (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    );
    // Mark unread if not active and the session is awaiting attention (idle = execution just finished, waiting_user = needs user input)
    if (session.id !== activeChatSessionId.value && (session.status === 'idle' || session.status === 'waiting_user') && session.lastReadAt == null) {
      markUnread(session.id);
    }
  }

  conversationStore.registerHooks("chat-store", {
    onStreamEvent(event, context) {
      if (event.taskId != null || event.conversationId == null) return;
      const sessionId = sessionIdForConversation(event.conversationId);
      if (sessionId == null) return;

      if (event.type === "done") {
        updateSession(sessionId, { status: "idle" });
      }

      if (
        event.conversationId !== context.activeConversationId &&
        (event.type === "assistant" || event.type === "reasoning" || event.type === "system" || event.type === "file_diff")
      ) {
        markUnread(sessionId);
      }
    },
    onNewMessage(message, context) {
      if (message.taskId != null) return;
      const sessionId = sessionIdForConversation(message.conversationId);
      if (sessionId == null) return;

      if (message.type === "ask_user_prompt" || message.type === "interview_prompt") {
        updateSession(sessionId, { status: "waiting_user" });
      }

      if (
        message.conversationId !== context.activeConversationId &&
        (message.type === "assistant" || message.type === "reasoning" || message.type === "system" || message.type === "file_diff")
      ) {
        markUnread(sessionId);
      }
    },
  });

  function onStreamToken(payload: StreamToken) {
    conversationStore.onStreamToken(payload);
  }

  function onStreamError(payload: StreamError) {
    conversationStore.onStreamError(payload);
  }

  function onStreamEvent(event: StreamEvent) {
    conversationStore.onStreamEvent(event);
  }

  async function loadSessions(workspaceKey?: string) {
    const result = await api("chatSessions.list", { workspaceKey });
    sessions.value = [...result].sort(
      (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    );
    // Mark sessions without a lastReadAt as unread on initial load
    for (const session of sessions.value) {
      if (session.id !== activeChatSessionId.value && session.lastReadAt == null) {
        markUnread(session.id);
      }
    }
    return sessions.value;
  }

  async function createSession(workspaceKey?: string, title?: string): Promise<ChatSession> {
    const session = await api("chatSessions.create", { workspaceKey, title });
    onChatSessionUpdated(session);
    return session;
  }

  async function selectSession(sessionId: number) {
    const drawerStore = useDrawerStore();
    activeChatSessionId.value = sessionId;
    clearUnread(sessionId);
    // Open the drawer immediately so the loading spinner is visible while messages load
    const session = sessions.value.find(s => s.id === sessionId);
    if (session) {
      drawerStore.openForSession(sessionId, session.conversationId);
      conversationStore.setActiveConversation(session.conversationId);
      await conversationStore.loadMessages({ conversationId: session.conversationId });
      await conversationStore.fetchContextUsage({ conversationId: session.conversationId });
    }
    // Mark read on backend
    api("chatSessions.markRead", { sessionId }).catch(() => {});
  }

  function closeSession() {
    const drawerStore = useDrawerStore();
    activeChatSessionId.value = null;
    conversationStore.setActiveConversation(null);
    drawerStore.close();
  }

  async function sendMessage(content: string, attachments?: import("@shared/rpc-types").Attachment[], model?: string | null) {
    if (!activeChatSessionId.value) return;
    const session = activeSession.value;
    if (!session) return;
    const now = new Date().toISOString();
    updateSession(session.id, {
      status: "running",
      lastActivityAt: now,
      lastReadAt: now,
    });
    const { message } = await api("chatSessions.sendMessage", {
      sessionId: activeChatSessionId.value,
      content,
      model,
      ...(attachments?.length ? { attachments } : {}),
    });
    if (message) {
      conversationStore.appendMessage(message);
    }
  }

  async function renameSession(sessionId: number, title: string) {
    await api("chatSessions.rename", { sessionId, title });
  }

  async function archiveSession(sessionId: number) {
    await api("chatSessions.archive", { sessionId });
    const idx = sessions.value.findIndex(s => s.id === sessionId);
    if (idx !== -1) {
      sessions.value[idx] = { ...sessions.value[idx], status: 'archived' };
    }
    if (activeChatSessionId.value === sessionId) {
      closeSession();
    }
  }

  function markUnread(sessionId: number) {
    unreadSessionIds.value = new Set([...unreadSessionIds.value, sessionId]);
  }

  function clearUnread(sessionId: number) {
    const next = new Set(unreadSessionIds.value);
    next.delete(sessionId);
    unreadSessionIds.value = next;
  }

  function hasUnread(sessionId: number): boolean {
    return unreadSessionIds.value.has(sessionId);
  }

  return {
    sessions,
    activeChatSessionId,
    activeSession,
    messages,
    messagesLoading,
    unreadSessionIds,
    streamingToken,
    streamingConversationId,
    isStreaming,
    loadSessions,
    createSession,
    selectSession,
    closeSession,
    sendMessage,
    renameSession,
    archiveSession,
    hasUnread,
    markUnread,
    clearUnread,
    onChatSessionUpdated,
    onStreamToken,
    onStreamError,
    onStreamEvent,
  };
});
