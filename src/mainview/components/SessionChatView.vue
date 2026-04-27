<template>
  <div class="session-chat-view">
    <!-- Header row -->
    <div class="scv-header">
      <div class="scv-header__left">
        <!-- Inline rename: click title to edit -->
        <span
          v-if="!editingTitle"
          class="scv-header__title"
          :title="session?.title"
          @click="startEditTitle"
        >{{ session?.title ?? 'Chat Session' }}</span>
        <InputText
          v-else
          ref="titleInputRef"
          v-model="titleDraft"
          class="scv-header__title-input"
          size="small"
          @blur="commitTitle"
          @keydown.enter.prevent="commitTitle"
          @keydown.escape="editingTitle = false"
        />
        <Tag
          v-if="session"
          :value="statusLabel"
          :severity="statusSeverity"
          rounded
          class="ml-2 scv-status-tag"
          :data-status="session.status"
        />
      </div>
      <div class="scv-header__actions">
        <Button
          icon="pi pi-inbox"
          text
          rounded
          size="small"
          severity="secondary"
          v-tooltip="'Archive session'"
          class="scv-header__archive-btn"
          @click="archiveSession"
        />
        <Button
          icon="pi pi-times"
          text
          rounded
          size="small"
          severity="secondary"
          aria-label="Close"
          v-tooltip="'Close'"
          @click="chatStore.closeSession()"
        />
      </div>
    </div>

    <!-- Loading state (takes priority while messages are being fetched) -->
    <div v-if="conversationStore.messagesLoading" class="scv-loading">
      <ProgressSpinner style="width: 32px; height: 32px" />
    </div>

    <!-- Body: conversation -->
    <ConversationBody
      v-else-if="session"
      :messages="conversationStore.messages"
      :stream-state="conversationStore.activeStreamState"
      :execution-state="session.status"
      :self-id="session.conversationId"
      :has-more-before="conversationStore.hasMoreBefore"
      :is-loading-older="conversationStore.isLoadingOlder"
      @load-older="session.conversationId && conversationStore.loadOlderMessages({ conversationId: session.conversationId })"
    />

    <!-- Input bar -->
    <ConversationInput
      v-if="session && !conversationStore.messagesLoading"
      :execution-state="session.status"
      :session-id="session.id"
      :workspace-key="session.workspaceKey"
      :model-id="selectedModelId"
      :context-usage="conversationStore.contextUsage"
      :compacting="compacting"
      :enabled-mcp-tools="session.enabledMcpTools ?? null"
      :queue-state="chatStore.sessionQueues[session.id] ?? null"
      @send="onSend"
      @enqueue="onEnqueue"
      @confirm-edit="onConfirmEdit"
      @dequeue="(msgId) => session && chatStore.dequeueMessage(session.id, msgId)"
      @start-edit="(msgId) => session && chatStore.startEdit(session.id, msgId)"
      @cancel-edit="() => session && chatStore.cancelEdit(session.id)"
      @cancel="onCancel"
      @update:model-id="selectedModelId = $event"
      @compact="compactConversation"
      @manage-models="manageModelsOpen = true"
      @tools-changed="chatStore.onChatSessionUpdated"
    />

    <!-- Manage Models modal -->
    <ManageModelsModal
      v-model="manageModelsOpen"
      :workspace-key="session?.workspaceKey"
      @close="manageModelsOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from "vue";
import Tag from "primevue/tag";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import ProgressSpinner from "primevue/progressspinner";
import ConversationBody from "./ConversationBody.vue";
import ConversationInput from "./ConversationInput.vue";
import ManageModelsModal from "./ManageModelsModal.vue";
import { useChatStore } from "../stores/chat";
import { useDrawerStore } from "../stores/drawer";
import { useConversationStore } from "../stores/conversation";
import { useWorkspaceStore } from "../stores/workspace";
import { api } from "../rpc";
import type { Attachment } from "@shared/rpc-types";
import { useToast } from "primevue/usetoast";

