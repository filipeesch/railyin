/**
 * Format instruction blocks for injection into the Pi engine system prompt.
 */

import type { Instruction } from "../dialects/instruction-scanner.ts";

/**
 * Format an array of Instruction objects into markdown blocks.
 *
 * Each instruction is formatted as:
 * ```
 * ### name
 *
 * **description**
 *
 * content (if autoApply is true)
 * ```
 *
 * Blocks are joined with double newlines.
 *
 * @param instructions - Array of Instruction objects.
 * @returns Formatted markdown string or undefined if empty.
 */
export function formatInstructionBlocks(instructions: Instruction[]): string | undefined {
  if (instructions.length === 0) {
    return undefined;
  }

  const blocks = instructions.map((inst) => {
    const parts = [
      `### ${inst.name}`,
      "",
      `**${inst.description}**`,
    ];

    if (inst.content !== undefined) {
      parts.push("", inst.content);
    }

    return parts.join("\n");
  });

  return blocks.join("\n\n");
}
