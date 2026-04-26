<template>
  <div class="conversation-panel">
    <ConversationBody
      :messages="props.messages"
      :stream-state="props.streamState"
      :stream-version="props.streamVersion"
      :execution-state="props.executionState"
      :self-id="props.selfId"
      :has-more-before="props.hasMoreBefore"
      :is-loading-older="props.isLoadingOlder"
      @load-older="emit('load-older')"
    />
    <!-- Slim fallback input row — used when ConversationPanel is rendered standalone
         (e.g. future embeds). TaskChatView and SessionChatView use ConversationInput directly. -->
    <div class="conversation-panel__input">
      <div class="conversation-panel__input-row">
        <Textarea
          v-model="inputText"
          :placeholder="props.placeholder ?? 'Send a message… (Shift+Enter for newline)'"
          class="flex-1"
          rows="1"
          autoResize
          :disabled="props.disabled || props.executionState === 'running'"
          @keydown.enter.exact.prevent="doSend"
        />
        <Button
          v-if="props.executionState === 'running'"
          icon="pi pi-stop-circle"
          severity="warn"
          @click="emit('cancel')"
        />
        <Button
          v-else
          icon="pi pi-send"
          :disabled="!inputText.trim() || !!props.disabled"
          @click="doSend"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import ConversationBody from "./ConversationBody.vue";
import type { ConversationMessage } from "@shared/rpc-types";
import type { ConversationStreamState } from "../stores/conversation";

const props = defineProps<{
  messages: ConversationMessage[];
  streamState?: ConversationStreamState | null;
  streamVersion?: number;
  executionState: string;
  disabled?: boolean;
  placeholder?: string;
  selfId?: number | null;
  hasMoreBefore?: boolean;
  isLoadingOlder?: boolean;
}>();

const emit = defineEmits<{
  send: [text: string];
  cancel: [];
  "load-older": [];
}>();

const inputText = ref("");

function doSend() {
  const text = inputText.value.trim();
  if (!text) return;
  inputText.value = "";
  emit("send", text);
}
</script>

<style scoped>
.conversation-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.conversation-panel__input {
  border-top: 1px solid var(--p-content-border-color);
  padding: 8px;
}

.conversation-panel__input-row {
  display: flex;
  align-items: flex-end;
  gap: 4px;
}
</style>
