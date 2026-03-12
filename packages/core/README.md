# @nyteshift/core

The NyteShift core runtime — the engine behind agents, pipelines, providers, tools, skills, memory, plans, triggers, graphs, marketplace, and Discord integration.

## Public API

```ts
import {
  // Pipeline
  runAutonomousTask,
  runTriggeredPipeline,

  // Agents
  listAgents, createAgent, deleteAgent, loadAgentConfig,

  // Chat Sessions
  listChatSessions, loadChatSession, saveChatSession,
  archiveChatSession, deleteAllChatSessions,

  // Skills & Tools
  listSkills, listTools, getTool,

  // Providers
  listProviders, getProvider, callProvider, callDefaultProvider,
  listAllModels, whenUserProvidersLoaded,

  // Config
  resolveConfig, readGlobalConfig, writeGlobalConfig,
  readAgentConfig, writeAgentConfig,
  readSkillToolConfig, writeSkillToolConfig,

  // Soul
  loadSoul, injectSoul, readSoul, writeSoul,

  // Memory
  writeMemory, readMemory, listMemories,
  deleteMemory, searchMemories, clearAllMemories,

  // Plans
  createPlan, readPlan, checkpointPlan, summarizePlan,
  writePlanArtifact, finishPlan, listPlans, deletePlan,

  // Sub-Agent Delegation
  createSubAgentTools,

  // Triggers
  listTriggers, fireTrigger, TriggerEngine,
  listAllTriggers, readAgentTriggers, writeAgentTriggers,
  createTriggerDefinition, updateTriggerDefinition,
  deleteTriggerDefinition, getTriggerDefinition,

  // Graphs
  validateGraph, runGraph,
  listGraphs, loadGraph, saveGraph, deleteGraph,
  graphRunRegistry,

  // Discord
  DiscordBridge, readBridgeConfig, writeBridgeConfig,
  startBridge, stopBridge, isBridgeRunning,
  readGlobalDiscordConfig, writeGlobalDiscordConfig,
  startGlobalBridge, stopGlobalBridge, isGlobalBridgeRunning,

  // Control
  AgentController,

  // Marketplace
  browseMarketplace, listMarketplaceCategories,
  installMarketplaceItem, uninstallMarketplaceItem,
  readMarketplaceConfig, addMarketplaceSource,
  removeMarketplaceSource, toggleMarketplaceSource,
  syncAllMarketplaces, syncMarketplaceSource,
  checkAndUpdateItem, autoUpdateInstalledItems,
  setItemAutoUpdate, setGlobalAutoUpdate,

  // Utils
  toKebab, nyteShiftHome,
} from "@nyteshift/core";
```

## Runtime Architecture

```
@nyteshift/core
  pipeline/
    autonomous.ts       ReAct loop (Reason, Act, Observe)
    triggered.ts        Sequential step execution on events
  agents/
    agentManager.ts     CRUD for agent directories
    chatManager.ts      Persistent chat session storage
  providers/
    providerRouter.ts   Unified multi-provider LLM interface
    openaiProvider.ts   OpenAI Chat Completions
    anthropicProvider.ts  Anthropic Messages API
    openrouterProvider.ts OpenRouter (OpenAI-compatible)
  skills/
    skillLoader.ts      Scan & parse YAML-frontmatter skill files
  tools/
    toolLoader.ts       Dynamic ESM import with mtime caching
    toolDeps.ts         Isolated per-tool npm dependency management
  memory/
    memoryManager.ts    Persistent agent-scoped key-value store
    memoryTools.ts      Built-in memory tool contracts
    planManager.ts      Task checkpointing with rolling summarization
    planTools.ts        Built-in plan tool contracts
  subagent/
    subagentTools.ts    Orchestrator-workers delegation tools
  soul/
    soulInjector.ts     Load & inject agent personality prompts
  config/
    configResolver.ts   Hierarchical config merge (global -> agent)
    ensureDirs.ts       Create ~/.nyteshift directory structure
  control/
    controller.ts       AbortController-based cancel/stop
  triggers/
    triggerEngine.ts    Event loop for all trigger types
    triggerStore.ts     Per-agent trigger persistence
    triggerRunner.ts    Direct trigger invocation
    cronParser.ts       Cron & interval parsing (no dependencies)
  graph/
    types.ts            Node/edge/condition/error-policy types
    graphValidator.ts   Structural validation (SCC cycle detection)
    graphRunner.ts      Deterministic graph execution engine
    graphStore.ts       Filesystem persistence for graphs
    graphRunRegistry.ts In-memory run tracking with events
  discord/
    discordBridge.ts    Discord channel <-> agent integration
  marketplace/
    marketplaceBrowser.ts  Browse & install from GitHub repos
    marketplaceRemote.ts   GitHub API interaction (cached tree)
    marketplaceConfig.ts   Source management
    marketplaceSync.ts     Refresh marketplace index
    installed.ts           Track installed items & auto-update
    types.ts               Marketplace type definitions
  types/
    index.ts            Shared type definitions
  utils/
    index.ts            Path helpers, file I/O, hashing
```

