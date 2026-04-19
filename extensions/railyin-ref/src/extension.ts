import * as vscode from "vscode";
import * as http from "http";

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("Railyin");
  context.subscriptions.push(outputChannel);

  context.subscriptions.push(
    vscode.commands.registerCommand("railyin.sendRef", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const sel = editor.selection;
      if (sel.isEmpty) {
        vscode.window.showWarningMessage("Railyin: No text selected.");
        return;
      }

      const text = editor.document.getText(sel);
      const file = editor.document.uri.fsPath;
      const language = editor.document.languageId;
      const taskId = Number(process.env.RAILYIN_TASK_ID ?? "0");
      const apiPort = process.env.RAILYIN_API_PORT ?? "3000";

      const payload = JSON.stringify({
        taskId,
        file,
        startLine: sel.start.line + 1,
        startChar: sel.start.character + 1,
        endLine: sel.end.line + 1,
        endChar: sel.end.character + 1,
        text,
        language,
      });

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: Number(apiPort),
          path: "/api/codeServer.sendRef",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            outputChannel.appendLine(`[railyin] sendRef failed: HTTP ${res.statusCode}`);
          }
        },
      );

      req.on("error", (err) => {
        outputChannel.appendLine(`[railyin] sendRef error: ${err.message}`);
      });

      req.write(payload);
      req.end();
    }),
  );
}

export function deactivate(): void {
  // nothing to clean up
}
