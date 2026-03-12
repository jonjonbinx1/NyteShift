# NyteShift

An agentic AI platform with autonomous reasoning, event-driven triggers, visual graph workflows, and a full-featured desktop UI.

## Overview

NyteShift lets you create **AI agents** that reason, plan, and act using LLMs, tools, and skills. Agents can run autonomously via a ReAct loop, respond to scheduled or external events through triggers, or execute complex multi-step workflows as directed graphs.

### Core Capabilities

- **Autonomous Mode (ReAct Loop)** — Give an agent a task; it reasons step-by-step, calls tools, and delivers a final answer. Follows Anthropic's recommended agentic patterns.
- **Triggered Mode** — Run pre-configured pipelines in response to cron schedules, webhooks, Discord messages, one-off timers, or monthly recurrences.
- **Graph Workflows** — Build directed execution graphs with branching, looping, condition nodes, error policies, and real-time progress tracking.
- **Sub-Agent Delegation** — Agents can spawn other agents as tool calls (orchestrator-workers pattern) with bounded recursion.
- **Persistent Memory & Plans** — Agents store knowledge across sessions and checkpoint long-running tasks with rolling summarization.
- **Marketplace** — Install community skills, tools, themes, and triggers from GitHub-hosted repositories.
- **Discord Integration** — Bridge Discord channels to agents for stateless triggers or persistent multi-turn conversations.

### Concepts

| Concept | Description |
|---------|-------------|
| **Agents** | Named AI identities with isolated config, personality, memory, and chat history |
| **Skills** | Markdown prompt files with YAML frontmatter — instructions for the LLM (`~/.nyteshift/skills/`) |
| **Tools** | JS/TS modules that perform concrete actions — file I/O, API calls, etc. (`~/.nyteshift/tools/`) |
| **Providers** | LLM backends — OpenAI, Anthropic, OpenRouter built-in; custom providers pluggable |
| **Soul.md** | Per-agent personality/system prompt injected into every conversation |
| **Triggers** | Event-driven pipeline starters — cron, webhook, Discord, monthly, one-off, manual |
| **Graphs** | Visual DAG workflows with input/output/LLM/agent/tool/condition/operation/catch nodes |
| **Memory** | Persistent agent-scoped key-value store (external to context window) |
| **Plans** | Structured checkpoints for long-running tasks with rolling summarization |
| **Sub-Agents** | Depth-bounded delegation — agents can spawn other agents as tool calls |

## Architecture

```
NyteShift/
├── packages/
│   ├── core/      — Runtime engine: pipelines, agents, providers, tools, skills,
│   │                memory, plans, triggers, graphs, marketplace, Discord bridge
│   ├── cli/       — CLI interface (`nyteshift` command)
│   └── ui/        — Electron + React desktop application
├── scripts/       — Dev & migration utilities
├── package.json   — npm workspaces root
└── tsconfig.base.json
```

### How the Pieces Fit Together

```
┌──────────────────────────────────────────────────┐
│              User Interfaces                     │
│                                                  │
│   ┌──────────────┐       ┌─────────────────┐     │
│   │   CLI        │       │   Electron UI   │     │
│   │  (Commander) │       │  (React/Vite)   │     │
│   └──────┬───────┘       └────────┬────────┘     │
│          │                   IPC  │              │
└──────────┼────────────────────────┼──────────────┘
           │                        │
           └───────────┬────────────┘
                       │
           ┌───────────▼───────────┐
           │    @nyteshift/core    │
           │                       │
           │  ┌─────────────────┐  │
           │  │ Pipeline Engine │  │
           │  │ (ReAct Loop)    │  │
           │  └────────┬────────┘  │
           │           │           │
           │  ┌────────▼────────┐  │
           │  │ Provider Router │  │
           │  │ (LLM Backends)  │  │
           │  └─────────────────┘  │
           │                       │
           │  Skills · Tools ·     │
           │  Memory · Plans ·     │
           │  Triggers · Graphs ·  │
           │  Agents · Discord     │
           └───────────────────────┘
```

## Getting Started

### Prerequisites

- Node.js ≥ 20
- An API key for at least one LLM provider (OpenAI, Anthropic, or OpenRouter)

### Install & Build

Bootstrap the workspace with a single script — it installs dependencies, compiles every package, and makes the `nyteshift` CLI available globally:

```bash
# macOS / Linux
./install.sh

# Windows PowerShell
.\install.ps1
```

Or manually:

```bash
npm install
npm run build
```

### Configure a Provider

```bash
nyteshift config show   # view current config
```

Edit `~/.nyteshift/config.json` to add your API key:

```json
{
  "defaultProvider": "openai",
  "defaultModel": "gpt-4o",
  "providers": {
    "openai": { "apiKey": "sk-..." }
  }
}
```

