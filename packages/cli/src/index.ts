import { Command } from "commander";
import { registerAgentCommands } from "./commands/agent.js";
import { registerConfigCommands } from "./commands/config.js";
import { registerMarketplaceCommands } from "./commands/marketplace.js";
import { registerTriggerCommands } from "./commands/triggers.js";
import { registerUiCommands } from "./commands/ui.js";

const program = new Command();

program
  .name("solix")
  .description("SolixAI — agentic platform CLI")
  .version("0.1.0");

registerAgentCommands(program);
registerConfigCommands(program);
registerMarketplaceCommands(program);
registerTriggerCommands(program);
registerUiCommands(program);

program.parse();
