import type { Database } from "bun:sqlite";
import type { TaskNote } from "../../shared/rpc-types.ts";
import { NoteRepository } from "../db/repositories/note-repository.ts";

export function noteHandlers(db: Database) {
  return {
    "notes.list": (params: { conversationId: number }): TaskNote[] => {
      const repo = new NoteRepository(db);
      return repo.listByConversation(params.conversationId) as TaskNote[];
    },

    "notes.create": (params: {
      conversationId: number;
      title?: string | null;
      content: string;
    }): TaskNote => {
      const repo = new NoteRepository(db);
      return repo.createNote(params.conversationId, {
        title: params.title,
        content: params.content,
        isSourceAi: false,
      }) as TaskNote;
    },

    "notes.update": (params: {
      id: number;
      title?: string | null;
      content?: string;
    }): TaskNote => {
      const repo = new NoteRepository(db);
      const note = repo.updateNote(params.id, {
        title: params.title,
        content: params.content,
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
