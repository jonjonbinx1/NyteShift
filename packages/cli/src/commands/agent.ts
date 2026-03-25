import { Command } from "commander";
import chalk from "chalk";
import {
  listAgents,
  createAgent,
  deleteAgent,
  runAutonomousTask,
  loadAgentConfig,
  writeAgentConfig,
} from "@nyteshift/core";

export function registerAgentCommands(program: Command): void {
  const agent = program.command("agent").description("Manage agents");

  // ── nyteshift agent list ─────────────────────────────────────────────────

  agent
    .command("list")
    .description("List all agents")
    .action(async () => {
      const agents = await listAgents();
      if (agents.length === 0) {
        console.log(chalk.yellow("No agents found. Create one with: nyteshift agent create <name>"));
        return;
      }
      console.log(chalk.bold("Agents:"));
      for (const name of agents) {
        console.log(`  • ${name}`);
      }
    });

  // ── nyteshift agent create <name> ────────────────────────────────────────

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

  // ── nyteshift agent delete <name> ────────────────────────────────────────

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

  // ── nyteshift agent run <name> "<task>" ──────────────────────────────────

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

  // ── nyteshift agent discord-access <name> ────────────────────────────────

  agent
    .command("discord-access <name>")
    .description("View or set the Discord channel access rules for an agent")
    .option(
      "--mode <mode>",
      "Access mode: disabled | global | restricted",
    )
    .option(
      "--server-ids <ids>",
      "Comma-separated Discord server (guild) IDs (restricted mode only)",
    )
    .option(
      "--channel-ids <ids>",
      "Comma-separated channel IDs — more secure (restricted mode only)",
    )
    .option(
      "--channel-names <names>",
      "Comma-separated channel names — less secure (restricted mode only)",
    )
    .action(async (name: string, opts: Record<string, string>) => {
      try {
        const cfg = await loadAgentConfig(name);
        const current = ((cfg.discordAccess as unknown) as Record<string, unknown>) ?? { mode: "disabled" };

        if (!opts.mode && !opts.serverIds && !opts.channelIds && !opts.channelNames) {
          // Read-only: print current config.
          console.log(chalk.bold(`Discord access for "${name}":`));
          console.log(`  mode        : ${chalk.cyan(current.mode as string ?? "disabled")}`);
          if (current.serverIds) console.log(`  serverIds   : ${(current.serverIds as string[]).join(", ")}`);
          if (current.channelIds) console.log(`  channelIds  : ${chalk.green((current.channelIds as string[]).join(", "))} (more secure)`);
          if (current.channelNames) console.log(`  channelNames: ${chalk.yellow((current.channelNames as string[]).join(", "))} (less secure)`);
          return;
        }

        const mode = opts.mode ?? (current.mode as string) ?? "disabled";
        if (!["disabled", "global", "restricted"].includes(mode)) {
          console.error(chalk.red(`✖ Invalid mode "${mode}". Choose: disabled | global | restricted`));
          process.exitCode = 1;
          return;
        }

        const next: Record<string, unknown> = { mode };
        if (mode === "restricted") {
          const serverIds = opts.serverIds
            ? opts.serverIds.split(",").map((s) => s.trim()).filter(Boolean)
            : (current.serverIds as string[] | undefined);
          const channelIds = opts.channelIds
            ? opts.channelIds.split(",").map((s) => s.trim()).filter(Boolean)
            : (current.channelIds as string[] | undefined);
          const channelNames = opts.channelNames
            ? opts.channelNames.split(",").map((s) => s.trim()).filter(Boolean)
            : (current.channelNames as string[] | undefined);
          if (serverIds?.length) next.serverIds = serverIds;
          if (channelIds?.length) next.channelIds = channelIds;
          if (channelNames?.length) next.channelNames = channelNames;
        }

        await writeAgentConfig(name, { ...cfg, discordAccess: next as unknown as import("@nyteshift/core").DiscordAccessConfig });

        console.log(chalk.green(`✔ Discord access for "${name}" updated.`));
        console.log(`  mode: ${chalk.cyan(mode)}`);
        if (next.serverIds) console.log(`  serverIds   : ${(next.serverIds as string[]).join(", ")}`);
        if (next.channelIds) console.log(`  channelIds  : ${chalk.green((next.channelIds as string[]).join(", "))} (more secure)`);
        if (next.channelNames) console.log(`  channelNames: ${chalk.yellow((next.channelNames as string[]).join(", "))} (less secure)`);

        if (mode === "restricted" && !next.channelIds && !next.channelNames && !next.serverIds) {
          console.log(chalk.yellow("  ⚠ No channel/server filters set — agent will respond in all channels (within this mode)."));
        }
        if (next.channelNames) {
          console.log(chalk.yellow("  ⚠ Channel names are less secure. Prefer channel IDs when possible."));
        }
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });
}
