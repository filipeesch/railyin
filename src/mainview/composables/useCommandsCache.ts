import { ref, type Ref } from "vue";
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

const CACHE_TTL_MS = 30 * 60 * 1000;

const cache = new Map<number, CacheEntry>();
const commandRefs = new Map<number, Ref<CommandInfo[]>>();

async function fetchCommands(taskId: number): Promise<CommandInfo[]> {
  try {
    return await api("engine.listCommands", { taskId });
  } catch {
    return [];
  }
}

function commandsEqual(a: CommandInfo[], b: CommandInfo[]): boolean {
  const key = (arr: CommandInfo[]) =>
    JSON.stringify([...arr].sort((x, y) => x.name.localeCompare(y.name)));
  return key(a) === key(b);
}

function getOrCreateRef(taskId: number): Ref<CommandInfo[]> {
  if (!commandRefs.has(taskId)) {
    commandRefs.set(taskId, ref(cache.get(taskId)?.commands ?? []));
  }
  return commandRefs.get(taskId)!;
}

function triggerBackgroundRefresh(taskId: number): void {
  const entry = cache.get(taskId);
  if (!entry) return;
  if (entry.revalidating) return;
  if (Date.now() - entry.fetchedAt < CACHE_TTL_MS) return;

  entry.revalidating = true;
  fetchCommands(taskId)
    .then((fresh) => {
      entry.revalidating = false;
      entry.fetchedAt = Date.now();
      if (!commandsEqual(entry.commands, fresh)) {
        entry.commands = fresh;
        const r = commandRefs.get(taskId);
        if (r) r.value = fresh;
      }
    })
    .catch(() => {
      entry.revalidating = false;
    });
}

export async function getCommands(taskId: number): Promise<CommandInfo[]> {
  const entry = cache.get(taskId);

  if (!entry) {
    const commands = await fetchCommands(taskId);
    cache.set(taskId, { commands, fetchedAt: Date.now(), revalidating: false });
    const r = getOrCreateRef(taskId);
    r.value = commands;
    return commands;
  }

  triggerBackgroundRefresh(taskId);
  return entry.commands;
}

export function getCommandsRef(taskId: number): Ref<CommandInfo[]> {
  return getOrCreateRef(taskId);
}

export function clearCommandsCache(taskId: number): void {
  cache.delete(taskId);
  commandRefs.delete(taskId);
}
