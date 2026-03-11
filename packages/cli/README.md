# @nyteshift/cli

Command-line interface for NyteShift.

## Installation

```bash
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

### Configuration

```bash
# Show global config
nyteshift config show
```

### Marketplace

```bash
# Sync marketplace content into ~/.nyteshift
nyteshift marketplace sync
```

### Triggers

```bash
# List available triggers
nyteshift triggers list

# Manually fire a trigger
nyteshift triggers run <name>
```

## Options

`nyteshift agent run` supports:

| Flag | Description |
|------|-------------|
| `-p, --provider <id>` | Override the provider |
| `-m, --model <id>` | Override the model |
| `--max-steps <n>` | Maximum pipeline steps (default: 10) |
