import type {
  TriggerEvent,
  PipelineConfig,
  PipelineResult,
  PipelineStep,
} from "../../types/index.js";
import { resolveConfig } from "../config/configResolver.js";
import { loadAgentConfig } from "../agents/agentManager.js";
import { injectSoul } from "../soul/soulInjector.js";
import { callProvider } from "../providers/providerRouter.js";
import { getSkill } from "../skills/skillLoader.js";
import { getTool } from "../tools/toolLoader.js";

/**
 * Run a triggered pipeline: when an event occurs, execute a series of
 * pre-configured steps (skills + tools) in order.
 */
export async function runTriggeredPipeline(
  agentName: string,
  event: TriggerEvent,
  pipelineConfig: PipelineConfig,
): Promise<PipelineResult> {
  const config = await resolveConfig(agentName);
  const agentCfg = await loadAgentConfig(agentName);

  const providerId = agentCfg.provider ?? config.defaultProvider ?? "openai";
  const model = agentCfg.model ?? config.defaultModel ?? "gpt-4o";

  const steps: PipelineStep[] = [];
  let lastOutput: unknown = event.payload;

  for (let i = 0; i < pipelineConfig.steps.length; i++) {
    const stepCfg = pipelineConfig.steps[i]!;

    if (stepCfg.skill) {
      // Use the skill as a prompt, call the LLM.
      const skill = await getSkill(stepCfg.skill);
      if (!skill) {
        throw new Error(`Skill "${stepCfg.skill}" not found.`);
      }

      let messages = await injectSoul(agentName, [
        { role: "system", content: skill.body },
        { role: "user", content: JSON.stringify(lastOutput) },
      ]);

      const result = await callProvider(providerId, { model, messages });
      lastOutput = result.output;

      steps.push({
        index: i,
        action: `skill:${stepCfg.skill}`,
        input: stepCfg.input ?? event.payload,
        output: result.output,
        timestamp: Date.now(),
      });
    } else if (stepCfg.tool) {
      // Execute a tool directly.
      const tool = await getTool(stepCfg.tool);
      if (!tool) {
        throw new Error(`Tool "${stepCfg.tool}" not found.`);
      }

      const toolOutput = await tool.run({
        input: stepCfg.input ?? lastOutput,
        context: { event, agentName },
      });
      lastOutput = toolOutput;

      steps.push({
        index: i,
        action: `tool:${stepCfg.tool}`,
        input: stepCfg.input ?? event.payload,
        output: toolOutput,
        timestamp: Date.now(),
      });
    }
  }

  return {
    agentName,
    steps,
    finalOutput: typeof lastOutput === "string" ? lastOutput : JSON.stringify(lastOutput),
    aborted: false,
  };
}
