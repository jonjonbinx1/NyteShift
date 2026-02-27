#!/usr/bin/env bash
# bootstrap the SolixAI workspace for a fresh clone.
# installs pnpm if missing, runs the workspace install/build, and links the CLI.

set -e

# ensure we run from repo root
cd "$(dirname "$0")"

# pick package manager: prefer pnpm, fall back to npm
if command -v pnpm >/dev/null 2>&1; then
  PM=pnpm
elif command -v npm >/dev/null 2>&1; then
  PM=npm
else
  echo "Error: neither pnpm nor npm is installed. Please install Node.js (which includes npm)." >&2
  exit 1
fi

if [ "$PM" = "pnpm" ]; then
  # ensure PNPM_HOME/global bin exists
  BIN=$(pnpm config get global-bin-dir 2>/dev/null || echo)
  if [ -z "$BIN" ] || [ "$BIN" = "undefined" ]; then
    DEFAULT="$HOME/.local/share/pnpm"
    echo "PNPM global bin not configured; defaulting to $DEFAULT"
    export PNPM_HOME="$DEFAULT"
    if ! grep -q "PNPM_HOME" ~/.profile 2>/dev/null; then
      echo "export PNPM_HOME=\"$DEFAULT\"" >> ~/.profile
      echo "Added PNPM_HOME to ~/.profile (restart shell to persist)."
    fi
  fi

  # run setup to create directory
  if ! pnpm setup; then
    echo "\nWarning: failed to configure pnpm global bin dir."
    echo "You may need to set PNPM_HOME and add it to your PATH manually."
    echo "Example (bash/zsh): export PNPM_HOME=\"\$HOME/.local/share/pnpm\""
  fi
fi

# install workspaces
$PM install

# build all packages
$PM run build

# link CLI globally if using pnpm
if [ "$PM" = "pnpm" ]; then
  cd packages/cli
  pnpm link -g
  echo "\nThe 'solix' command is now available globally."
else
  echo "\nIf you want 'solix' globally run (from packages/cli):"
  echo "  npm install -g ."
fi

echo "Bootstrap complete. Try 'solix agent list' or open the Electron UI via 'pnpm --filter @solix/ui dev'."