## Autonomous Pipeline — ReAct Loop

The autonomous pipeline implements the **ReAct (Reason + Act)** framework — the standard agentic pattern recommended by Anthropic and OpenAI.

**Execution flow:**

1. `resolveConfig(agentName)` — merge global and agent config
2. `loadSkills()` + `loadTools()` — filter by agent whitelist
3. Inject built-in tools: memory (5 tools), plan (5 tools), sub-agent (2-3 tools)
4. `injectSoul(agentName, messages)` — prepend agent personality
5. **ReAct loop**: Call LLM, parse for `<tool_call>` or `<final_answer>`, execute tools, repeat

### LLM Response Protocol

The system prompt instructs the model to use one of two structured formats:

**Tool call:**
```xml
<tool_call>
{ "name": "tool_name", "input": { "param": "value" } }
</tool_call>
```
The runtime finds the tool by `name` or `contributor/name`, executes it, and injects:
```xml
<tool_result>
...tool output...
</tool_result>
```

**Final answer:**
```xml
<final_answer>
Your complete answer here.
</final_answer>
```

If neither tag appears the full response is treated as the final answer (graceful fallback).

### Sub-Agent Delegation (Orchestrator-Workers)

Agents can delegate sub-tasks to other agents following Anthropic's
**orchestrator-workers** pattern. Three built-in tools are available:

| Tool | Description |
|------|-------------|
| `nyteshift/sub_agent_run` | Spawn a named agent with a self-contained task |
| `nyteshift/sub_agent_list` | List available agents and their configurations |
| `nyteshift/sub_agent_collect` | Check status / retrieve results of async sub-agent runs |

**Key design decisions:**

- **Depth-bounded**: Maximum nesting depth (default 3) prevents infinite loops
- **Isolated contexts**: Each sub-agent has its own message history
- **Config inheritance**: Sub-agents inherit parent's provider/model unless overridden
- **Self-delegation**: `agent="self"` enables divide-and-conquer on complex problems
- **Async mode**: Optional fire-and-forget with `sub_agent_collect` polling
- **AbortSignal propagation**: Cancelling the parent also cancels all children

### Loop Termination

| Condition | Behaviour |
|-----------|----------|
| `<final_answer>` in output | Return `finalOutput`, end loop |
| Raw text, no tags | Treat as final answer, end loop |
| `maxSteps` exhausted | Use last assistant message |
| `AbortSignal` fires | Set `aborted: true`, end loop |
| Provider error | Surface error message in `finalOutput` |

## Triggered Pipeline

Executes pre-configured steps sequentially when an event occurs. Each step is a skill (LLM call with skill prompt) or a tool (direct execution). Output from one step feeds as input to the next — no ReAct loop, useful for deterministic workflows.

## Memory System

Persistent agent-scoped knowledge store, external to the LLM context window. Follows Anthropic's recommendation for explicit (not automatic) memory access.

