import type { Database } from "bun:sqlite";
import type { TaskNote } from "../../shared/rpc-types.ts";
import { NoteRepository } from "../db/repositories/note-repository.ts";

export function noteHandlers(db: Database) {
  return {
    "notes.list": (params: { conversationId: number; tags?: string[] }): TaskNote[] => {
      const repo = new NoteRepository(db);
      return repo.listByConversation(params.conversationId, {
        tagFilter: params.tags,
      }) as TaskNote[];
    },

    "notes.create": (params: {
      conversationId: number;
      content: string;
      tags?: string[];
    }): TaskNote => {
      const repo = new NoteRepository(db);
      return repo.createNote(params.conversationId, {
        content: params.content,
        isSourceAi: false,
        tags: params.tags,
      }) as TaskNote;
    },

    "notes.update": (params: {
      id: number;
      content?: string;
      tags?: string[];
    }): TaskNote => {
      const repo = new NoteRepository(db);
      const note = repo.updateNote(params.id, {
        content: params.content,
        tags: params.tags,
      });
      if (!note) throw new Error(`Note #${params.id} not found`);
      return note as TaskNote;
    },

    "notes.delete": (params: { id: number }): void => {
      const repo = new NoteRepository(db);
      repo.deleteNote(params.id);
    },
  };
}