const props = defineProps<{
  sessionId: number;
}>();

const chatStore = useChatStore();
const drawerStore = useDrawerStore();
const conversationStore = useConversationStore();
const workspaceStore = useWorkspaceStore();
const toast = useToast();

const session = computed(() => chatStore.activeSession);
const selectedModelId = ref<string | null>(workspaceStore.availableModels[0]?.id ?? null);
const manageModelsOpen = ref(false);
const compacting = ref(false);

// ─── Title editing ────────────────────────────────────────────────────────────

const editingTitle = ref(false);
const titleDraft = ref("");
const titleInputRef = ref<InstanceType<typeof InputText> | null>(null);

function startEditTitle() {
  if (!session.value) return;
  titleDraft.value = session.value.title;
  editingTitle.value = true;
  nextTick(() => {
    (titleInputRef.value?.$el as HTMLInputElement | undefined)?.select();
  });
}

async function commitTitle() {
  editingTitle.value = false;
  const newTitle = titleDraft.value.trim();
  if (!session.value || !newTitle || newTitle === session.value.title) return;
  try {
    await api("chatSessions.rename", { sessionId: session.value.id, title: newTitle });
  } catch (err) {
    console.error("Failed to rename session", err);
  }
}

// ─── Status display ───────────────────────────────────────────────────────────

const statusLabel = computed(() => {
  const map: Record<string, string> = {
    idle: "Idle", running: "Running…", waiting_user: "Awaiting input", archived: "Archived",
  };
  return session.value ? (map[session.value.status] ?? session.value.status) : "";
});

const statusSeverity = computed((): "secondary" | "info" | "warn" | "success" => {
  const map: Record<string, "secondary" | "info" | "warn" | "success"> = {
    idle: "secondary", running: "info", waiting_user: "warn", archived: "secondary",
  };
  return session.value ? (map[session.value.status] ?? "secondary") : "secondary";
});

// ─── Actions ──────────────────────────────────────────────────────────────────

async function onSend(text: string, engineText: string, _attachments: Attachment[]) {
  await chatStore.sendMessage(text, engineText, _attachments, selectedModelId.value);
}

function onEnqueue(text: string, engineText: string, attachments: Attachment[]) {
  if (!session.value) return;
  chatStore.enqueueMessage(session.value.id, {
    id: crypto.randomUUID(),
    text,
    engineText,
    attachments,
    addedAt: Date.now(),
  });
}

function onConfirmEdit(msgId: string, text: string, engineText: string, attachments: Attachment[]) {
  if (!session.value) return;
  chatStore.confirmEdit(session.value.id, msgId, text, engineText, attachments);
}

async function onCancel() {
  if (!session.value) return;
  try {
    await chatStore.cancelSession(session.value.id);
  } catch (err) {
    console.error("Failed to cancel session", err);
  }
}

async function archiveSession() {
  if (!session.value) return;
  await chatStore.archiveSession(session.value.id);
  drawerStore.close();
}

async function compactConversation() {
  if (!session.value) return;
  compacting.value = true;
  try {
    await api("chatSessions.compact", { sessionId: session.value.id });
  } catch (err) {
    toast.add({ severity: "error", summary: "Compact failed", detail: err instanceof Error ? err.message : String(err), life: 6000 });
  } finally {
    compacting.value = false;
  }
}
</script>

<style scoped>
.session-chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.scv-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px 6px;
  border-bottom: 1px solid var(--p-content-border-color);
  min-height: 48px;
}

.scv-header__left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.scv-header__title {
  font-weight: 600;
  font-size: 0.95rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
  border-bottom: 1px dashed transparent;
  transition: border-color 0.15s;
}

.scv-header__title:hover {
  border-bottom-color: var(--p-text-muted-color);
}

.scv-header__title-input {
  font-size: 0.95rem;
  font-weight: 600;
  min-width: 0;
  flex: 1;
}

.scv-header__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.scv-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
