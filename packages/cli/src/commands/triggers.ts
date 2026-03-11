import { Command } from "commander";
import chalk from "chalk";
import {
  listTriggers,
  fireTrigger,
  listAllTriggers,
  readAgentTriggers,
  createTriggerDefinition,
  deleteTriggerDefinition,
  updateTriggerDefinition,
  getTriggerEngine,
  listAgents,
} from "@nyteshift/core";
import type { TriggerEvent, TriggerType } from "@nyteshift/core";

export function registerTriggerCommands(program: Command): void {
  const triggers = program.command("triggers").description("Trigger commands — manage agent triggers (cron, webhook, manual, discord)");

  // ── nyteshift triggers list ──────────────────────────────────────────────

  triggers
    .command("list")
    .description("List all trigger definitions across agents")
    .option("-a, --agent <name>", "Filter by agent name")
    .action(async (opts: { agent?: string }) => {
      try {
        let defs;
        if (opts.agent) {
          defs = await readAgentTriggers(opts.agent);
        } else {
          defs = await listAllTriggers();
        }

        if (defs.length === 0) {
          console.log(chalk.yellow("No triggers defined. Create one with: nyteshift triggers create"));
          return;
        }

        console.log(chalk.bold("Triggers:\n"));
        for (const t of defs) {
          const status = t.enabled ? chalk.green("enabled") : chalk.dim("disabled");
          console.log(`  ${chalk.cyan(t.name)} [${t.type}] → ${chalk.magenta(t.agentName)} (${status})`);
          console.log(`    ID: ${chalk.dim(t.id)}`);
          if (t.schedule) console.log(`    Schedule: ${t.schedule}`);
          if (t.webhookPath) console.log(`    Webhook: ${t.webhookPath}`);
          if (t.type === "discord") {
            console.log(`    Discord mode: ${t.discordMode ?? "trigger"}`);
            if (t.discordGuildId) console.log(`    Guild: ${t.discordGuildId}`);
            if (t.discordChannelIds?.length) console.log(`    Channels: ${t.discordChannelIds.join(", ")}`);
            if (t.discordMentionOnly) console.log(`    Mention-only: yes`);
          }
          console.log(`    Task: "${t.taskTemplate.slice(0, 80)}${t.taskTemplate.length > 80 ? "…" : ""}"`);
          console.log();
        }
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // ── nyteshift triggers create ────────────────────────────────────────────

  triggers
    .command("create")
    .description("Create a new trigger definition")
    .requiredOption("-n, --name <name>", "Trigger name")
    .requiredOption("-a, --agent <agent>", "Agent name")
    .requiredOption("-t, --type <type>", "Trigger type: cron | webhook | manual | discord | oneoff | monthly")
    .requiredOption("--task <template>", "Task template (supports {{payload}} interpolation)")
    .option("-s, --schedule <schedule>", "Cron expression or interval (e.g. '5m', '*/30 * * * *')")
    .option("--run-at <iso|ms>", "One-off run time (ISO string or milliseconds since epoch)")
    .option("--monthly-type <type>", "Monthly mode: day | ordinal")
    .option("--monthly-day <n>", "Day of month (1-31)")
    .option("--monthly-ordinal <ordinal>", "Ordinal: first|second|third|fourth|last")
    .option("--monthly-weekday <n>", "Weekday for ordinal: 0=Sun..6=Sat, or -1=day, -2=weekday, -3=weekend")
    .option("--monthly-hour <n>", "Hour of day (0-23)")
    .option("--monthly-minute <n>", "Minute of hour (0-59)")
    .option("--webhook-path <path>", "Webhook URL path (e.g. /hooks/my-agent)")
    .option("--webhook-secret <secret>", "Webhook HMAC-SHA256 secret")
    .option("--discord-token <token>", "Discord bot token")
    .option("--discord-guild <id>", "Discord guild (server) ID to restrict to")
    .option("--discord-channels <ids>", "Comma-separated Discord channel IDs to listen on")
    .option("--mention-only", "Only respond when the bot is @mentioned (Discord)")
    .option("--discord-mode <mode>", "Discord mode: trigger | bridge (default: trigger)")
    .option("-p, --provider <provider>", "Override provider")
    .option("-m, --model <model>", "Override model")
    .option("--max-steps <n>", "Max autonomous steps", "10")
    .option("--disabled", "Create in disabled state")
    .action(async (opts) => {
      try {
        // Validate agent exists.
        const agents = await listAgents();
        if (!agents.includes(opts.agent) && !agents.includes(opts.agent.toLowerCase().replace(/\s+/g, "-"))) {
          console.error(chalk.red(`✖ Agent "${opts.agent}" not found. Available: ${agents.join(", ")}`));
          process.exitCode = 1;
          return;
        }

        // Parse optional fields
        const parsedRunAt = opts.runAt ? (isNaN(Number(opts.runAt)) ? Date.parse(opts.runAt) : Number(opts.runAt)) : undefined;
        const monthlyDay = opts.monthlyDay ? parseInt(opts.monthlyDay, 10) : undefined;
        const monthlyWeekday = opts.monthlyWeekday ? parseInt(opts.monthlyWeekday, 10) : undefined;
        const monthlyHour = opts.monthlyHour ? parseInt(opts.monthlyHour, 10) : undefined;
        const monthlyMinute = opts.monthlyMinute ? parseInt(opts.monthlyMinute, 10) : undefined;

        const trigger = await createTriggerDefinition({
          name: opts.name,
          agentName: opts.agent,
          type: opts.type as TriggerType,
          enabled: !opts.disabled,
          taskTemplate: opts.task,
          schedule: opts.schedule,
          runAt: parsedRunAt,
          monthlyType: opts.monthlyType as any,
          monthlyDay,
          monthlyOrdinal: opts.monthlyOrdinal,
          monthlyWeekday,
          monthlyHour,
          monthlyMinute,
          webhookPath: opts.webhookPath,
          webhookSecret: opts.webhookSecret,
          provider: opts.provider,
          model: opts.model,
          maxSteps: parseInt(opts.maxSteps ?? "10", 10),
          // Discord-specific fields.
          discordBotToken: opts.discordToken,
          discordGuildId: opts.discordGuild,
          discordChannelIds: opts.discordChannels
            ? opts.discordChannels.split(",").map((s: string) => s.trim()).filter(Boolean)
            : undefined,
          discordMentionOnly: opts.mentionOnly ?? false,
          discordMode: (opts.discordMode as "trigger" | "bridge") ?? "trigger",
        });

        console.log(chalk.green(`✔ Trigger "${trigger.name}" created (${trigger.id})`));

        // Hot-reload into running engine if available.
        try {
          const engine = getTriggerEngine();
          if (engine.isRunning) {
            engine.addTrigger(trigger);
            console.log(chalk.dim("  (live-loaded into trigger engine)"));
          }
        } catch {
          // Engine not running — that's fine.
        }
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // ── nyteshift triggers delete <id> ───────────────────────────────────────

  triggers
    .command("delete <id>")
    .description("Delete a trigger by ID")
    .action(async (id: string) => {
      try {
        const deleted = await deleteTriggerDefinition(id);
        if (!deleted) {
          console.error(chalk.red(`✖ Trigger "${id}" not found`));
          process.exitCode = 1;
          return;
        }
        console.log(chalk.green(`✔ Trigger deleted.`));

        try {
          const engine = getTriggerEngine();
          if (engine.isRunning) engine.removeTrigger(id);
        } catch {}
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // ── nyteshift triggers enable/disable <id> ───────────────────────────────

  triggers
    .command("enable <id>")
    .description("Enable a trigger")
    .action(async (id: string) => {
      try {
        const updated = await updateTriggerDefinition(id, { enabled: true });
        if (!updated) {
          console.error(chalk.red(`✖ Trigger "${id}" not found`));
          process.exitCode = 1;
          return;
        }
        console.log(chalk.green(`✔ Trigger "${updated.name}" enabled.`));
        try {
          const engine = getTriggerEngine();
          if (engine.isRunning) engine.addTrigger(updated);
        } catch {}
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  triggers
    .command("disable <id>")
    .description("Disable a trigger")
    .action(async (id: string) => {
      try {
        const updated = await updateTriggerDefinition(id, { enabled: false });
        if (!updated) {
          console.error(chalk.red(`✖ Trigger "${id}" not found`));
          process.exitCode = 1;
          return;
        }
        console.log(chalk.green(`✔ Trigger "${updated.name}" disabled.`));
        try {
          const engine = getTriggerEngine();
          if (engine.isRunning) engine.removeTrigger(id);
        } catch {}
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // ── nyteshift triggers fire <id> ─────────────────────────────────────────

  triggers
    .command("fire <id>")
    .description("Manually fire a trigger")
    .option("--payload <json>", "JSON payload to pass to the trigger", "{}")
    .action(async (id: string, opts: { payload: string }) => {
      try {
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(opts.payload);
        } catch {
          console.error(chalk.red("✖ --payload must be valid JSON"));
          process.exitCode = 1;
          return;
        }

        const engine = getTriggerEngine();
        if (!engine.isRunning) {
          await engine.start();
        }

        console.log(chalk.cyan(`Firing trigger "${id}"…`));
        const run = await engine.fireManual(id, payload);

        if (run.status === "completed") {
          console.log(chalk.green(`✔ Trigger completed.`));
          console.log(chalk.bold("\n── Output ──────────────────────────────"));
          console.log((run.result as any)?.finalOutput ?? "(no output)");
        } else {
          console.error(chalk.red(`✖ Trigger failed: ${run.error}`));
          process.exitCode = 1;
        }
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // ── nyteshift triggers start ─────────────────────────────────────────────

  triggers
    .command("start")
    .description("Start the trigger engine (watches cron schedules, opens webhook server)")
    .option("--port <port>", "Webhook server port", "7433")
    .action(async (opts: { port: string }) => {
      try {
        const engine = getTriggerEngine({ webhookPort: parseInt(opts.port, 10) });
        await engine.start();

        console.log(chalk.green("✔ Trigger engine running. Press Ctrl+C to stop."));

        // Keep the process alive.
        process.on("SIGINT", async () => {
          console.log(chalk.dim("\nShutting down trigger engine…"));
          await engine.stop();
          process.exit(0);
        });
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // ── nyteshift triggers runs ──────────────────────────────────────────────

  triggers
    .command("runs")
    .description("Show recent trigger runs")
    .option("-a, --agent <name>", "Filter by agent name")
    .option("-n, --limit <n>", "Max runs to show", "20")
    .action(async (opts: { agent?: string; limit: string }) => {
      try {
        const engine = getTriggerEngine();
        const runs = engine.getRuns(opts.agent ? { agentName: opts.agent } : undefined);
        const limit = parseInt(opts.limit, 10);
        const shown = runs.slice(0, limit);

        if (shown.length === 0) {
          console.log(chalk.yellow("No trigger runs recorded (engine may not have been started)."));
          return;
        }

        console.log(chalk.bold(`Recent trigger runs (${shown.length}/${runs.length}):\n`));
        for (const r of shown) {
          const icon = r.status === "completed" ? chalk.green("✔") : r.status === "failed" ? chalk.red("✖") : chalk.yellow("⏳");
          const elapsed = r.completedAt ? `${r.completedAt - r.startedAt}ms` : "running";
          console.log(`  ${icon} ${chalk.cyan(r.triggerName)} → ${r.agentName} [${r.status}] (${elapsed})`);
          if (r.error) console.log(`    Error: ${chalk.red(r.error)}`);
        }
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // ── Legacy: nyteshift triggers run <name> (kept for backwards compat) ────

  triggers
    .command("run <name>")
    .description("Manually fire a legacy trigger (from ~/.nyteshift/triggers/)")
    .action(async (name: string) => {
      try {
        const event: TriggerEvent = {
          type: "manual",
          payload: {},
          timestamp: Date.now(),
        };
        console.log(chalk.cyan(`Firing legacy trigger "${name}"…`));
        await fireTrigger(name, event);
        console.log(chalk.green(`✔ Trigger "${name}" completed.`));
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });
}
