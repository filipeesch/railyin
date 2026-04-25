<template>
  <div v-if="hasAny" class="launch-buttons">
    <!-- Card mode: SplitButton per section, icon-only, tools first -->
    <template v-if="cardMode">
      <template v-for="section in sections" :key="section.type">
        <template v-if="section.entries.length === 1">
          <Button
            size="small"
            severity="secondary"
            text
            :title="section.entries[0].label"
            class="launch-icon-btn"
            @click.stop="emit('run', section.entries[0].command, section.type === 'tools' ? 'app' : 'terminal')"
          >
            <template #default>
              <LaunchIcon :icon="section.entries[0].icon" :size="12" />
            </template>
          </Button>
        </template>
        <template v-else-if="section.entries.length > 1">
          <SplitButton
            :model="menuItems(section)"
            size="small"
            severity="secondary"
            :title="section.entries[0].label"
            class="launch-icon-splitbtn launch-splitbtn"
            @click.stop="emit('run', section.entries[0].command, section.type === 'tools' ? 'app' : 'terminal')"
          >
            <template #default>
              <LaunchIcon :icon="section.entries[0].icon" :size="12" />
            </template>
          </SplitButton>
        </template>
      </template>
    </template>

    <!-- Full mode (drawer): SplitButton with labels -->
    <template v-else>
      <template v-for="section in sections" :key="section.type">
        <template v-if="section.entries.length === 1">
          <Button
            size="small"
            severity="secondary"
            :title="section.entries[0].label"
            @click="emit('run', section.entries[0].command, section.type === 'tools' ? 'app' : 'terminal')"
          >
            <template #default>
              <LaunchIcon :icon="section.entries[0].icon" />
              <span v-if="section.entries[0].label" class="p-button-label">{{ section.entries[0].label }}</span>
            </template>
          </Button>
        </template>
        <template v-else-if="section.entries.length > 1">
          <SplitButton
            :model="menuItems(section)"
            size="small"
            severity="secondary"
            :title="section.entries[0].label"
            class="launch-splitbtn"
            @click="emit('run', section.entries[0].command, section.type === 'tools' ? 'app' : 'terminal')"
          >
            <template #default>
              <LaunchIcon :icon="section.entries[0].icon" />
              <span v-if="section.entries[0].label" class="p-button-label">{{ section.entries[0].label }}</span>
            </template>
            <template #item="{ item: mi }">
              <div class="launch-menu-item">
                <LaunchIcon :icon="(mi as any)._icon" :size="14" />
                <span>{{ mi.label }}</span>
              </div>
            </template>
          </SplitButton>
        </template>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h } from "vue";
import Button from "primevue/button";
import SplitButton from "primevue/splitbutton";
import { Icon } from "@iconify/vue";
import type { LaunchEntry } from "@shared/rpc-types";

const props = defineProps<{
  profiles: LaunchEntry[];
  tools: LaunchEntry[];
  cardMode?: boolean;
}>();

const emit = defineEmits<{ run: [command: string, mode: "terminal" | "app"] }>();

const hasAny = computed(() => props.profiles.length > 0 || props.tools.length > 0);

type Section = { type: "profiles" | "tools"; entries: LaunchEntry[] };

const sections = computed<Section[]>(() =>
  props.cardMode
    ? [
        { type: "tools", entries: props.tools },
        { type: "profiles", entries: props.profiles },
      ]
    : [
        { type: "profiles", entries: props.profiles },
        { type: "tools", entries: props.tools },
      ]
);

function menuItems(section: Section) {
  const mode = section.type === "tools" ? "app" : "terminal";
  return section.entries.slice(1).map((e) => ({
    label: e.label ?? e.icon,
    _icon: e.icon,
    command: () => emit("run", e.command, mode),
  }));
}

function iconType(icon: string): "primevue" | "iconify" | "text" {
  if (icon.startsWith("pi-")) return "primevue";
  if (icon.includes(":")) return "iconify";
  return "text";
}

// Render the correct icon element
const LaunchIcon = defineComponent({
  props: { icon: { type: String, required: true }, size: { type: Number, default: 16 } },
  setup(p) {
    return () => {
      const type = iconType(p.icon);
      if (type === "primevue") return h("i", { class: `pi ${p.icon}`, style: `font-size:${p.size}px` });
      if (type === "iconify") return h(Icon, { icon: p.icon, width: p.size, height: p.size });
      return h("span", { class: "launch-text-icon", style: `font-size:${p.size}px` }, p.icon);
    };
  },
});


</script>

<style scoped>
.launch-buttons {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 2px;
  overflow: hidden;
}

.launch-icon-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  min-width: unset;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* SplitButton in card mode: hide label, keep icon + dropdown arrow compact */
:deep(.launch-icon-splitbtn .p-splitbutton-button) {
  padding: 0 4px;
  min-width: unset;
}

:deep(.launch-icon-splitbtn .p-splitbutton-dropdown) {
  padding: 0 2px;
  min-width: unset;
  width: 16px;
}

:deep(.launch-icon-splitbtn .p-splitbutton-dropdown svg) {
  width: 10px;
  height: 10px;
}

.launch-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
}

.launch-text-icon {
  font-size: 0.95em;
}
</style>
