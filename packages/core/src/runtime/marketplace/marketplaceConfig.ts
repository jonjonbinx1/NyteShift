/**
 * Marketplace configuration manager.
 *
 * Stores the list of marketplace sources at ~/.solix/marketplace.json.
 * Provides a default entry for the official repo.
 */

import { join } from "node:path";
import { solixHome, readJsonFile, writeJsonFile, pathExists } from "../../utils/index.js";
import type { MarketplaceConfig, MarketplaceSource } from "./types.js";

const DEFAULT_SOURCE: MarketplaceSource = {
  name: "Official SolixAI",
  url: "https://github.com/jonjonbinx1/SolixAI-Marketplace.git",
  branch: "main",
  enabled: true,
};

/** Path to ~/.solix/marketplace.json */
export function marketplaceConfigPath(): string {
  return join(solixHome(), "marketplace.json");
}

/** Path to ~/.solix/marketplace/ (where repos are cached) */
export function marketplaceCacheDir(): string {
  return join(solixHome(), "marketplace");
}

/** Derive a safe folder name from a source name */
export function sourceCacheDir(sourceName: string): string {
  const slug = sourceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return join(marketplaceCacheDir(), slug);
}

/** Read the marketplace config. Creates default if missing. */
export async function readMarketplaceConfig(): Promise<MarketplaceConfig> {
  const p = marketplaceConfigPath();
  if (!(await pathExists(p))) {
    const cfg: MarketplaceConfig = { sources: [DEFAULT_SOURCE] };
    await writeJsonFile(p, cfg);
    return cfg;
  }
  return readJsonFile<MarketplaceConfig>(p);
}

/** Write the marketplace config. */
export async function writeMarketplaceConfig(cfg: MarketplaceConfig): Promise<void> {
  await writeJsonFile(marketplaceConfigPath(), cfg);
}

/** Add a new marketplace source (no-op if URL already exists). */
export async function addMarketplaceSource(source: MarketplaceSource): Promise<MarketplaceConfig> {
  const cfg = await readMarketplaceConfig();
  if (cfg.sources.some((s) => s.url === source.url)) {
    return cfg;
  }
  cfg.sources.push(source);
  await writeMarketplaceConfig(cfg);
  return cfg;
}

/** Remove a marketplace source by name. */
export async function removeMarketplaceSource(name: string): Promise<MarketplaceConfig> {
  const cfg = await readMarketplaceConfig();
  cfg.sources = cfg.sources.filter((s) => s.name !== name);
  await writeMarketplaceConfig(cfg);
  return cfg;
}

/** Toggle a marketplace source on/off. */
export async function toggleMarketplaceSource(name: string, enabled: boolean): Promise<MarketplaceConfig> {
  const cfg = await readMarketplaceConfig();
  const src = cfg.sources.find((s) => s.name === name);
  if (src) src.enabled = enabled;
  await writeMarketplaceConfig(cfg);
  return cfg;
}