**Built-in tools** (injected into every autonomous run):

| Tool | Description |
|------|-------------|
| `nyteshift/memory_write` | Store or update a memory by key (with category and note) |
| `nyteshift/memory_read` | Fetch a memory by key |
| `nyteshift/memory_list` | List all memories (optionally filtered by category) |
| `nyteshift/memory_delete` | Remove a memory |
| `nyteshift/memory_search` | Keyword search across all memories |

**Storage**: One JSON file per memory at `~/.nyteshift/agents/<agent>/memory/<key>.json`

## Plan System

Structured checkpointing for long-running tasks with rolling summarization. Run-scoped — each autonomous task can create and manage one plan.

**Built-in tools** (injected into every autonomous run):

| Tool | Description |
|------|-------------|
| `nyteshift/plan_start` | Initialize a plan with task description and outline |
| `nyteshift/plan_checkpoint` | Log a completed step with action and result |
| `nyteshift/plan_summarize` | Compress old steps into a narrative summary |
| `nyteshift/plan_read` | Read the current plan state |
| `nyteshift/plan_finish` | Mark plan as complete, failed, or aborted |

Plans support artifacts (intermediate outputs stored by key) and configurable summary compression ratios.

## Graph Execution Engine

Directed execution graphs with branching, condition-guarded loops, and error policies.

### Node Types

| Type | Description |
|------|-------------|
| `input` | Entry point — emits graph input variables |
| `output` | Exit point — collects final result |
| `llm` | Single LLM call (prompt to response, no tools) |
| `agent` | Full ReAct run via `runAutonomousTask` |
| `tool` | Direct tool invocation |
| `condition` | Routing node — evaluates predicates, selects exclusive branch |
| `operation` | Mutate graph variables |
| `catch` | Fired after loop exit (maxIterations/error/abort) |
| `trigger` | Invoke another graph or agent |

### Condition Operators

`eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `contains`, `not_contains`, `starts_with`, `ends_with`, `exists`, `not_exists`, `matches`

### Error Policies

| Policy | Behaviour |
|--------|-----------|
| `halt` | Stop graph execution on error |
| `retry` | Retry N times with configurable delay and exponential backoff |
| `skip` | Skip the failed node, continue execution |
| `fallback` | Use a fallback value and continue |

### Cycle Detection

Tarjan's SCC algorithm validates graph structure. Bare cycles are rejected; loops are allowed only when guarded by a condition node with an exit branch, preventing infinite execution while enabling intentional feedback loops.

### Graph Run Registry

In-memory tracking of all graph runs (manual, trigger, trigger-node) with EventEmitter events: `registered`, `node:start`, `node:complete`, `run:complete`. Supports abort via `AbortController`.

## Trigger System

Orchestrates event-driven agent execution across six trigger types:

| Type | Mechanism |
|------|-----------|
| `cron` | Interval (`30s`, `5m`, `1h`, `1d`) or standard 5-field cron expressions |
| `webhook` | HTTP server on port 7433, HMAC-SHA256 secret validation |
| `discord` | Lazy-loaded discord.js client, trigger or bridge mode |
| `monthly` | Day-of-month (1-31) or ordinal weekday (first Monday, last Friday) |
| `oneoff` | setTimeout at specified ISO timestamp or Unix ms |
| `manual` | Fired from CLI or UI |

Task templates support `{{payload}}` interpolation with event data. Each trigger run is recorded in a newest-first history (max 200 entries per trigger).

## Discord Integration

Two modes for connecting Discord channels to agents:

| Mode | Behavior |
|------|----------|
| **Trigger** | Each Discord message spawns an independent autonomous run (stateless) |
| **Bridge** | Channel maps to a persistent chat session; full history passed to agent |

Supports per-agent or global (shared bot) configuration. Includes `/newchat` (archive session) and `/cancel` (abort run) slash commands.

## Marketplace

Browse, install, and auto-update skills, tools, themes, and triggers from GitHub-hosted repositories.

- **GitHub API based** — lightweight tree fetching with 5-minute cache
- **Parallel README downloads** for item descriptions
- **Installed index** tracking with hash-based change detection
- **Auto-update** per-item or global, with batch update support
- **Reconciliation** — detects on-disk items missing from the installed index

## Configuration Resolution

Config values are resolved with a clear precedence (highest wins):

1. **Security overrides** — hard-coded guardrails
2. **Agent-level config** — `~/.nyteshift/agents/<agent>/config.json`
3. **User-level (global) config** — `~/.nyteshift/config.json`
4. **Hard-coded defaults**

### Agent Config Fields

```typescript
{
  name, provider, model, temperature, maxTokens, maxSteps,
  skills, tools, allowAsyncSubAgents, unbounded,
  skillConfig, toolConfig
}
```

---

## Providers

Three providers ship built-in:

| Provider ID | Platform | Env var |
|-------------|----------|---------|
| `openai` | OpenAI API | `OPENAI_API_KEY` |
| `anthropic` | Anthropic Messages API | `ANTHROPIC_API_KEY` |
| `openrouter` | OpenRouter (OpenAI-compatible) | `OPENROUTER_API_KEY` |

Configure via `~/.nyteshift/config.json`:

```json
{
  "defaultProvider": "openai",
  "defaultModel": "gpt-4o",
  "temperature": 0.7,
  "maxTokens": 4096,
  "providers": {
    "openai":     { "apiKey": "sk-..." },
    "anthropic":  { "apiKey": "sk-ant-..." },
    "openrouter": { "apiKey": "sk-or-..." }
  }
}
```

### Custom / User Providers

Drop a `.js` file (or a directory with `provider.js`) into `~/.nyteshift/providers/`:

```js
module.exports = {
  id: "my-provider",
  async listModels() {
    return [{ id: "my-model", contextWindow: 4096, maxOutputTokens: 1024 }];
  },
  async call({ model, messages, temperature, maxTokens }) {
    return { output: "response text" };
  },
};
```

User providers load asynchronously after startup. In the UI the `providers:changed` event fires when they are ready. In code, await `whenUserProvidersLoaded()`.

## Skills & Tools

### Skills

Markdown files with YAML frontmatter at `~/.nyteshift/skills/<contributor>/<name>/skill.md`:

```markdown
---
name: web-researcher
version: 1.0.0
contributor: nyteshift
description: Research topics on the web
tags: [research, web]
---

You are a web research specialist. When given a topic...
```

The frontmatter declares metadata; the body is the prompt injected into the LLM.

### Tools

JavaScript modules at `~/.nyteshift/tools/<contributor>/<name>/tool.js`:

```js
module.exports = {
  name: "my-tool",
  version: "1.0.0",
  contributor: "my-name",
  description: "Does something useful",
  spec: {
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
  },
  async run(ctx) {
    return { result: "done" };
  },
};
```

Tools support `config` fields (user-configurable settings), `configAction()` functions (OAuth flows, API key setup), and `dependencies` in a per-tool `package.json` (installed to isolated `node_modules`). The tool loader uses mtime-based caching for hot-reloading without process restart.

---

## Logging

All modules emit structured logs with namespaced prefixes visible in the Electron DevTools console and the terminal.

| Prefix | Source |
|--------|--------|
| `[pipeline:autonomous]` | ReAct loop — step start/end, tool calls, token counts |
| `[providerRouter]` | Provider registration, call routing, user provider scan |
| `[provider:openai]` | Per-call request/response, HTTP errors |
| `[provider:anthropic]` | Per-call request/response, HTTP errors |
| `[provider:openrouter]` | Per-call request/response, HTTP errors |
| `[renderer]` | Forwarded renderer console output (via preload bridge) |

**Log levels:**
- `console.log` — normal operation (step N, response timing, token counts)
- `console.warn` — recoverable issues (skipped user provider, missing optional fields)
- `console.error` — hard failures (missing API key, HTTP errors, tool execution errors)
