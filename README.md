# NyteShift

An agentic platform with autonomous and triggered execution modes.

## Overview

NyteShift lets you create **agents** that can:

- **Autonomous mode** — Given a task, the agent plans and executes using skills and tools.
- **Triggered mode** — When an event occurs (cron, email, webhook, etc.), run a pre-configured pipeline.

### Concepts

| Concept      | Description |
|-------------|-------------|
| **Skills**   | Markdown prompt files with YAML frontmatter (`~/.nyteshift/skills`) |
| **Tools**    | JS/TS modules that perform concrete actions (`~/.nyteshift/tools`) |
| **Providers**| LLM backends — OpenAI, Anthropic, OpenRouter (built-in) |
| **Soul.md**  | Per-agent system prompt injected into every conversation |
| **Triggers** | Event-driven pipeline starters (`~/.nyteshift/triggers`) |
| **Sub-Agents** | Orchestrator-workers delegation — agents can spawn other agents as tool calls |

## Monorepo Structure

```
NyteShift/
├── packages/
│   ├── core/      — Runtime: skills, tools, providers, pipelines, config
│   ├── cli/       — CLI (`solix` command)
│   └── ui/        — Electron desktop app
├── package.json   — npm workspaces root
└── tsconfig.base.json
```

## Getting Started

### Prerequisites

- Node.js ≥ 20

### Install & Build

You can bootstrap the workspace with a single script (handles pnpm/npm and
links the CLI):

```bash
# on macOS/Linux
./install.sh

# on Windows PowerShell
.\install.ps1
```

This will install dependencies, compile every package, and make the `solix`
command available globally. If you prefer manual steps, the commands below
also work:

```bash
npm install
npm run build
```

### CLI

```bash
# Create an agent
nyteshift agent create my-agent

# List agents
nyteshift agent list

# Run a task
nyteshift agent run my-agent "Summarize the latest news"

# Show config
nyteshift config show
```

### Electron UI

```bash
npm run dev:ui
```

## User-Level Storage

All runtime content lives under `~/.nyteshift/`:

```
~/.nyteshift/
├── config.json
├── agents/<name>/
│   ├── config.json
│   └── soul.md
├── skills/<contributor>/<skill-name>/skill.md
├── tools/<contributor>/<tool-name>/tool.js
└── triggers/<trigger-name>/trigger.js
```

## Marketplace

Marketplace content (skills, tools, themes, triggers, soul templates) lives in a separate repository: **NyteShift-Marketplace**. Use `nyteshift marketplace sync` to pull content into your local `~/.nyteshift` directory.

You can manage updates via the CLI:

- `nyteshift marketplace update [<category>/<contributor>/<name>]` – check for or apply updates to installed items. Running without a path scans all installed items.
- `nyteshift marketplace auto <global|category/contributor/name> <on|off>` – enable or disable automatic updates globally or for a specific item. Global setting is also persisted to your user config.

## License

MIT
