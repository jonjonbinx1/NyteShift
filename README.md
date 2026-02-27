# SolixAI

An agentic platform with autonomous and triggered execution modes.

## Overview

SolixAI lets you create **agents** that can:

- **Autonomous mode** — Given a task, the agent plans and executes using skills and tools.
- **Triggered mode** — When an event occurs (cron, email, webhook, etc.), run a pre-configured pipeline.

### Concepts

| Concept      | Description |
|-------------|-------------|
| **Skills**   | Markdown prompt files with YAML frontmatter (`~/.solix/skills`) |
| **Tools**    | JS/TS modules that perform concrete actions (`~/.solix/tools`) |
| **Providers**| LLM backends — OpenAI, Anthropic, OpenRouter (built-in) |
| **Soul.md**  | Per-agent system prompt injected into every conversation |
| **Triggers** | Event-driven pipeline starters (`~/.solix/triggers`) |

## Monorepo Structure

```
SolixAI/
├── packages/
│   ├── core/      — Runtime: skills, tools, providers, pipelines, config
│   ├── cli/       — CLI (`solix` command)
│   └── ui/        — Electron desktop app
├── package.json
├── tsconfig.base.json
└── pnpm-workspace.yaml
```

## Getting Started

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9

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
pnpm install     # or npm install when using npm workspaces
pnpm build
```

### CLI

```bash
# Create an agent
pnpm --filter @solix/cli exec solix agent create my-agent

# List agents
pnpm --filter @solix/cli exec solix agent list

# Run a task
pnpm --filter @solix/cli exec solix agent run my-agent "Summarize the latest news"

# Show config
pnpm --filter @solix/cli exec solix config show
```

### Electron UI

```bash
pnpm --filter @solix/ui dev
```

## User-Level Storage

All runtime content lives under `~/.solix/`:

```
~/.solix/
├── config.json
├── agents/<name>/
│   ├── config.json
│   └── soul.md
├── skills/<contributor>/<skill-name>/skill.md
├── tools/<contributor>/<tool-name>/tool.js
└── triggers/<trigger-name>/trigger.js
```

## Marketplace

Marketplace content (skills, tools, themes, triggers, soul templates) lives in a separate repository: **SolixAI-Marketplace**. Use `solix marketplace sync` to pull content into your local `~/.solix` directory.

## License

MIT
