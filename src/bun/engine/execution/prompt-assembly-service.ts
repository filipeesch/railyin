import type { LoadedConfig } from "../../config/index.ts";
import { SystemPromptAssembler } from "./system-prompt-assembler.ts";
import { CustomPromptInjector, type PromptFilterContext } from "./custom-prompt-injector.ts";
import { StageInstructionsInjector } from "../../conversation/stage-instructions-injector.ts";

export interface PromptAssemblyParams {
  config: LoadedConfig;
  boardId: number;
  columnId: string;
  conversationId: number;
  promptFilter: PromptFilterContext;
  /**
   * true for column-transition executions (TransitionExecutor) — always injects
   * the new column's stage_instructions. false for ordinary turns (HumanTurnExecutor,
   * RetryExecutor, CodeReviewExecutor) — only re-injects per the compaction-based policy.
   */
  isTransition: boolean;
}

export interface PromptAssemblyResult {
  systemInstructions: string | undefined;
  stageInstructionsBlock: string | undefined;
}

/**
 * Single shared collaborator that assembles systemInstructions (workflow_instructions
 * + custom prompts only — never stage_instructions) and the stageInstructionsBlock for
 * userContent, replacing the duplicated inline SystemPromptAssembler/addCustomPrompts/
 * assemble() pattern previously repeated across all 5 executor call sites.
 */
export class PromptAssemblyService {
  constructor(
    private readonly customPromptInjector: CustomPromptInjector,
    private readonly stageInstructionsInjector: StageInstructionsInjector,
  ) {}

  assemble(params: PromptAssemblyParams): PromptAssemblyResult {
    const { config, boardId, columnId, conversationId, promptFilter, isTransition } = params;

    const assembler = SystemPromptAssembler.fromConfig(config, boardId, columnId);
    assembler.addCustomPrompts(this.customPromptInjector, promptFilter);
    const systemInstructions = assembler.assemble();

    const stageInstructions = SystemPromptAssembler.getStageInstructions(config, boardId, columnId);
    const { stageInstructionsBlock } = this.stageInstructionsInjector.prepare(conversationId, stageInstructions, isTransition);

    return { systemInstructions, stageInstructionsBlock };
  }
}
