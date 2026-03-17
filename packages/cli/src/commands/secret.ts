import { Command } from "commander";
import chalk from "chalk";
import {
  getSecret,
  setSecret,
  deleteSecret,
  listSecretKeys,
  migrateSecretsFromConfig,
  CONFIG_SECRET_PATHS,
} from "@nyteshift/core";
import { readGlobalConfig, writeGlobalConfig } from "@nyteshift/core";

export function registerSecretCommands(program: Command): void {
  const secret = program
    .command("secret")
    .description("Manage secrets stored in the encrypted secret store");

  // ── nyteshift secret list ─────────────────────────────────────────────

  secret
    .command("list")
    .description("List names of all stored secrets (values are never shown)")
    .action(async () => {
      try {
        const keys = await listSecretKeys();
        if (keys.length === 0) {
          console.log(chalk.dim("No secrets stored."));
          return;
        }
        console.log(chalk.bold(`Stored secrets (${keys.length}):`));
        for (const k of keys) {
          console.log(`  ${chalk.cyan(k)}`);
        }
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // ── nyteshift secret set <key> <value> ───────────────────────────────

  secret
    .command("set <key> <value>")
    .description("Store or overwrite a secret (value never written to config.json)")
    .addHelpText(
      "after",
      `\nWell-known keys:\n` +
        CONFIG_SECRET_PATHS.map(
          (p) => `  ${chalk.cyan(p.secretKey)}  (was: ${p.configPath})`
        ).join("\n")
    )
    .action(async (key: string, value: string) => {
      try {
        await setSecret(key, value);
        console.log(chalk.green(`✔ Secret "${key}" saved.`));
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // ── nyteshift secret get <key> ───────────────────────────────────────

  secret
    .command("get <key>")
    .description("Retrieve and print a secret (use with care in scripts)")
    .action(async (key: string) => {
      try {
        const value = await getSecret(key);
        if (value === undefined) {
          console.error(chalk.yellow(`Secret "${key}" not found.`));
          process.exitCode = 1;
          return;
        }
        // Print raw value so it can be captured by scripts.
        process.stdout.write(value + "\n");
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // ── nyteshift secret delete <key> ───────────────────────────────────

  secret
    .command("delete <key>")
    .description("Delete a stored secret")
    .action(async (key: string) => {
      try {
        const existing = await getSecret(key);
        if (existing === undefined) {
          console.log(chalk.yellow(`Secret "${key}" not found — nothing to delete.`));
          return;
        }
        await deleteSecret(key);
        console.log(chalk.green(`✔ Secret "${key}" deleted.`));
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // ── nyteshift secret migrate ─────────────────────────────────────────

  secret
    .command("migrate")
    .description(
      "Scan config.json for plain-text secrets and move them to the secure store"
    )
    .option("--dry-run", "Report what would be migrated without making changes")
    .action(async (opts: { dryRun?: boolean }) => {
      try {
        const config = await readGlobalConfig();

        // Check what would migrate
        const wouldMigrate: string[] = [];
        for (const { configPath, secretKey } of CONFIG_SECRET_PATHS) {
          const parts = configPath.split(".");
          let cur: unknown = config;
          for (const p of parts) {
            if (cur !== null && typeof cur === "object") {
              cur = (cur as Record<string, unknown>)[p];
            } else {
              cur = undefined;
              break;
            }
          }
          if (typeof cur === "string" && cur.trim() !== "") {
            wouldMigrate.push(secretKey);
          }
        }

        if (wouldMigrate.length === 0) {
          console.log(
            chalk.green(
              "✔ No plain-text secrets found in config.json — nothing to migrate."
            )
          );
          return;
        }

        if (opts.dryRun) {
          console.log(chalk.bold("Would migrate (dry run):"));
          for (const k of wouldMigrate) {
            console.log(`  ${chalk.cyan(k)}`);
          }
          return;
        }

        const { sanitized, migrated } = await migrateSecretsFromConfig(
          config as Record<string, unknown>
        );

        if (migrated.length > 0) {
          await writeGlobalConfig(sanitized as any);
          console.log(
            chalk.green(`✔ Migrated ${migrated.length} secret(s) to secure storage:`)
          );
          for (const k of migrated) {
            console.log(`  ${chalk.cyan(k)}`);
          }
          console.log(
            chalk.dim(
              "\nPlain-text values removed from config.json.\n" +
                "Secrets are now stored encrypted in ~/.nyteshift/secrets.json."
            )
          );
        } else {
          console.log(
            chalk.green("✔ Nothing to migrate — secrets are already secure.")
          );
        }
      } catch (err) {
        console.error(chalk.red(`✖ ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });
}
