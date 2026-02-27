import { Command } from "commander";
import chalk from "chalk";
import {
  listAgents,
  createAgent,
  deleteAgent,
  runAutonomousTask,
} from "@solix/core";

export function registerAgentCommands(program: Command): void {
  const agent = program.command("agent").description("Manage agents");

  // ── solix agent list ─────────────────────────────────────────────────

  agent
    .command("list")
    .description("List all agents")
    .action(async () => {
      const agents = await listAgents();
      if (agents.length === 0) {
        console.log(chalk.yellow("No agents found. Create one with: solix agent create <name>"));
        return;
      }
      console.log(chalk.bold("Agents:"));
      for (const name of agents) {
        console.log(`  • ${name}`);
      }
    });

  // ── solix agent create <name> ────────────────────────────────────────

  agent
    .command("create <name>")
    .description("Create a new agent")
    .action(async (name: string) => {
      try {
        const config = await createAgent(name);
        console.log(chalk.green(`✔ Agent "${config.name}" created.`));
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // ── solix agent delete <name> ────────────────────────────────────────

  agent
    .command("delete <name>")
    .description("Delete an agent")
    .action(async (name: string) => {
      try {
        await deleteAgent(name);
        console.log(chalk.green(`✔ Agent "${name}" deleted.`));
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // ── solix agent run <name> "<task>" ──────────────────────────────────

  agent
    .command("run <name> <task>")
    .description("Run an autonomous task with an agent")
    .option("-p, --provider <provider>", "Provider id")
    .option("-m, --model <model>", "Model id")
    .option("--max-steps <n>", "Maximum pipeline steps", "10")
    .action(async (name: string, task: string, opts: Record<string, string>) => {
      try {
        console.log(chalk.cyan(`Running task with agent "${name}"…`));
        const result = await runAutonomousTask(name, task, {
          provider: opts.provider,
          model: opts.model,
          maxSteps: parseInt(opts.maxSteps ?? "10", 10),
        });

        console.log(chalk.bold("\n── Result ──────────────────────────────"));
        console.log(result.finalOutput);

        if (result.aborted) {
          console.log(chalk.yellow("\n(task was aborted)"));
        }
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });
}
