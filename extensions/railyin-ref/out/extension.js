"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const http = __importStar(require("http"));
function activate(context) {
    const outputChannel = vscode.window.createOutputChannel("Railyin");
    context.subscriptions.push(outputChannel);
    context.subscriptions.push(vscode.commands.registerCommand("railyin.sendRef", () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
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
        const req = http.request({
            hostname: "127.0.0.1",
            port: Number(apiPort),
            path: "/api/codeServer.sendRef",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
            },
        }, (res) => {
            if (res.statusCode !== 200) {
                outputChannel.appendLine(`[railyin] sendRef failed: HTTP ${res.statusCode}`);
            }
        });
        req.on("error", (err) => {
            outputChannel.appendLine(`[railyin] sendRef error: ${err.message}`);
        });
        req.write(payload);
        req.end();
    }));
}
function deactivate() {
    // nothing to clean up
}
//# sourceMappingURL=extension.js.map