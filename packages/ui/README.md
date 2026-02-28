# @solix/ui

Electron desktop application for SolixAI.

## Development

```bash
npm install
npm run dev:ui
```

This launches the Electron app with Vite hot-reload for the renderer process.

## Build

```bash
npm run build:all
```

## Architecture

### Main Process (`src/main/main.ts`)

- Creates a `BrowserWindow`
- Registers IPC handlers that bridge the renderer to `@solix/core`

### Preload (`src/main/preload.ts`)

- Exposes `window.solixApi` via `contextBridge`
- All core operations are available as async functions

### Renderer (`src/renderer/`)

React application with the following pages:

| Page | Route | Description |
|------|-------|-------------|
| Agent List | `/agents` | List, create, delete agents |
| Agent Detail | `/agents/:name` | View config, edit Soul.md, run tasks |
| Skill List | `/skills` | Browse installed skills |
| Tool List | `/tools` | Browse installed tools |
| Provider Config | `/providers` | View providers, edit global config |
| Logs | `/logs` | Real-time log viewer |

### IPC Channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `agents:list` | renderer → main | List all agents |
| `agents:create` | renderer → main | Create an agent |
| `agents:delete` | renderer → main | Delete an agent |
| `agents:config` | renderer → main | Read agent config |
| `config:read` | renderer → main | Read global config |
| `config:write` | renderer → main | Write global config |
| `soul:read` | renderer → main | Read Soul.md |
| `soul:write` | renderer → main | Write Soul.md |
| `skills:list` | renderer → main | List installed skills |
| `tools:list` | renderer → main | List installed tools |
| `providers:list` | renderer → main | List providers |
| `run:autonomous` | renderer → main | Run an autonomous task |
