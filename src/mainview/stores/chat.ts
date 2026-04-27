import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api } from "../rpc";
import { useDrawerStore } from "./drawer";
import type { ChatSession, ConversationMessage, StreamError, StreamEvent } from "@shared/rpc-types";
import { useConversationStore } from "./conversation";
import { type QueuedMessage, type QueueState, emptyQueueState } from "./queue-types";

export const useChatStore = defineStore("chat", () => {
  const conversationStore = useConversationStore();
  const sessions = ref<ChatSession[]>([]);
  const activeChatSessionId = ref<number | null>(null);
  const messages = computed(() => conversationStore.messages);
  const messagesLoading = computed(() => conversationStore.messagesLoading);
  const unreadSessionIds = ref(new Set<number>());

  // ─── Queue state ──────────────────────────────────────────────────────────
  const sessionQueues = ref<Record<number, QueueState>>({});
  // Track sessions where the user explicitly cancelled — suppress queue drain on those transitions
  const suppressDrainIds = new Set<number>();

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
    const previous = idx !== -1 ? sessions.value[idx] : null;
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
    // Drain queue when session transitions from running to idle (natural completion only)
    if (previous?.status === "running" && session.status === "idle") {
      if (suppressDrainIds.has(session.id)) {
        suppressDrainIds.delete(session.id);
      } else {
        drainSessionQueue(session.id);
      }
    }
  }

  conversationStore.registerHooks("chat-store", {
    onStreamEvent(event, context) {
      if (event.taskId != null || event.conversationId == null) return;
      const sessionId = sessionIdForConversation(event.conversationId);
      if (sessionId == null) return;

      if (event.type === "done") {
        // Route through onChatSessionUpdated so the drain guard fires (backend
        // never broadcasts chatSession.updated on natural completion).
        const session = sessions.value.find(s => s.id === sessionId);
        if (session) {
          onChatSessionUpdated({ ...session, status: "idle" });
        }
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

  async function cancelSession(sessionId: number) {
    suppressDrainIds.add(sessionId);
    try {
      await api("chatSessions.cancel", { sessionId });
    } catch (err) {
      suppressDrainIds.delete(sessionId);
      throw err;
    }
  }

  async function sendMessage(content: string, engineContent?: string, attachments?: import("@shared/rpc-types").Attachment[], model?: string | null) {
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
      ...(engineContent != null ? { engineContent } : {}),
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
    delete sessionQueues.value[sessionId];
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

  // ─── Queue actions ────────────────────────────────────────────────────────

  function enqueueMessage(sessionId: number, msg: QueuedMessage) {
    if (!sessionQueues.value[sessionId]) sessionQueues.value[sessionId] = emptyQueueState();
    sessionQueues.value[sessionId].items.push(msg);
  }

  function dequeueMessage(sessionId: number, msgId: string) {
    const queue = sessionQueues.value[sessionId];
    if (!queue) return;
    queue.items = queue.items.filter((i) => i.id !== msgId);
    if (queue.editingId === msgId) queue.editingId = null;
  }

  function startEdit(sessionId: number, msgId: string) {
    if (!sessionQueues.value[sessionId]) return;
    sessionQueues.value[sessionId].editingId = msgId;
  }

  function confirmEdit(sessionId: number, msgId: string, text: string, engineText: string, attachments: import("@shared/rpc-types").Attachment[]) {
    const queue = sessionQueues.value[sessionId];
    if (!queue) return;
    const idx = queue.items.findIndex((i) => i.id === msgId);
    if (idx !== -1) {
      queue.items[idx] = { ...queue.items[idx], text, engineText, attachments };
    }
    queue.editingId = null;
  }

  function cancelEdit(sessionId: number) {
    const queue = sessionQueues.value[sessionId];
    if (!queue) return;
    queue.editingId = null;
  }

  /** Atomically clears the queue and returns combined payload, or null if empty. */
  function takeQueue(sessionId: number): { text: string; engineText: string; attachments: import("@shared/rpc-types").Attachment[] } | null {
    const queue = sessionQueues.value[sessionId];
    if (!queue || queue.items.length === 0) return null;
    const items = [...queue.items];
    sessionQueues.value[sessionId] = emptyQueueState();
    return {
      text: items.map((i) => i.text).join("\n\n---\n\n"),
      engineText: items.map((i) => i.engineText).join("\n\n---\n\n"),
      attachments: items.flatMap((i) => i.attachments),
    };
  }

  async function drainSessionQueue(sessionId: number) {
    const payload = takeQueue(sessionId);
    if (!payload) return;
    const session = sessions.value.find(s => s.id === sessionId);
    if (!session) return;
    await api("chatSessions.sendMessage", {
      sessionId,
      conversationId: session.conversationId,
      content: payload.text,
      engineContent: payload.engineText,
      attachments: payload.attachments.length ? payload.attachments : undefined,
    });
  }

  return {
    sessions,
    activeChatSessionId,
    activeSession,
    messages,
    messagesLoading,
    unreadSessionIds,
    loadSessions,
    createSession,
    selectSession,
    closeSession,
    cancelSession,
    sendMessage,
    renameSession,
    archiveSession,
    hasUnread,
    markUnread,
    clearUnread,
    onChatSessionUpdated,
    onStreamError,
    onStreamEvent,
    // Queue
    sessionQueues,
    enqueueMessage,
    dequeueMessage,
    startEdit,
    confirmEdit,
    cancelEdit,
    takeQueue,
  };
});
