import type { ElectrobunConfig } from "electrobun";
import { resolve } from "path";

// Bake the repo's config/ path into dev builds so the bun process can find
// workspace.yaml regardless of the Electrobun working directory.
// In canary/stable builds this path won't exist on the user's machine so
// existsSync() will return false and the loader falls back to ~/.railyn/config/.
const bunDefines: Record<string, string> = {
  __RAILYN_DEV_CONFIG_DIR__: JSON.stringify(resolve("config")),
};

export default {
  app: {
    name: "Railyn",
    identifier: "dev.railyn.app",
    version: "0.1.0",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
      define: bunDefines,
    },
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
    },
    watchIgnore: ["dist/**"],
    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
