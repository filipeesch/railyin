import type { Db } from "../db/db.ts";
import type { TaskNote } from "../../shared/rpc-types.ts";
import { NoteRepository } from "../db/repositories/note-repository.ts";

export function noteHandlers(db: Db) {
  return {
    "notes.list": async (params: { conversationId: number; tags?: string[] }): Promise<TaskNote[]> => {
      const repo = new NoteRepository(db);
      return (await repo.listByConversation(params.conversationId, {
        tagFilter: params.tags,
      })) as TaskNote[];
    },

    "notes.create": async (params: {
      conversationId: number;
      content: string;
      tags?: string[];
    }): Promise<TaskNote> => {
      const repo = new NoteRepository(db);
      return (await repo.createNote(params.conversationId, {
        content: params.content,
        isSourceAi: false,
        tags: params.tags,
      })) as TaskNote;
    },

    "notes.update": async (params: {
      id: number;
      content?: string;
      tags?: string[];
    }): Promise<TaskNote> => {
      const repo = new NoteRepository(db);
      const note = await repo.updateNote(params.id, {
        content: params.content,
        tags: params.tags,
      });
      if (!note) throw new Error(`Note #${params.id} not found`);
      return note as TaskNote;
    },

    "notes.delete": async (params: { id: number }): Promise<void> => {
      const repo = new NoteRepository(db);
      await repo.deleteNote(params.id);
    },
  };
}
