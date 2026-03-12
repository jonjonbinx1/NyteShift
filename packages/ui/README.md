# @nyteshift/ui

Electron desktop application for NyteShift — a full-featured GUI for managing agents, triggers, graphs, marketplace content, and real-time agent chat.

## Development

```bash
# From the monorepo root
npm run dev:ui

# Or from the CLI
nyteshift ui launch
```

Launches the Electron app with Vite hot-reload for the renderer process.

## Build

```bash
npm run build:all
```

## Architecture

### Main Process (`src/main/main.ts`)

- Creates a `BrowserWindow` (1200x800 default, custom icon)
- Registers IPC handlers that bridge the renderer to `@nyteshift/core`
- Opens DevTools in dev mode (disable with `NYTESHIFT_DEVTOOLS=false`)
- Forwards renderer console logs to main process terminal

### Preload (`src/main/preload.ts`)

Exposes `window.nyteShiftApi` via Electron's `contextBridge`. All core operations are available as async functions:

- **Agents**: list, create, delete, get/write config
- **Chat**: single-turn LLM call, autonomous ReAct run, cancel, status
- **Config**: read/write global config
- **Soul**: read/write agent personality
- **Skills & Tools**: list installed items
- **Providers**: list providers, list models
- **Marketplace**: sync, browse, install, uninstall, update, configure sources
- **Triggers**: list, create, update, delete, enable/disable, fire, start/stop engine
- **Graphs**: list, load, save, delete, run, abort, real-time execution events

### Tool Action Runner (`src/main/toolActionRunner.ts`)

Child process spawned via `fork()` for executing tool `configAction()` functions in isolation — handles OAuth flows, API key setup, and other long-running tool configuration tasks without blocking the main process.

### Renderer (`src/renderer/`)

React application with React Router, built with Vite.

## Pages

| Page | Route | Description |
|------|-------|-------------|
| Home | `/` | Dashboard with quick stats, setup prompt, and action links |
| Agent List | `/agents` | List, search, create, delete agents |
| Agent Detail | `/agents/:name` | 3-panel layout: chat history, settings/soul editor, real-time chat |
| Triggers | `/triggers` | Trigger definitions + execution history (two tabs) |
| Graphs | `/graphs` | List all graph workflows |
| Graph Builder | `/graphs/:id` | Visual DAG editor with node config panel |
| Graph Runs | `/graph-runs` | Execution history for all graphs |
| Graph Run Detail | `/graph-run/:runId` | Real-time execution viewer with node progress |
| Skills | `/skills` | Browse, configure, update, uninstall skills |
| Tools | `/tools` | Browse, configure, run config actions, update tools |
| Providers | `/providers` | Configure LLM providers, set defaults, API keys |
| Marketplace | `/marketplace` | Browse, search, install, update marketplace content |
| Logs | `/logs` | Log viewer |

## Key Features

### Agent Chat

- **Multi-session**: Multiple persistent chat sessions per agent, surviving navigation
- **Background runs**: Agent tasks continue when navigating away
- **Auto-save**: Debounced writes to disk via IPC
- **Step visualization**: Inspect step-by-step reasoning, tool calls, and sub-agent chains
- **Soul editor**: Edit agent personality (Markdown) inline

### Graph Builder

- **Visual DAG editor**: Drag, pan, zoom with bezier edge curves
- **9 node types**: Input, Output, LLM Call, Agent, Tool, Trigger, Condition, Operation, Catch
- **Node config panel**: Resizable right panel with prompt templates, tool selection, condition builder, error policies
- **Variable interpolation**: `{{variable}}` in prompts resolved from graph inputs and node outputs
- **Graph variables editor**: Key-value pairs for graph-level mutable state
- **JSON editor**: Full graph definition as editable JSON
- **Condition builder**: Visual operator selection (eq, neq, gt, lt, contains, regex, exists, etc.)
- **Error policies**: Configure halt, retry (with backoff), skip, or fallback per node

### Graph Run Viewer

- **Real-time progress**: Live node status updates (pending, running, done, error)
- **Color-coded nodes**: Green = done, Yellow = running, Red = error, Gray = pending
- **Log timeline**: All node events with output and errors
- **Elapsed time and step count** per node

### Trigger Management

