/**
 * Marketplace barrel export.
 */

// Types
export type {
  MarketplaceConfig,
  MarketplaceSource,
  MarketplaceCategory,
  MarketplaceItem,
  MarketplaceSyncResult,
} from "./types.js";

// Config
export {
  readMarketplaceConfig,
  writeMarketplaceConfig,
  addMarketplaceSource,
  removeMarketplaceSource,
  toggleMarketplaceSource,
  marketplaceConfigPath,
  marketplaceCacheDir,
} from "./marketplaceConfig.js";

// Remote utilities
export {
  parseGithubUrl,
  invalidateTreeCache,
  fetchRepoTree,
} from "./marketplaceRemote.js";

// Sync / Refresh
export {
  syncAllMarketplaces,
  syncMarketplaceSource,
} from "./marketplaceSync.js";

// Browse & Install
export {
  browseMarketplace,
  listMarketplaceCategories,
  installMarketplaceItem,
  uninstallMarketplaceItem,
  extractDescriptionFromDir,
  fetchMarketplaceGraphDef,
  installMarketplaceGraph,
} from "./marketplaceBrowser.js";

// Installed-item metadata / auto-update helpers
export {
  readInstalledIndex,
  getInstalledItem,
  setItemAutoUpdate,
  setGlobalAutoUpdate,
  checkAndUpdateItem,
  autoUpdateInstalledItems,
  reconcileInstalledItems,
  hashOfCachePath,
} from "./installed.js";
