import { getGlobalConfigDir, invalidateConfigCache } from "../config/index.ts";
import { join } from "path";
import { readFileSync, writeFileSync } from "fs";
import * as jsYaml from "js-yaml";

export function configHandlers() {
  return {
    "config.getEnginesYaml": (_: unknown) => {
      const file = join(getGlobalConfigDir(), "engines.yaml");
      const yaml = readFileSync(file, "utf-8");
      return { yaml };
    },

    "config.saveEnginesYaml": ({ yaml }: { yaml: string }) => {
      jsYaml.load(yaml);
      const file = join(getGlobalConfigDir(), "engines.yaml");
      writeFileSync(file, yaml, "utf-8");
      invalidateConfigCache();
      return { ok: true as const };
    },
  };
}
