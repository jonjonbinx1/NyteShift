import { Command } from "commander";
import { registerAgentCommands } from "./commands/agent.js";
import { registerChannelCommands } from "./commands/channels.js";
import { registerConfigCommands } from "./commands/config.js";
import { registerMarketplaceCommands } from "./commands/marketplace.js";
import { registerSecretCommands } from "./commands/secret.js";
import { registerTriggerCommands } from "./commands/triggers.js";
import { registerUiCommands } from "./commands/ui.js";

const program = new Command();

program
  .name("nyteshift")
  .description("NyteShift — agentic platform CLI")
  .version("0.1.0");

registerAgentCommands(program);
registerChannelCommands(program);
registerConfigCommands(program);
registerMarketplaceCommands(program);
registerSecretCommands(program);
registerTriggerCommands(program);
registerUiCommands(program);

program.parse();
