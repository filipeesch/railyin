import type { Database } from "bun:sqlite";

export const id = "051_conversation_model_params";

export function up(db: Database): void {
  db.exec("ALTER TABLE conversations ADD COLUMN model_params TEXT NULL");
  // Migrate existing reasoning_mode_override values to model_params JSON format
  db.exec(`
    UPDATE conversations
    SET model_params = json_array(json_object('id', 'effort', 'value', reasoning_mode_override))
    WHERE reasoning_mode_override IS NOT NULL
  `);
  db.exec("ALTER TABLE conversations DROP COLUMN reasoning_mode_override");
}
