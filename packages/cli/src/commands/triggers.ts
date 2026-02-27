import { Command } from "commander";
import chalk from "chalk";
import { listTriggers, fireTrigger } from "@solix/core";
import type { TriggerEvent } from "@solix/core";

export function registerTriggerCommands(program: Command): void {
  const triggers = program.command("triggers").description("Trigger commands");

  // ── solix triggers list ──────────────────────────────────────────────

  triggers
    .command("list")
    .description("List available triggers")
    .action(async () => {
      const names = await listTriggers();
      if (names.length === 0) {
        console.log(chalk.yellow("No triggers found under ~/.solix/triggers."));
        return;
      }
      console.log(chalk.bold("Triggers:"));
      for (const name of names) {
        console.log(`  • ${name}`);
      }
    });

  // ── solix triggers run <name> ────────────────────────────────────────

  triggers
    .command("run <name>")
    .description("Manually fire a trigger")
    .action(async (name: string) => {
      try {
        const event: TriggerEvent = {
          type: "manual",
          payload: {},
          timestamp: Date.now(),
        };
        console.log(chalk.cyan(`Firing trigger "${name}"…`));
        await fireTrigger(name, event);
        console.log(chalk.green(`✔ Trigger "${name}" completed.`));
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });
}
