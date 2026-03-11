#!/usr/bin/env bash
# Bootstrap the NyteShift workspace for a fresh clone.
# Uses npm workspaces — no pnpm required.

set -e

# ensure we run from repo root
cd "$(dirname "$0")"

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed. Please install Node.js from https://nodejs.org" >&2
  exit 1
fi

echo "Installing dependencies..."
npm install

echo "Building all packages..."
npm run build

echo ""
echo "Linking CLI globally..."
cd packages/cli
npm install -g .
cd ../..

echo ""
echo "The 'nyteshift' command is now available globally."
echo "Bootstrap complete. Try 'nyteshift agent list' or open the Electron UI via 'npm run dev:ui'."
