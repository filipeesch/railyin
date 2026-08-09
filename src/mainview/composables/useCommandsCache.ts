import { ref, type Ref } from "vue";
import type { ToolsMenuItem } from "@copilotkit/vue/v2";
import { api } from "../rpc";

export interface CommandInfo {
  name: string;
  description?: string;
}

interface CacheEntry {
  commands: CommandInfo[];
  fetchedAt: number;
  revalidating: boolean;
}

/**
 * Command fetch scope — card scope ({ taskId }) or session scope
 * ({ workspaceKey }); `engine.listCommands` accepts both
 * (rpc-types.ts:991-994). The cache keys on a string discriminator so the two
 * paths coexist independently.
 */
export type CommandsScope = { taskId: number } | { workspaceKey: string };

const CACHE_TTL_MS = 30 * 60 * 1000;

const cache = new Map<string, CacheEntry>();
const commandRefs = new Map<string, Ref<CommandInfo[]>>();

function scopeKey(scope: CommandsScope): string {
  return "taskId" in scope ? `task:${scope.taskId}` : `ws:${scope.workspaceKey}`;
}

async function fetchCommands(scope: CommandsScope): Promise<CommandInfo[]> {
  try {
    return await api("engine.listCommands", scope);
  } catch {
    return [];
  }
}

function commandsEqual(a: CommandInfo[], b: CommandInfo[]): boolean {
  const key = (arr: CommandInfo[]) =>
    JSON.stringify([...arr].sort((x, y) => x.name.localeCompare(y.name)));
  return key(a) === key(b);
}

function getOrCreateRef(key: string): Ref<CommandInfo[]> {
  if (!commandRefs.has(key)) {
    commandRefs.set(key, ref(cache.get(key)?.commands ?? []));
  }
  return commandRefs.get(key)!;
}

function triggerBackgroundRefresh(key: string, scope: CommandsScope): void {
  const entry = cache.get(key);
  if (!entry) return;
  if (entry.revalidating) return;
  if (Date.now() - entry.fetchedAt < CACHE_TTL_MS) return;

  entry.revalidating = true;
  fetchCommands(scope)
    .then((fresh) => {
      entry.revalidating = false;
      entry.fetchedAt = Date.now();
      if (!commandsEqual(entry.commands, fresh)) {
        entry.commands = fresh;
        const r = commandRefs.get(key);
        if (r) r.value = fresh;
      }
    })
    .catch(() => {
      entry.revalidating = false;
    });
}

async function getCommandsForScope(scope: CommandsScope): Promise<CommandInfo[]> {
  const key = scopeKey(scope);
  const entry = cache.get(key);

  if (!entry) {
    const commands = await fetchCommands(scope);
    cache.set(key, { commands, fetchedAt: Date.now(), revalidating: false });
    const r = getOrCreateRef(key);
    r.value = commands;
    return commands;
  }

  triggerBackgroundRefresh(key, scope);
  return entry.commands;
}

function getCommandsRefForScope(scope: CommandsScope): Ref<CommandInfo[]> {
  return getOrCreateRef(scopeKey(scope));
}

function clearCommandsCacheForScope(scope: CommandsScope): void {
  const key = scopeKey(scope);
  cache.delete(key);
  commandRefs.delete(key);
}

// ─── Card scope (taskId) — existing consumers unchanged ──────────────────────

export async function getCommands(taskId: number): Promise<CommandInfo[]> {
  return getCommandsForScope({ taskId });
}

export function getCommandsRef(taskId: number): Ref<CommandInfo[]> {
  return getCommandsRefForScope({ taskId });
}

export function clearCommandsCache(taskId: number): void {
  clearCommandsCacheForScope({ taskId });
}

// ─── Session scope (workspaceKey) — new in 05-02 ─────────────────────────────

export async function getCommandsForWorkspace(workspaceKey: string): Promise<CommandInfo[]> {
  return getCommandsForScope({ workspaceKey });
}

export function getCommandsRefForWorkspace(workspaceKey: string): Ref<CommandInfo[]> {
  return getCommandsRefForScope({ workspaceKey });
}

export function clearCommandsCacheForWorkspace(workspaceKey: string): void {
  clearCommandsCacheForScope({ workspaceKey });
}

// ─── toolsMenu mapping (CHAT-06, D-07) ───────────────────────────────────────

/**
 * Map the server's command registry to CopilotChatInput toolsMenu items
 * (UI-SPEC chat-input zero-one-many row). Pure + DOM-free so it is
 * unit-testable: each command becomes `{ label: "/" + name, action }` where
 * the action inserts the slash text at the input caret via the caller-supplied
 * `insert` callback (a no-op when omitted). Zero commands → empty array
 * (the menu affordance is hidden).
 */
export function toToolsMenu(
  commands: CommandInfo[],
  insert?: (slashText: string) => void,
): ToolsMenuItem[] {
  return commands.map((c) => ({
    label: `/${c.name}`,
    action: () => insert?.(`/${c.name}`),
  }));
}
