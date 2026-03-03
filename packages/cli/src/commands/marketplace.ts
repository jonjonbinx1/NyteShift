import { Command } from "commander";
import chalk from "chalk";
import {
  syncAllMarketplaces,
  browseMarketplace,
  listMarketplaceCategories,
  installMarketplaceItem,
  readMarketplaceConfig,
  addMarketplaceSource,
  removeMarketplaceSource,
  // new helpers for updates
  autoUpdateInstalledItems,
  checkAndUpdateItem,
  setGlobalAutoUpdate,
  setItemAutoUpdate,
} from "@solix/core";

// types
import type { MarketplaceItem } from "@solix/core";

export function registerMarketplaceCommands(program: Command): void {
  const marketplace = program.command("marketplace").description("Marketplace commands");

  // ── solix marketplace sync ───────────────────────────────────────────

  marketplace
    .command("sync")
    .description("Sync all enabled marketplace sources (git clone/pull)")
    .action(async () => {
      console.log(chalk.cyan("Syncing marketplace sources…"));
      const results = await syncAllMarketplaces();
      for (const r of results) {
        const colour = r.status === "error" ? chalk.red : r.status === "disabled" ? chalk.gray : chalk.green;
        console.log(colour(`  ${r.source}: ${r.status} — ${r.message}`));
      }
    });

  // ── solix marketplace list ───────────────────────────────────────────

  marketplace
    .command("list")
    .description("List available items in synced marketplaces")
    .option("-c, --category <category>", "Filter by category (skills, tools, …)")
    .option("-s, --search <query>", "Search by name, contributor, or description")
    .action(async (opts: { category?: string; search?: string }) => {
      const items = await browseMarketplace(opts);
      if (items.length === 0) {
        console.log(chalk.yellow("No items found. Run `solix marketplace sync` first."));
        return;
      }
      console.log(chalk.bold(`\n  Found ${items.length} item(s):\n`));
      for (const item of items) {
        const installed = item.installed ? chalk.green(" [installed]") : "";
        console.log(`  ${chalk.cyan(item.category)}/${chalk.bold(item.contributor)}/${item.name}${installed}`);
        if (item.description) console.log(`    ${chalk.gray(item.description)}`);
      }
      console.log();
    });

  // ── solix marketplace categories ─────────────────────────────────────

  marketplace
    .command("categories")
    .description("List available categories across all synced marketplaces")
    .action(async () => {
      const cats = await listMarketplaceCategories();
      if (cats.length === 0) {
        console.log(chalk.yellow("No categories found. Run `solix marketplace sync` first."));
        return;
      }
      console.log(chalk.bold("\n  Categories:\n"));
      for (const cat of cats) console.log(`    ${cat}`);
      console.log();
    });

  // ── solix marketplace install ────────────────────────────────────────

  marketplace
    .command("install <path>")
    .description("Install an item by path: <category>/<contributor>/<name>")
    .action(async (itemPath: string) => {
      const parts = itemPath.split("/");
      if (parts.length !== 3) {
        console.error(chalk.red("Usage: solix marketplace install <category>/<contributor>/<name>"));
        process.exit(1);
      }
      const [category, contributor, name] = parts;
      const all = await browseMarketplace({ category });
      const match = all.find((i: MarketplaceItem) => i.contributor === contributor && i.name === name);
      if (!match) {
        console.error(chalk.red(`Item not found: ${itemPath}. Run \`solix marketplace sync\` and \`solix marketplace list\` first.`));
        process.exit(1);
      }
      const res = await installMarketplaceItem(match);
      if (res.installed) {
        console.log(chalk.green(res.message));
      } else {
        console.error(chalk.red(res.message));
      }
    });

  // ── solix marketplace sources ────────────────────────────────────────

  const sourcesCmd = marketplace.command("sources").description("Manage marketplace sources");

  sourcesCmd
    .command("list")
    .description("List configured marketplace sources")
    .action(async () => {
      const cfg = await readMarketplaceConfig();
      console.log(chalk.bold("\n  Marketplace Sources:\n"));
      for (const s of cfg.sources) {
        const status = s.enabled ? chalk.green("enabled") : chalk.gray("disabled");
        console.log(`    ${chalk.bold(s.name)} — ${s.url} (${s.branch ?? "main"}) [${status}]`);
      }
      console.log();
    });

  sourcesCmd
    .command("add <name> <url>")
    .option("-b, --branch <branch>", "Branch name", "main")
    .description("Add a new marketplace source")
    .action(async (name: string, url: string, opts: { branch: string }) => {
      await addMarketplaceSource({ name, url, branch: opts.branch, enabled: true });
      console.log(chalk.green(`Added source: ${name} → ${url} (${opts.branch})`));
    });

  sourcesCmd
    .command("remove <name>")
    .description("Remove a marketplace source")
    .action(async (name: string) => {
      await removeMarketplaceSource(name);
      console.log(chalk.green(`Removed source: ${name}`));
    });

  // ── update / auto commands ─────────────────────────────────────────
  marketplace
    .command("update [path]")
    .description("Check for updates (or update a specific installed item)")
    .action(async (path?: string) => {
      if (!path) {
        const results = await autoUpdateInstalledItems();
        for (const r of results) {
          const name = `${r.item.category}/${r.item.contributor}/${r.item.name}`;
          console.log(`${name}: ${r.updated ? "updated" : "no change"} — ${r.message}`);
        }
        return;
      }
      const parts = path.split("/");
      if (parts.length !== 3) {
        console.error(chalk.red("Usage: solix marketplace update <category>/<contributor>/<name>"));
        process.exit(1);
      }
      const [category, contributor, name] = parts;
      const res = await checkAndUpdateItem(category, contributor, name);
      console.log(`${category}/${contributor}/${name}: ${res.message}`);
    });

  marketplace
    .command("auto <scope> <on|off>")
    .description("Enable or disable automatic updates. Scope may be 'global' or a specific <category>/<contributor>/<name>")
    .action(async (scope: string, state: string) => {
      const enabled = state === "on";
      if (scope === "global") {
        await setGlobalAutoUpdate(enabled);
        console.log(chalk.green(`Global auto-update ${enabled ? "enabled" : "disabled"}`));
      } else {
        const parts = scope.split("/");
        if (parts.length !== 3) {
          console.error(chalk.red("Usage: solix marketplace auto <global|category/contributor/name> <on|off>"));
          process.exit(1);
        }
        const [category, contributor, name] = parts;
        await setItemAutoUpdate(category, contributor, name, enabled);
        console.log(chalk.green(`${category}/${contributor}/${name} auto-update ${enabled ? "enabled" : "disabled"}`));
      }
    });
}
