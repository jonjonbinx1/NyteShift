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

// Sync
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
} from "./marketplaceBrowser.js";

// Installed-item metadata / auto-update helpers
export {
  readInstalledIndex,
  getInstalledItem,
  setItemAutoUpdate,
  setGlobalAutoUpdate,
  checkAndUpdateItem,
  autoUpdateInstalledItems,
} from "./installed.js";
