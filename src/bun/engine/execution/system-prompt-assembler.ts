import type { LoadedConfig } from "../../config/index.ts";
import { getWorkflowTemplate } from "../../workflow/column-config.ts";
import { CustomPromptInjector, type PromptFilterContext } from "./custom-prompt-injector.ts";

/** Ordered part of the system prompt. */
export interface SystemPromptPart {
  content: string;
  order: number;
  source: "custom" | "workflow" | "stage";
}

/**
 * Internal: builds system instructions from multiple ordered sources.
 */
export class SystemPromptAssembler {
  private parts: SystemPromptPart[] = [];

  addPart(content: string, order: number, source: SystemPromptPart["source"]): void {
    if (!content) return;
    this.parts.push({ content, order, source });
  }

  /**
   * Join all parts by order, return joined string or `undefined` if empty.
   */
  assemble(): string | undefined {
    const joined = this.parts
      .sort((a, b) => a.order - b.order)
      .filter(p => p.content.trim())
      .map(p => p.content);

    return joined.length > 0 ? joined.join("\n\n") : undefined;
  }

  /**
   * Load workflow_instructions (order 100) and stage_instructions (order 200)
   * from config into this assembler.
   */
  static fromConfig(config: LoadedConfig, boardId: number, columnId: string): SystemPromptAssembler {
    const template = getWorkflowTemplate(config, boardId);
    const column = template?.columns.find((c) => c.id === columnId);
    const assembler = new SystemPromptAssembler();

    if (template?.workflow_instructions) {
      assembler.addPart(template.workflow_instructions, 100, "workflow");
    }

    if (column?.stage_instructions) {
      assembler.addPart(column.stage_instructions, 200, "stage");
    }

    return assembler;
  }

  /**
   * Add custom prompt content as parts. Resolves from injector, sorts by priority,
   * assigns order 0–99 (sorted by int priority), so custom prompts appear FIRST.
   */
  addCustomPrompts(injector: CustomPromptInjector, filter: PromptFilterContext): void {
    const resolved = injector.resolveList(filter);

    resolved.forEach((p, i) => {
      this.addPart(p.content, p.priority, "custom");
    });
  }
}
