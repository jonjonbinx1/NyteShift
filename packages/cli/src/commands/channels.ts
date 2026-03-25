import { Command } from "commander";
import chalk from "chalk";
import { listChannels, getChannel } from "@nyteshift/core";

export function registerChannelCommands(program: Command): void {
  const channels = program
    .command("channels")
    .description("Channel commands — list and inspect installed messaging channel adapters");

  // ── nyteshift channels list ────────────────────────────────────────

  channels
    .command("list")
    .description("List all installed channel adapters")
    .action(async () => {
      try {
        const list = await listChannels();
        if (list.length === 0) {
          console.log(
            chalk.yellow(
              "No channel adapters installed.\nInstall one from the marketplace: nyteshift marketplace install channels/<contributor>/<name>",
            ),
          );
          return;
        }

        console.log(chalk.bold("Installed Channels:\n"));
        for (const ch of list) {
          console.log(`  ${chalk.cyan(ch.contributor + "/" + ch.name)} v${ch.version}`);
          console.log(`    ${ch.description}`);
          if (ch.config?.length) {
            console.log(`    Config fields: ${ch.config.map((f) => f.key).join(", ")}`);
          }
          console.log();
        }
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // ── nyteshift channels inspect ─────────────────────────────────────

  channels
    .command("inspect <name>")
    .description("Show details of a specific channel adapter (contributor/name)")
    .action(async (name: string) => {
      try {
        const ch = await getChannel(name);
        if (!ch) {
          console.error(chalk.red(`✖ Channel "${name}" not found. Run: nyteshift channels list`));
          process.exitCode = 1;
          return;
        }

        console.log(chalk.bold(`Channel: ${ch.contributor}/${ch.name}`));
        console.log(`  Version:     ${ch.version}`);
        console.log(`  Description: ${ch.description}`);
        if (ch.config?.length) {
          console.log(chalk.bold("\n  Config fields:"));
          for (const f of ch.config) {
            const req = f.required ? chalk.red("*") : "";
            console.log(`    ${chalk.cyan(f.key)}${req} (${f.type}) — ${f.label}`);
            if (f.description) console.log(`      ${chalk.dim(f.description)}`);
          }
        }
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });
}
