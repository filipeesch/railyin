import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api } from "../rpc";
import { useDrawerStore } from "./drawer";
import { useWorkspaceStore } from "./workspace";
import type { ChatSession } from "@shared/rpc-types";
import { useConversationStore } from "./conversation";

export const useChatStore = defineStore("chat", () => {
  const conversationStore = useConversationStore();
  const workspaceStore = useWorkspaceStore();
  const sessions = ref<ChatSession[]>([]);
  const activeChatSessionId = ref<number | null>(null);
  const unreadSessionIds = ref(new Set<number>());

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
    const activeKey = workspaceStore.activeWorkspaceKey;
    if (activeKey !== null && session.workspaceKey !== activeKey) return;

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

    // Start with the cached session so the drawer can open even if the fetch fails
    let session: ChatSession | null = sessions.value.find(s => s.id === sessionId) ?? null;
    try {
      // Refetch the session to ensure we have the latest data (including model).
      // conversationId is assigned once at creation and never changes — always prefer
      // the cached value to guard against stale or test-fixture data.
      const fetched = await api("chatSessions.get", { sessionId });
      if (fetched) {
        session = session
          ? { ...fetched, conversationId: session.conversationId }
          : fetched;
        onChatSessionUpdated(session);
      }
    } catch {
      // Use cached session — fetch failure must not block the drawer
    }

    if (session) {
      drawerStore.openForSession(sessionId, session.conversationId);
      conversationStore.setActiveConversation(session.conversationId);
      await conversationStore.loadMessages({ conversationId: session.conversationId });
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
    await api("chatSessions.cancel", { sessionId });
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
    // The API returns { messageId, executionId }; the assistant reply surfaces
    // via the AG-UI/JSONL flow (RailyinChat history) and the session status via
    // the chatSession.updated push.
    await api("chatSessions.sendMessage", {
      sessionId: activeChatSessionId.value,
      content,
      ...(engineContent != null ? { engineContent } : {}),
      model,
      ...(attachments?.length ? { attachments } : {}),
    });
  }

  async function submitDecisions(sessionId: number, answers: import("@shared/rpc-types").DecisionAnswer[], generalNotes?: string, recordAsDecisions = true) {
    const session = activeSession.value;
    if (!session) return;
    const now = new Date().toISOString();
    updateSession(session.id, {
      status: "running",
      lastActivityAt: now,
      lastReadAt: now,
    });
    await api("chatSessions.submitDecisions", { sessionId, answers, generalNotes, recordAsDecisions });
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
    unreadSessionIds.value.add(sessionId);
  }

  function clearUnread(sessionId: number) {
    unreadSessionIds.value.delete(sessionId);
  }

  function hasUnread(sessionId: number): boolean {
    return unreadSessionIds.value.has(sessionId);
  }

  return {
    sessions,
    activeChatSessionId,
    activeSession,
    unreadSessionIds,
    loadSessions,
    createSession,
    selectSession,
    closeSession,
    cancelSession,
    sendMessage,
    submitDecisions,
    renameSession,
    archiveSession,
    hasUnread,
    markUnread,
    clearUnread,
    onChatSessionUpdated,
  };
});
