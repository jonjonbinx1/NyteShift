import { Command } from "commander";
import chalk from "chalk";
import { readGlobalConfig, CONFIG_SECRET_PATHS } from "@nyteshift/core";

/** Replace any still-present known secret paths in the config with a redaction marker. */
function redactSecrets(cfg: Record<string, unknown>): Record<string, unknown> {
  const redacted = JSON.parse(JSON.stringify(cfg));
  for (const { configPath } of CONFIG_SECRET_PATHS) {
    const parts = configPath.split(".");
    let cur: unknown = redacted;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur !== null && typeof cur === "object") {
        cur = (cur as Record<string, unknown>)[parts[i]];
      } else {
        cur = undefined;
        break;
      }
    }
    if (cur !== null && typeof cur === "object") {
      const leaf = parts[parts.length - 1];
      const record = cur as Record<string, unknown>;
      if (typeof record[leaf] === "string" && record[leaf] !== "") {
        record[leaf] = "<stored in secret store>";
      }
    }
  }
  return redacted;
}

export function registerConfigCommands(program: Command): void {
  const config = program.command("config").description("Configuration commands");

  // ── nyteshift config show ────────────────────────────────────────────────

  config
    .command("show")
    .description("Show the current global configuration (secrets are redacted)")
    .action(async () => {
      try {
        const cfg = await readGlobalConfig();
        console.log(chalk.bold("Global Configuration:"));
        console.log(JSON.stringify(redactSecrets(cfg as Record<string, unknown>), null, 2));
        console.log(
          chalk.dim(
            "\nNote: API keys and tokens are stored securely.\n" +
              "      Use \"nyteshift secret list\" to see which secrets are stored."
          )
        );
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });
}

