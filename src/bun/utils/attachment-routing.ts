import type { Attachment } from "../../shared/rpc-types";
import { resolveFileAttachments } from "./resolve-file-attachments";

export type PreparedMessageForEngine = {
    content: string;
    attachments: Attachment[];
};

const isFileReferenceAttachment = (attachment: Attachment): boolean =>
    attachment.mediaType === "text/plain" && attachment.data.startsWith("@file:");

export async function prepareMessageForEngine(
    engine: string,
    content: string,
    attachments: Attachment[] | undefined,
): Promise<PreparedMessageForEngine> {
    const normalizedAttachments = attachments ?? [];
    if (engine !== "copilot") {
        return {
            content: await resolveFileAttachments(content, normalizedAttachments),
            attachments: normalizedAttachments.filter((attachment) => !isFileReferenceAttachment(attachment)),
        };
    }

    return { content, attachments: normalizedAttachments };
}
