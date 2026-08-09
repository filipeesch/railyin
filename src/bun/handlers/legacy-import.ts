/**
 * legacy-import.ts — on-demand legacy import RPC (IMPR-01, D-06).
 *
 * `legacyImport.run` converts frozen `conversation_messages` rows into
 * per-thread JSONL logs (threadId = conversations.id) and returns an
 * ImportSummary. Thin delegation to runLegacyImport — the conversations.ts
 * "handler delegates to module fn" pattern. SELECT-only w.r.t. legacy tables
 * (IMPR-02, D-08); idempotent via the store's existence marker.
 *
 * D-06 retirement gate: `legacyImport.run` is registered ONLY when the
 * `enabled` flag (server-side `RAILYN_LEGACY_IMPORT=1`, index.ts) is set —
 * otherwise the RPC is absent (404 over the wire, never an erroring handler).
 * `legacyImport.enabled` is ALWAYS registered: it is the type-safe visibility
 * channel ChatThreadSidebar uses to hide the import button when retired.
 * The import module + its reads stay available for a future migration.
 */
import type { Database } from "bun:sqlite";
import type { ImportSummary } from "../../shared/rpc-types.ts";
import type { JsonlStore } from "../copilotkit/jsonl-store.ts";
import { runLegacyImport } from "../copilotkit/import.ts";

export function legacyImportHandlers(db: Database, store: JsonlStore, enabled: boolean) {
    return {
        "legacyImport.enabled": (): { enabled: boolean } => ({ enabled }),
        ...(enabled
            ? { "legacyImport.run": async (): Promise<ImportSummary> => runLegacyImport(db, store) }
            : {}),
    };
}
