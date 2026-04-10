import { join } from "path";
import { getConfigDir } from "../config/index.ts";
import { detectLanguages, probeInstalled } from "../lsp/detect.ts";
import { runInstall } from "../lsp/installer.ts";
import { addServerToConfig } from "../lsp/config-writer.ts";
import { LANGUAGE_REGISTRY } from "../lsp/registry.ts";
import type { LanguageEntry, InstallOption } from "../lsp/registry.ts";

export interface DetectedLanguage {
  entry: LanguageEntry;
  alreadyInstalled: boolean;
  installOptions: InstallOption[];
}

export function lspHandlers() {
  return {
    "lsp.detectLanguages": async (params: { projectPath: string }): Promise<DetectedLanguage[]> => {
      const entries = detectLanguages(params.projectPath);
      return entries.map((entry) => ({
        entry,
        alreadyInstalled: probeInstalled(entry.serverName),
        installOptions: entry.installOptions, // already platform-filtered by detectLanguages
      }));
    },

    "lsp.addToConfig": async (params: { projectPath: string; languageServerName: string }): Promise<{ ok: boolean }> => {
      const entry = LANGUAGE_REGISTRY.find((e) => e.serverName === params.languageServerName);
      if (!entry) return { ok: false };

      const workspaceYamlPath = join(getConfigDir(), "workspace.yaml");
      try {
        addServerToConfig(workspaceYamlPath, entry);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },

    "lsp.runInstall": async (params: { command: string; projectPath: string }): Promise<{ success: boolean; output: string }> => {
      // Collect full output (streaming is done via the installer generator)
      const gen = runInstall(params.command, params.projectPath);
      const lines: string[] = [];
      let result = await gen.next();
      while (!result.done) {
        lines.push(result.value as string);
        result = await gen.next();
      }
      const { success, output } = result.value as { success: boolean; output: string };

      // Auto-write config on successful install
      if (success) {
        const entry = LANGUAGE_REGISTRY.find((e) =>
          e.installOptions.some((o) => o.command === params.command),
        );
        if (entry) {
          const workspaceYamlPath = join(getConfigDir(), "workspace.yaml");
          try { addServerToConfig(workspaceYamlPath, entry); } catch { /* best effort */ }
        }
      }

      return { success, output };
    },
  };
}
