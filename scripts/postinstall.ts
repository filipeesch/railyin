import { existsSync } from "fs";
import { join } from "path";

const platform = process.platform;

// Run code-server's own postinstall on non-Windows platforms
if (platform !== "win32") {
  const codeServerDir = join(import.meta.dir, "../node_modules/code-server");
  const postinstallScript = join(codeServerDir, "postinstall.sh");
  if (existsSync(postinstallScript)) {
    console.log("[postinstall] Running code-server postinstall...");
    const proc = Bun.spawn(["sh", "./postinstall.sh"], {
      cwd: codeServerDir,
      env: {
        ...process.env,
        FORCE_NODE_VERSION: "20",
        npm_config_user_agent: "npm/10 node/v20.0.0 darwin arm64",
      },
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) {
      console.warn(`[postinstall] code-server postinstall exited with code ${code} (non-fatal)`);
    }
  }
} else {
  console.log("[postinstall] Windows: skipping code-server postinstall");
}