### CLI Quick Start

```bash
# Create an agent
nyteshift agent create my-agent

# List agents
nyteshift agent list

# Run an autonomous task
nyteshift agent run my-agent "Summarize the latest news"

# Manage triggers
nyteshift triggers list
nyteshift triggers create -n daily-digest -a my-agent -t cron -s "0 9 * * *" --task "Summarize overnight emails"

# Browse & install marketplace content
nyteshift marketplace sync
nyteshift marketplace list
nyteshift marketplace install skills/nyteshift/web-researcher
```

### Electron UI

```bash
npm run dev:ui
# or
nyteshift ui launch
```

The desktop app provides a full visual interface for all functionality: agent chat, trigger management, graph builder, marketplace browser, provider configuration, and more.

## User-Level Storage

All runtime data lives under `~/.nyteshift/`:

```
~/.nyteshift/
├── config.json                           # Global configuration
├── installed.json                        # Marketplace install index
├── marketplace.json                      # Marketplace source config
├── agents/<name>/
│   ├── config.json                       # Agent settings (provider, model, skills, tools)
│   ├── soul.md                           # Agent personality / system prompt
│   ├── triggers.json                     # Agent-specific trigger definitions
│   ├── discord-bridge.json               # Discord integration config
│   ├── chats/                            # Persistent chat sessions
│   │   ├── <session-id>.json
│   │   └── archived/                     # Soft-deleted sessions
│   ├── memory/                           # Persistent key-value knowledge store
│   │   └── <key>.json
│   └── plans/                            # Task checkpoints & summaries
│       └── <plan-id>.json
├── skills/<contributor>/<name>/skill.md  # Installed skills
├── tools/<contributor>/<name>/tool.js    # Installed tools
├── providers/<name>.js                   # Custom LLM providers
└── graphs/<id>.json                      # Saved graph workflows
```

## Providers

Three providers are built-in:

| Provider | API | Environment Variable |
|----------|-----|---------------------|
| OpenAI | OpenAI Chat Completions | `OPENAI_API_KEY` |
| Anthropic | Anthropic Messages API | `ANTHROPIC_API_KEY` |
| OpenRouter | OpenAI-compatible via openrouter.ai | `OPENROUTER_API_KEY` |

**Custom providers** — drop a `.js` file into `~/.nyteshift/providers/`:

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

## Marketplace

Marketplace content (skills, tools, themes, triggers, soul templates) lives in a separate repository: **NyteShift-Marketplace**. Content is fetched via the GitHub API — no local cloning required.

```bash
# Sync marketplace index
nyteshift marketplace sync

# Browse available items
nyteshift marketplace list
nyteshift marketplace list -c skills --search "research"

# Install / uninstall
nyteshift marketplace install skills/nyteshift/web-researcher
nyteshift marketplace uninstall skills/nyteshift/web-researcher

# Manage sources
nyteshift marketplace sources list
nyteshift marketplace sources add my-marketplace https://github.com/user/repo.git

# Auto-updates
nyteshift marketplace update                                    # check all
nyteshift marketplace update skills/nyteshift/web-researcher    # check one
nyteshift marketplace auto global on                            # enable auto-updates
nyteshift marketplace auto skills/nyteshift/web-researcher off  # disable for one item
```

## Trigger System

Triggers connect external events to agent tasks. Supported types:

| Type | Description | Example |
|------|-------------|---------|
| `cron` | Interval or cron expression | `"5m"`, `"0 9 * * 1"` |
| `webhook` | HTTP POST to local server (port 7433) | `/hooks/my-agent` |
| `discord` | Discord message (trigger or bridge mode) | Bot token + channel filter |
| `monthly` | Day-of-month or ordinal weekday | `15` or `"first Monday"` |
| `oneoff` | Single execution at a specific time | ISO timestamp or Unix ms |
| `manual` | Fired manually from CLI or UI | — |

Task templates support `{{payload}}` interpolation with event data.

## Graph Workflows

Graphs define multi-step execution pipelines as directed acyclic graphs with support for condition-guarded loops:

- **Node types**: Input, Output, LLM Call, Agent (full ReAct), Tool, Condition, Operation, Catch, Trigger
- **Condition operators**: `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `contains`, `starts_with`, `ends_with`, `matches`, `exists`
- **Error policies**: halt, retry (with backoff), skip, fallback
- **Cycle detection**: Tarjan's SCC algorithm — loops allowed only when guarded by condition nodes with exit branches
- **Real-time tracking**: Graph run registry with node-level progress events

The Electron UI includes a full visual graph builder with drag-and-drop nodes, bezier edge routing, and live execution monitoring.

## License

MIT
