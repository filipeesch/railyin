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

    <!-- Tab switcher (shown after loading) -->
    <div v-else-if="session" class="scv-tabs">
      <button :class="['scv-tab-btn', { 'scv-tab-btn--active': activeTab === 'chat' }]" @click="activeTab = 'chat'">
        <i class="pi pi-comments" /> Chat
      </button>
      <button :class="['scv-tab-btn', { 'scv-tab-btn--active': activeTab === 'decisions' }]" @click="activeTab = 'decisions'">
        <i class="pi pi-list-check" /> Decisions
      </button>
      <button :class="['scv-tab-btn', { 'scv-tab-btn--active': activeTab === 'notes' }]" @click="activeTab = 'notes'">
        <i class="pi pi-file-edit" /> Notes
      </button>
    </div>

    <!-- Body: conversation (CopilotKit surface — RailyinChat owns the thread
         connect/replay; scv-loading covers the legacy pre-connect phase) -->
    <RailyinChat
      v-if="session && !conversationStore.messagesLoading && activeTab === 'chat'"
      :thread-id="String(session.conversationId)"
      :title="session.title"
      :commands-scope="{ workspaceKey: session.workspaceKey }"
    />

    <!-- Decisions panel -->
    <DecisionsPanel
      v-if="session && !conversationStore.messagesLoading && activeTab === 'decisions' && session.conversationId"
      :conversation-id="session.conversationId"
    />

    <!-- Notes panel -->
    <NotesPanel
      v-if="session && !conversationStore.messagesLoading && activeTab === 'notes' && session.conversationId"
      :conversation-id="session.conversationId"
      :refresh-trigger="notesRefreshTrigger"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from "vue";
import Tag from "primevue/tag";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import ProgressSpinner from "primevue/progressspinner";
import { useToast } from "primevue/usetoast";
import RailyinChat from "./chat/RailyinChat.vue";
import DecisionsPanel from "./DecisionsPanel.vue";
import NotesPanel from "./NotesPanel.vue";
import { useChatStore } from "../stores/chat";
import { useDrawerStore } from "../stores/drawer";
import { useConversationStore } from "../stores/conversation";

const props = defineProps<{
  sessionId: number;
}>();

const chatStore = useChatStore();
const drawerStore = useDrawerStore();
const conversationStore = useConversationStore();
const toast = useToast();

const session = computed(() => chatStore.activeSession);

const activeTab = ref<"chat" | "decisions" | "notes">("chat");
const notesRefreshTrigger = ref(0);

// Refresh notes when session status changes from running to non-running
watch(
  () => session.value?.status,
  (status, prevStatus) => {
    if (prevStatus === "running" && status !== "running") {
      notesRefreshTrigger.value++;
    }
  },
);

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
    // IN-06: use the same access path as ChatThreadSidebar (chatStore) —
    // the direct api() call bypassed the store and failed silently.
    await chatStore.renameSession(session.value.id, newTitle);
  } catch (err) {
    toast.add({
      severity: "error",
      summary: "Rename failed",
      detail: err instanceof Error ? err.message : String(err),
      life: 6000,
    });
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

async function archiveSession() {
  if (!session.value) return;
  await chatStore.archiveSession(session.value.id);
  drawerStore.close();
}

// The drawer may still call the legacy scroll API on SessionChatView — safe
// no-ops now that the Chat tab is CopilotKit-owned (RailyinChat auto-scrolls).
defineExpose({
  scrollToBottom: () => {},
  scheduleScrollToBottomIfAuto: () => {},
});
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

.scv-tabs {
  display: flex;
  gap: 2px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--p-content-border-color);
  flex-shrink: 0;
}

.scv-tab-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.82rem;
  color: var(--p-text-muted-color);
  transition: background 0.15s, color 0.15s;
}

.scv-tab-btn:hover {
  background: var(--p-content-hover-background);
  color: var(--p-text-color);
}

.scv-tab-btn--active {
  background: var(--p-highlight-background);
  color: var(--p-highlight-color);
  font-weight: 600;
}
</style>
