# @solix/cli

Command-line interface for SolixAI.

## Installation

```bash
npm install
npm run build
```

After building, the `solix` binary is available at `packages/cli/bin/solix`.

## Commands

### Agent Management

```bash
# Create a new agent
solix agent create <name>

# List all agents
solix agent list

# Run an autonomous task
solix agent run <name> "<task>"

# Delete an agent
solix agent delete <name>
```

### Configuration

```bash
# Show global config
solix config show
```

### Marketplace

```bash
# Sync marketplace content into ~/.solix
solix marketplace sync
```

### Triggers

```bash
# List available triggers
solix triggers list

# Manually fire a trigger
solix triggers run <name>
```

## Options

`solix agent run` supports:

| Flag | Description |
|------|-------------|
| `-p, --provider <id>` | Override the provider |
| `-m, --model <id>` | Override the model |
| `--max-steps <n>` | Maximum pipeline steps (default: 10) |
