import { ref } from "vue";
import { defineStore } from "pinia";
import { api } from "../rpc";
import type { ConversationMessage } from "@shared/rpc-types";

export const useConversationStore = defineStore("conversation", () => {
  const activeConversationId = ref<number | null>(null);
  const messages = ref<ConversationMessage[]>([]);
  const messagesLoading = ref(false);
  const hasMoreBefore = ref(false);
  const isLoadingOlder = ref(false);

  function sortMessagesInPlace() {
    messages.value = [...messages.value].sort((a, b) => a.id - b.id);
  }

  function setActiveConversation(conversationId: number | null) {
    activeConversationId.value = conversationId;
    if (conversationId == null) {
      messages.value = [];
      messagesLoading.value = false;
      hasMoreBefore.value = false;
      isLoadingOlder.value = false;
    }
  }

  async function loadMessages(params: { conversationId: number }) {
    activeConversationId.value = params.conversationId;
    messagesLoading.value = true;
    try {
      const loaded = await api("conversations.getMessages", params);
      if (activeConversationId.value !== params.conversationId) return;
      messages.value = [...loaded.messages].sort((a, b) => a.id - b.id);
      hasMoreBefore.value = loaded.hasMore;
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

  return {
    activeConversationId,
    messages,
    messagesLoading,
    hasMoreBefore,
    isLoadingOlder,
    setActiveConversation,
    loadMessages,
    loadOlderMessages,
  };
});
