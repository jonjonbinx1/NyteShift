# @solix/core

The SolixAI core runtime — skills, tools, providers, pipelines, config, and control.

## Public API

```ts
import {
  // Pipeline
  runAutonomousTask,
  runTriggeredPipeline,

  // Agents
  listAgents,
  createAgent,
  deleteAgent,
  loadAgentConfig,

  // Skills & Tools
  listSkills,
  listTools,

  // Providers
  listProviders,
  callProvider,
  callDefaultProvider,
  listAllModels,

  // Config
  resolveConfig,
  readGlobalConfig,
  writeGlobalConfig,

  // Soul
  readSoul,
  writeSoul,

  // Triggers
  listTriggers,
  fireTrigger,

  // Control
  AgentController,
} from "@solix/core";
```

## Runtime Components

| Module | Description |
|--------|-------------|
| `SkillLoader` | Scans `~/.solix/skills`, parses YAML frontmatter |
| `ToolLoader` | Scans `~/.solix/tools`, dynamically imports ESM modules |
| `ProviderRouter` | Manages built-in + user providers; exposes `whenUserProvidersLoaded()` |
| `ConfigResolver` | Merges global → user → agent configs with security overrides |
| `SoulInjector` | Loads `soul.md` and injects it as a system prompt |
| `AgentManager` | CRUD operations on agents |
| `AgentController` | AbortController-based cancel/stop mechanism |
| `Pipeline (autonomous)` | **ReAct loop** — Reason → Act (tool call or final answer) → Observe → repeat |
| `Pipeline (triggered)` | Sequential step execution on events |

## Autonomous Pipeline — ReAct Loop

The autonomous pipeline implements the **ReAct (Reason + Act)** framework—the standard agentic pattern recommended by Anthropic and OpenAI.

```
User task
  │
  ▼
[System prompt] + [Soul.md] + [User message]
  │
  ▼
┌─────────────────────────────────────────────┐
│  LLM call (provider/model)  ◄──────────────────▐
└──────────────────────────────────────────────┘    │
  │                                          │
  ├─ <tool_call> detected? ─► execute tool ──┘
  │                        inject <tool_result>
  ├─ <final_answer> detected? ─► return output
  │
  └─ raw text (no tags)? ─► return as final answer
```

### LLM Response Protocol

The system prompt instructs the model to use one of two structured formats:

**Tool call:**
```xml
<tool_call>
{ "name": "tool_name", "input": { "param": "value" } }
</tool_call>
```
The runtime finds the tool by `name` or `contributor/name`, executes it, and injects the result as:
```xml
<tool_result>
...tool output...
</tool_result>
```

**Final answer:**
```xml
<final_answer>
Your complete answer here.
</final_answer>
```

If neither tag appears the full response is treated as the final answer (graceful fallback).

### Loop Termination

| Condition | Behaviour |
|-----------|----------|
| `<final_answer>` in output | Return `finalOutput`, end loop |
| Raw text, no tags | Treat as final answer, end loop |
| `maxSteps` exhausted | Use last assistant message |
| `AbortSignal` fires | Set `aborted: true`, end loop |
| Provider error | Surface error message in `finalOutput` |

---

## Providers

Three providers ship built-in:

| Provider ID | Platform | Env var |
|-------------|----------|---------|
| `openai` | OpenAI API | `OPENAI_API_KEY` |
| `anthropic` | Anthropic Messages API | `ANTHROPIC_API_KEY` |
| `openrouter` | OpenRouter (OpenAI-compatible) | `OPENROUTER_API_KEY` |

Configure via `~/.solix/config.json`:

```json
{
  "defaultProvider": "openai",
  "defaultModel": "gpt-4o",
  "temperature": 0.7,
  "maxTokens": 4096,
  "providers": {
    "openai":     { "apiKey": "sk-..." },
    "anthropic":  { "apiKey": "sk-ant-..." },
    "openrouter": { "apiKey": "sk-or-..." }
  }
}
```

### Custom / User Providers

Drop a `.js` file (or a directory with `provider.js`) into `~/.solix/providers/`.
It must export an object conforming to `SolixProvider`:

```js
// ~/.solix/providers/my-provider.js
module.exports = {
  id: "my-provider",
  async listModels() {
    return [{ id: "my-model", contextWindow: 4096, maxOutputTokens: 1024 }];
  },
  async call({ model, messages, temperature, maxTokens }) {
    // call your local / custom inference endpoint
    return { output: "response text" };
  },
};
```

User providers load asynchronously after startup. In the UI the `providers:changed`
IPC event fires when they are ready. In Node code await `whenUserProvidersLoaded()`.

---

## Logging

All modules emit structured logs with namespaced prefixes visible in the Electron
DevTools console and the terminal where `solix ui launch` is running.

| Prefix | Source |
|--------|--------|
| `[pipeline:autonomous]` | ReAct loop — step start/end, tool calls, token counts |
| `[providerRouter]` | Provider registration, call routing, user provider scan |
| `[provider:openai]` | Per-call request/response, HTTP errors |
| `[provider:anthropic]` | Per-call request/response, HTTP errors |
| `[provider:openrouter]` | Per-call request/response, HTTP errors |
| `[renderer]` | Forwarded renderer console output (via preload bridge) |

**Log levels:**
- `console.log` — normal operation (step N, response timing, token counts)
- `console.warn` — recoverable issues (skipped user provider, missing optional fields)
- `console.error` — hard failures (missing API key, HTTP errors, tool execution errors)
