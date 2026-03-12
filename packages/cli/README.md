# @nyteshift/cli

Command-line interface for NyteShift — manage agents, triggers, marketplace content, and launch the desktop UI.

## Installation

```bash
# From the monorepo root (installs + links CLI globally)
./install.sh      # macOS/Linux
.\install.ps1     # Windows PowerShell

# Or manually
npm install
npm run build
```

After building, the `nyteshift` binary is available at `packages/cli/bin/nyteshift`.

## Commands

### Agent Management

```bash
# Create a new agent
nyteshift agent create <name>

# List all agents
nyteshift agent list

# Run an autonomous task
nyteshift agent run <name> "<task>"

# Delete an agent
nyteshift agent delete <name>
```

**`agent run` options:**

| Flag | Description |
|------|-------------|
| `-p, --provider <id>` | Override the LLM provider |
| `-m, --model <id>` | Override the model |
| `--max-steps <n>` | Maximum pipeline steps (default: 10) |

### Configuration

```bash
# Show global config (JSON)
nyteshift config show
```

### Marketplace

```bash
# Sync all marketplace sources
nyteshift marketplace sync

# List marketplace items (with optional filters)
nyteshift marketplace list
nyteshift marketplace list -c skills
nyteshift marketplace list --search "web"

# List available categories
nyteshift marketplace categories

# Install an item by path
nyteshift marketplace install <category>/<contributor>/<name>

# Manage marketplace sources
nyteshift marketplace sources list
nyteshift marketplace sources add <name> <url> [-b branch]
nyteshift marketplace sources remove <name>

# Check for / apply updates
nyteshift marketplace update                              # all items
nyteshift marketplace update <category/contributor/name>  # single item

# Toggle auto-updates
nyteshift marketplace auto global on
nyteshift marketplace auto <category/contributor/name> off
```

### Triggers

```bash
# List all trigger definitions
nyteshift triggers list
nyteshift triggers list -a <agent>

# Create a new trigger
nyteshift triggers create \
  -n <name> \
  -a <agent> \
  -t <type> \
  --task "<template>"

# Delete / enable / disable a trigger
nyteshift triggers delete <id>
nyteshift triggers enable <id>
nyteshift triggers disable <id>
```

**`triggers create` options:**

| Flag | Description |
|------|-------------|
| `-n, --name <name>` | Trigger name |
| `-a, --agent <name>` | Target agent |
| `-t, --type <type>` | `cron`, `webhook`, `manual`, `discord`, `oneoff`, `monthly` |
| `--task <template>` | Task template (supports `{{payload}}`) |
| `-s, --schedule <expr>` | Cron expression or interval (`5m`, `1h`, `0 9 * * 1`) |
| `--run-at <time>` | ISO timestamp or Unix ms (for oneoff) |
| `--webhook-path <path>` | Webhook URL path (e.g., `/hooks/my-agent`) |
| `--webhook-secret <s>` | HMAC-SHA256 secret for webhook validation |
| `--discord-token <tok>` | Discord bot token |
| `--discord-guild <id>` | Restrict to a specific guild |
| `--discord-channels <ids>` | Comma-separated channel IDs |
| `--mention-only` | Only respond when @mentioned |
| `--discord-mode <mode>` | `trigger` (stateless) or `bridge` (persistent chat) |
| `-p, --provider <id>` | Override LLM provider |
| `-m, --model <id>` | Override model |
| `--max-steps <n>` | Max autonomous steps |

### UI

```bash
# Launch the Electron desktop app
nyteshift ui launch
```

Auto-detects dev vs. production mode. In dev, runs with Vite HMR; in production, runs the compiled build.

## Examples

```bash
# Create an agent and run a task
nyteshift agent create researcher
nyteshift agent run researcher "Find the top 5 trending AI papers this week"

# Set up a daily cron trigger
nyteshift triggers create \
  -n morning-news \
  -a researcher \
  -t cron \
  -s "0 9 * * *" \
  --task "Summarize the top tech news from today"

# Install a skill from the marketplace
nyteshift marketplace sync
nyteshift marketplace install skills/nyteshift/web-researcher

# Launch the UI
nyteshift ui launch
```
