import type { Attachment } from "../../../shared/rpc-types.ts";
import type { FilePartInput } from "@opencode-ai/sdk/v2";

/**
 * Map Railyin attachments to OpenCode FilePartInput format.
 * Only image attachments are supported as file parts; text attachments are
 * returned as a separate string to be appended to the prompt.
 */
export function mapAttachments(attachments: Attachment[]): {
  fileParts: FilePartInput[];
  extraText: string;
} {
  const fileParts: FilePartInput[] = [];
  const textParts: string[] = [];

  for (const attachment of attachments) {
    if (attachment.type === "image" && attachment.url) {
      fileParts.push({
        type: "file",
        mime: attachment.mimeType ?? "image/png",
        filename: attachment.name ?? undefined,
        url: attachment.url,
      });
    } else if (attachment.type === "text" && attachment.content) {
      textParts.push(`<attachment name="${attachment.name ?? "file"}">\n${attachment.content}\n</attachment>`);
    }
  }

  return { fileParts, extraText: textParts.join("\n") };
}
