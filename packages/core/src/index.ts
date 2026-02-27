// ── SolixAI Core — Public API ──────────────────────────────────────────

// Re-export every type so consumers only need `@solix/core`.
export type * from "./types/index.js";

// ── Pipeline ───────────────────────────────────────────────────────────
export { runAutonomousTask } from "./runtime/pipeline/autonomous.js";
export { runTriggeredPipeline } from "./runtime/pipeline/triggered.js";

// ── Agents ─────────────────────────────────────────────────────────────
export {
  listAgents,
  createAgent,
  deleteAgent,
  loadAgentConfig,
} from "./runtime/agents/agentManager.js";

// ── Chat Sessions ──────────────────────────────────────────────────────
export {
  listChatSessions,
  loadChatSession,
  saveChatSession,
  deleteChatSession,
  deleteAllChatSessions,
} from "./runtime/agents/chatManager.js";
export type {
  ChatMessage,
  ChatSession,
  ChatSessionSummary,
} from "./runtime/agents/chatManager.js";

// ── Skills ─────────────────────────────────────────────────────────────
export { loadSkills as listSkills } from "./runtime/skills/skillLoader.js";

// ── Tools ──────────────────────────────────────────────────────────────
export { loadTools as listTools } from "./runtime/tools/toolLoader.js";

// ── Providers ──────────────────────────────────────────────────────────
export {
  listProviders,
  callProvider,
  callDefaultProvider,
  listAllModels,
  whenUserProvidersLoaded,
} from "./runtime/providers/providerRouter.js";

// ── Config ─────────────────────────────────────────────────────────────
export {
  resolveConfig,
  readGlobalConfig,
  writeGlobalConfig,
  readAgentConfig,
  writeAgentConfig,
} from "./runtime/config/configResolver.js";
export { ensureSolixDirs } from "./runtime/config/ensureDirs.js";

// ── Soul ───────────────────────────────────────────────────────────────
export {
  loadSoul,
  injectSoul,
  readSoul,
  writeSoul,
} from "./runtime/soul/soulInjector.js";

// ── Triggers ───────────────────────────────────────────────────────────
export { listTriggers, fireTrigger } from "./runtime/triggers/triggerRunner.js";

// ── Control ────────────────────────────────────────────────────────────
export { AgentController } from "./runtime/control/controller.js";

// ── Utils (selective) ──────────────────────────────────────────────────
export { toKebab, solixHome } from "./utils/index.js";

// ── Marketplace ────────────────────────────────────────────────────────
export type {
  MarketplaceConfig,
  MarketplaceSource,
  MarketplaceCategory,
  MarketplaceItem,
  MarketplaceSyncResult,
} from "./runtime/marketplace/index.js";
export {
  readMarketplaceConfig,
  writeMarketplaceConfig,
  addMarketplaceSource,
  removeMarketplaceSource,
  toggleMarketplaceSource,
  syncAllMarketplaces,
  syncMarketplaceSource,
  browseMarketplace,
  listMarketplaceCategories,
  installMarketplaceItem,
  uninstallMarketplaceItem,
} from "./runtime/marketplace/index.js";
