/**
 * Marketplace type definitions.
 *
 * A "marketplace source" is a git repository containing categorised folders
 * at the root (skills/, tools/, triggers/, souls/, themes/, …).  Inside each
 * category folder are contributor folders, and inside those the actual items.
 *
 * Example layout:
 *   skills/
 *     jonjonbinx1/
 *       web-search/
 *         skill.md
 *       summariser/
 *         skill.md
 *   tools/
 *     jonjonbinx1/
 *       rest-caller/
 *         tool.ts
 */

/** Persisted config for all marketplace sources — lives at ~/.solix/marketplace.json */
export interface MarketplaceConfig {
  /** Ordered list of marketplace sources. First match wins on name collisions. */
  sources: MarketplaceSource[];
}

export interface MarketplaceSource {
  /** Human-readable label, e.g. "Official SolixAI" */
  name: string;
  /** Git clone URL (HTTPS or SSH) */
  url: string;
  /** Optional branch/tag. Defaults to `main`. */
  branch?: string;
  /** Whether this source is enabled. */
  enabled: boolean;
}

/** Category derived from the root folder name in the marketplace repo */
export type MarketplaceCategory = string; // "skills" | "tools" | "triggers" | "souls" | …

/** A single item discovered inside a marketplace repo */
export interface MarketplaceItem {
  /** Which source this came from (the name field) */
  source: string;
  /** Root-level folder name, e.g. "skills" */
  category: MarketplaceCategory;
  /** Contributor / author folder name */
  contributor: string;
  /** Item folder name */
  name: string;
  /** Full path on disk inside the cached repo */
  localPath: string;
  /** Whether this item is already installed in ~/.solix/<category>/<contributor>/<name> */
  installed: boolean;
  /** Optional description from README.md or frontmatter */
  description: string;
  /** When installed, hash mismatch indicates an update is available. */
  needsUpdate?: boolean;
  /** Whether the installed copy has auto-update enabled (from installed index) */
  autoUpdate?: boolean;
}

/** Result of a sync operation */
export interface MarketplaceSyncResult {
  source: string;
  status: "cloned" | "updated" | "error" | "disabled";
  message: string;
}
