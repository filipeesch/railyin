/**
 * legacy-import.ts — on-demand legacy import RPC (IMPR-01, D-06).
 *
 * `legacyImport.run` converts frozen `conversation_messages` rows into
 * per-thread JSONL logs (threadId = conversations.id) and returns an
 * ImportSummary. Thin delegation to runLegacyImport — the conversations.ts
 * "handler delegates to module fn" pattern (the stream-events feed
 * precedent). SELECT-only w.r.t. legacy tables (IMPR-02, D-08); idempotent
 * via the store's existence marker (D-07).
 */
import type { Database } from "bun:sqlite";
import type { ImportSummary } from "../../shared/rpc-types.ts";
import type { JsonlStore } from "../copilotkit/jsonl-store.ts";
import { runLegacyImport } from "../copilotkit/import.ts";

export function legacyImportHandlers(db: Database, store: JsonlStore) {
    return {
        "legacyImport.run": async (): Promise<ImportSummary> => runLegacyImport(db, store),
    };
}
