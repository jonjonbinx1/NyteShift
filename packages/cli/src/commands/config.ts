import { Command } from "commander";
import chalk from "chalk";
import { readGlobalConfig } from "@nyteshift/core";

export function registerConfigCommands(program: Command): void {
  const config = program.command("config").description("Configuration commands");

  // ── nyteshift config show ────────────────────────────────────────────────

  config
    .command("show")
    .description("Show the current global configuration")
    .action(async () => {
      try {
        const cfg = await readGlobalConfig();
        console.log(chalk.bold("Global Configuration:"));
        console.log(JSON.stringify(cfg, null, 2));
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });
}