- **Rich creation UI**: Schedule builder with presets for cron, daily, weekly, monthly, one-off
- **Discord configuration**: Bot token, guild filter, channel filter, mention-only, trigger/bridge mode
- **Webhook setup**: Path and HMAC-SHA256 secret
- **Engine controls**: Start/stop the trigger engine from the UI
- **Execution history**: View all trigger runs with status, timing, and errors
- **Manual fire**: Invoke any trigger directly from the UI

### Marketplace Browser

- **Category browsing**: Skills, tools, triggers, souls, themes
- **Search**: Filter by name, contributor, or description
- **Install/uninstall** with one click
- **Auto-update**: Per-item or global toggle
- **Source management**: Add, remove, or toggle marketplace repositories

### Theme System

Built on **Catppuccin** color palettes with full customization:

| Built-in Theme | Description |
|----------------|-------------|
| `catppuccin-mocha` | Default warm dark theme |
| `catppuccin-macchiato` | Slightly warmer dark |
| `catppuccin-frappe` | Cool dark theme |
| `catppuccin-latte` | Light theme |

**Custom themes**: Create, edit, and save custom themes via the settings UI with a full 18-color palette editor. Themes are persisted in `~/.nyteshift/config.json`.

Theme colors are injected as CSS custom properties (e.g., `--nyteshift-mauve`) and available throughout the app via React context.

## Components

| Component | Purpose |
|-----------|---------|
| `Sidebar` | Navigation menu with Settings button |
| `ErrorBoundary` | Catch React errors with retry button |
| `AgentSettingsModal` | Agent skills/tools permissions + metadata |
| `CreateAgentModal` | New agent creation form |
| `CreateTriggerModal` | Rich trigger definition UI with schedule builder |
| `GlobalSettingsModal` | Tabs: Providers, Inference, Engine, Discord, Themes, About |
| `GraphCanvas` | Interactive visual graph editor (nodes, edges, bezier curves) |
| `HelperChat` | AI-powered setup assistant (bottom-right corner) |
| `LogViewer` | Monospace log display with timestamps |
| `NodeConfigPanel` | Resizable right panel for editing selected graph node |
| `SchemaForm` | JSON Schema to form UI (handles string, number, object, array) |
| `SkillToolConfigModal` | Skill/tool settings editor (per-agent or global) |
| `ThemeSettingsTab` | Browse, create, edit themes with color picker |
| `VarsEditor` | Modal for editing graph variables (key-value pairs) |

## IPC Channels

All renderer requests are async via `ipcRenderer.invoke()`:

| Category | Channels |
|----------|----------|
| **Agents** | `agents:list`, `agents:create`, `agents:delete`, `agents:config`, `agents:config:write` |
| **Config** | `config:read`, `config:write` |
| **Soul** | `soul:read`, `soul:write` |
| **Skills & Tools** | `skills:list`, `tools:list` |
| **Providers** | `providers:list`, `providers:listModels` |
| **Chat** | `chat:complete` (single-turn LLM call) |
| **Autonomous** | `run:autonomous`, `run:cancel`, `run:status`, `run:clear` |
| **Marketplace** | `marketplace:sync`, `marketplace:browse`, `marketplace:categories`, `marketplace:install`, `marketplace:uninstall`, `marketplace:config:read/write`, `marketplace:source:add/remove/toggle`, `marketplace:installed`, `marketplace:update` |
| **Triggers** | `triggers:list`, `triggers:create`, `triggers:update`, `triggers:delete`, `triggers:enable`, `triggers:disable`, `triggers:fire`, `triggers:engine:start/stop/status`, `triggers:runs` |
| **Graphs** | `graphs:list`, `graphs:load`, `graphs:save`, `graphs:delete`, `graphs:validate`, `graphs:run`, `graphs:runs`, `graphs:run:abort` |

**Broadcast events** (main -> renderer):
- `run:completed` — Agent task finished
- `tools:changed` — Tools list updated after marketplace action
- `providers:changed` — Provider list updated
- `graph:node:start`, `graph:node:complete`, `graph:run:complete` — Real-time graph execution events

## State Management

`ChatStore` (React Context) manages:
- Chat session persistence across navigation
- Background agent runs
- Debounced auto-save to disk
- Per-agent/session message tracking
- Run state tracking (which agents are currently running)
