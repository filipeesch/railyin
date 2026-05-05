import type { Attachment } from "../../../shared/rpc-types.ts";
import type { FilePartInput } from "@opencode-ai/sdk/v2";
import { parseFileRef } from "../../utils/resolve-file-attachments.ts";
import { readFileSync } from "fs";
import { isAbsolute, join } from "path";

/**
 * Map Railyin attachments to OpenCode FilePartInput format.
 * File references (@file:path) are read from disk and embedded as text.
 * Binary/image attachments are passed via base64 data URL.
 * Text attachments are returned as extra text to be appended to the prompt.
 */
export function mapAttachments(
  attachments: Attachment[],
  workingDirectory?: string,
): {
  fileParts: FilePartInput[];
  extraText: string;
} {
  const fileParts: FilePartInput[] = [];
  const textParts: string[] = [];

  for (const attachment of attachments) {
    const fileRef = parseFileRef(attachment.data);
    if (fileRef) {
      const absPath =
        workingDirectory && !isAbsolute(fileRef.path)
          ? join(workingDirectory, fileRef.path)
          : fileRef.path;
      try {
        const raw = readFileSync(absPath, "utf8");
        let text: string;
        if (fileRef.startLine !== undefined && fileRef.endLine !== undefined) {
          const lines = raw.split("\n");
          text = lines.slice(fileRef.startLine - 1, fileRef.endLine).join("\n");
        } else {
          text = raw;
        }
        textParts.push(`<attachment name="${attachment.label}">\n${text}\n</attachment>`);
      } catch {
        // If file can't be read, skip it
      }
      continue;
    }

    const isText = attachment.mediaType.startsWith("text/");
    if (isText) {
      const text = Buffer.from(attachment.data, "base64").toString("utf8");
      textParts.push(`<attachment name="${attachment.label}">\n${text}\n</attachment>`);
    } else {
      // Binary (image etc.) — pass as file part with data URL
      fileParts.push({
        type: "file",
        mime: attachment.mediaType,
        filename: attachment.label,
        url: `data:${attachment.mediaType};base64,${attachment.data}`,
      });
    }
  }

  return { fileParts, extraText: textParts.join("\n") };
}
