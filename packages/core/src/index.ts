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
  archiveChatSession,
} from "./runtime/agents/chatManager.js";
export type {
  ChatMessage,
  ChatSession,
  ChatSessionSummary,
} from "./runtime/agents/chatManager.js";

// ── Skills ─────────────────────────────────────────────────────────────
export { loadSkills as listSkills } from "./runtime/skills/skillLoader.js";

// ── Tools ──────────────────────────────────────────────────────────────
export { loadTools as listTools, getTool } from "./runtime/tools/toolLoader.js";
export { ensureToolDeps } from "./runtime/tools/toolDeps.js";

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
  readSkillToolConfig,
  writeSkillToolConfig,
} from "./runtime/config/configResolver.js";
export { ensureSolixDirs } from "./runtime/config/ensureDirs.js";

// ── Soul ───────────────────────────────────────────────────────────────
export {
  loadSoul,
  injectSoul,
  readSoul,
  writeSoul,
} from "./runtime/soul/soulInjector.js";
// ── Memory ──────────────────────────────────────────────
export {
  writeMemory,
  readMemory,
  listMemories,
  deleteMemory,
  clearAllMemories,
  searchMemories,
} from "./runtime/memory/memoryManager.js";
export type { MemoryEntry } from "./runtime/memory/memoryManager.js";

// ── Plans (long-running task checkpointing) ─────────────
export {
  createPlan,
  readPlan,
  checkpointPlan,
  summarizePlan,
  writePlanArtifact,
  finishPlan,
  listPlans,
  deletePlan,
} from "./runtime/memory/planManager.js";
export type {
  PlanEntry,
  PlanStep,
  PlanArtifact,
  PlanStatus,
} from "./runtime/memory/planManager.js";
// ── Triggers ───────────────────────────────────────────────────────────
export { listTriggers, fireTrigger } from "./runtime/triggers/triggerRunner.js";export {
  listAllTriggers,
  readAgentTriggers,
  writeAgentTriggers,
  createTriggerDefinition,
  updateTriggerDefinition,
  deleteTriggerDefinition,
  getTriggerDefinition,
} from "./runtime/triggers/triggerStore.js";
export { TriggerEngine, getTriggerEngine } from "./runtime/triggers/triggerEngine.js";
export type { TriggerEngineOptions } from "./runtime/triggers/triggerEngine.js";

// ── Discord ────────────────────────────────────────────────────────────
export {
  DiscordBridge,
  readBridgeConfig,
  writeBridgeConfig,
  deleteBridgeConfig,
  startBridge,
  stopBridge,
  isBridgeRunning,
  getActiveBridges,
  // Global Discord bridge
  GlobalDiscordBridge,
  parseAgentFromMessage,
  readGlobalDiscordConfig,
  writeGlobalDiscordConfig,
  startGlobalBridge,
  stopGlobalBridge,
  isGlobalBridgeRunning,
  getGlobalBridge,
} from "./runtime/discord/discordBridge.js";
export type { DiscordBridgeOptions } from "./runtime/discord/discordBridge.js";

// ── Control ────────────────────────────────────────────────────────────
export { AgentController } from "./runtime/control/controller.js";

// ── Utils (selective) ──────────────────────────────────────────────────
export { toKebab, solixHome } from "./utils/index.js";

// ── Sub-Agent Delegation ───────────────────────────────────────────────
export { createSubAgentTools } from "./runtime/subagent/subagentTools.js";
export type { SubAgentToolsOptions } from "./runtime/subagent/subagentTools.js";

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
  // update/auto helpers
  readInstalledIndex,
  getInstalledItem,
  setItemAutoUpdate,
  setGlobalAutoUpdate,
  checkAndUpdateItem,
  autoUpdateInstalledItems,
  reconcileInstalledItems,
} from "./runtime/marketplace/index.js";
