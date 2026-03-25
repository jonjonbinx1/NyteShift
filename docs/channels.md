# NyteShift Channels — Messaging Adapter System

Channels are the standard way to connect NyteShift agents to external messaging platforms. They provide a consistent, pluggable interface for receiving messages from and sending replies to Discord, Slack, Facebook Messenger, WhatsApp, Telegram, and any other messaging service.

## Terminology

| Term | Definition |
|------|-----------|
| **Channel** | A marketplace-installable adapter that bridges a messaging platform to NyteShift agents. |
| **ChannelContract** | The TypeScript interface every channel adapter must implement (see below). |
| **ChannelMessage** | A normalised inbound message — identical shape regardless of source platform. |
| **ChannelReply** | A normalised outbound reply sent back through the adapter. |

> **Why "channels"?** We use the term _channel_ (not "bridge", "connector", or "input") consistently across the codebase — in types, CLI commands, UI, marketplace categories, and disk layout.

---

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Messaging       │     │  Channel Adapter  │     │  NyteShift Agent │
│  Platform        │────▶│  (channel.js)     │────▶│  (ReAct pipeline) │
│  (Slack, FB, …)  │◀────│                   │◀────│                   │
└─────────────────┘     └──────────────────┘     └──────────────────┘
       webhook/WS            ChannelMessage           runAutonomousTask()
                              ChannelReply
```

1. The messaging platform sends events (webhooks, WebSocket, etc.) to the channel adapter.
2. The adapter normalises each event into a `ChannelMessage` and calls the `onMessage` callback.
3. The trigger engine routes the message to the agent via `runAutonomousTask()`.
4. The agent's reply is sent back through the adapter's `send()` method.

---

## Disk Layout

Channels are stored identically to tools and skills:

```
~/.nyteshift/
  channels/
    <contributor>/
      <channel-name>/
        channel.js        # Required — default-exports a ChannelContract
        package.json      # Optional — npm dependencies (isolated node_modules)
        README.md         # Optional — shown in marketplace UI
        node_modules/     # Auto-installed from package.json
        .deps-lock        # Dependency hash (auto-managed)
```

The built-in Discord bridge ships with the product. All other channels are installed from the marketplace under the **channels** category.

---

## The `ChannelContract` Interface

Every channel adapter must default-export an object implementing this interface:

```typescript
interface ChannelContract {
  /** Human-readable name (e.g. "facebook-messenger", "slack"). */
  name: string;
  /** SemVer version. */
  version: string;
  /** Author / org name. */
  contributor: string;
  /** Short description for UI / marketplace. */
  description: string;

  /** Configurable fields (bot tokens, webhook URLs, secrets, etc.). */
  config?: ConfigFieldDefinition[];

  /** Optional handler for "action"-type config fields (e.g. OAuth). */
  configAction?(key: string): Promise<unknown>;

  /** Start listening for inbound messages. */
  start(
    onMessage: (msg: ChannelMessage) => void | Promise<void>,
    config: Record<string, unknown>,
  ): Promise<void>;

  /** Send a reply back through the channel. */
  send(reply: ChannelReply, config: Record<string, unknown>): Promise<void>;

  /** Gracefully disconnect / clean up. */
  stop(): Promise<void>;
}
```

### `ChannelMessage` — Normalised Inbound Message

```typescript
interface ChannelMessage {
  channel: string;              // e.g. "facebook-messenger"
  conversationId: string;       // Platform-specific thread/conversation ID
  messageId: string;            // Unique message ID (for dedup)
  userId: string;               // Sender ID
  userName?: string;            // Display name
  text: string;                 // Plain text content
  attachments?: ChannelAttachment[];
  timestamp: number;            // Unix ms
  metadata?: Record<string, unknown>;  // Platform-specific extras
}
```

### `ChannelReply` — Normalised Outbound Reply

```typescript
interface ChannelReply {
  conversationId: string;       // Same as the inbound conversationId
  text: string;                 // Plain text reply
  richPayload?: Record<string, unknown>;  // Platform-specific extras
}
```

### `ConfigFieldDefinition` — Config Fields

Config fields are rendered automatically by the NyteShift UI. Supported types:

| Type | Rendered As |
|------|------------|
| `string` | Text input |
| `secret` | Password input (stored in secret store) |
| `number` | Number input with min/max/step |
| `boolean` | Checkbox |
| `select` | Dropdown |
| `multiselect` | Multi-select |
| `textarea` | Multi-line text |
| `action` | Button (triggers `configAction()`) |

---

## Creating a Channel Adapter

### Step 1: Create the Directory

```
channels/
  your-name/
    my-platform/
      channel.js
      package.json    # only if you need npm dependencies
      README.md
```

### Step 2: Implement `channel.js`

```javascript
import { createServer } from "node:http";

const channel = {
  name: "my-platform",
  version: "1.0.0",
  contributor: "your-name",
  description: "Connect NyteShift agents to My Platform.",

  config: [
    {
      key: "apiToken",
      label: "API Token",
      type: "secret",
      required: true,
      description: "Bot token from the My Platform dashboard.",
    },
    {
      key: "webhookPort",
      label: "Webhook Port",
      type: "number",
      default: 7460,
      min: 1024,
      max: 65535,
    },
  ],

  _server: null,

  async start(onMessage, config) {
    const port = Number(config.webhookPort) || 7460;

    this._server = createServer(async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }

      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

      // Normalise to ChannelMessage
      await onMessage({
        channel: "my-platform",
        conversationId: body.chat_id,
        messageId: body.message_id,
        userId: body.sender_id,
        userName: body.sender_name,
        text: body.text,
        timestamp: Date.now(),
      });

      res.writeHead(200);
      res.end("OK");
    });

    await new Promise((resolve) => this._server.listen(port, resolve));
    console.log(`[my-platform] Listening on port ${port}`);
  },

  async send(reply, config) {
    await fetch("https://api.myplatform.com/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiToken}`,
      },
      body: JSON.stringify({
        chat_id: reply.conversationId,
        text: reply.text,
      }),
    });
  },

  async stop() {
    if (this._server) {
      await new Promise((resolve) => this._server.close(resolve));
      this._server = null;
    }
  },
};

export default channel;
```

### Step 3: Publish to Marketplace

Push to a marketplace-compatible GitHub repository:

```
channels/
  your-name/
    my-platform/
      channel.js
      package.json
      README.md
```

Users install it with:

```bash
nyteshift marketplace install channels/your-name/my-platform
```

---

## Using Channels

### Via CLI

```bash
# List installed channel adapters
nyteshift channels list

# Inspect a specific channel
nyteshift channels inspect nyteshift/facebook-messenger

# Create a trigger using a channel adapter
nyteshift triggers create \
  --name "fb-support" \
  --agent support-bot \
  --type channel \
  --channel-name nyteshift/facebook-messenger \
  --channel-mode trigger \
  --task "A customer sent: {{payload.text}}\n\nRespond helpfully."

# Set channel secrets
nyteshift secret set channel:nyteshift/facebook-messenger:pageAccessToken <token>
nyteshift secret set channel:nyteshift/facebook-messenger:appSecret <secret>
```

### Via UI

1. Go to **Triggers** → **Create Trigger**
2. Select **Channel** as the trigger type
3. Choose the installed channel adapter from the dropdown
4. Select **Trigger** or **Chat Bridge** mode
5. Configure the task template and agent settings
6. Set required secrets via **Marketplace** → channel adapter → **Settings**

---

## Channel Trigger Modes

| Mode | Behaviour |
|------|-----------|
| **Trigger** | Each inbound message spawns an independent autonomous agent run. No memory between messages. |
| **Bridge** | The channel acts as a persistent chat proxy. Full conversation history is maintained across messages. |

---

## How Marketplace Categories Map

| Category | Disk Path | Entry File | Contract |
|----------|-----------|-----------|----------|
| `skills` | `~/.nyteshift/skills/<c>/<n>/` | `skill.md` | YAML frontmatter |
| `tools` | `~/.nyteshift/tools/<c>/<n>/` | `tool.js` | `ToolContract` |
| `channels` | `~/.nyteshift/channels/<c>/<n>/` | `channel.js` | `ChannelContract` |
| `triggers` | `~/.nyteshift/triggers/` | N/A | `TriggerDefinition` |
| `souls` | `~/.nyteshift/agents/<n>/` | `soul.md` | Markdown |
| `themes` | `~/.nyteshift/themes/` | `theme.json` | Theme JSON |

---

## Built-in vs Marketplace Channels

| Channel | Ships With Product | Source |
|---------|-------------------|--------|
| Discord | Yes (built-in bridge) | `packages/core/src/runtime/discord/` |
| Facebook Messenger | Marketplace | `channels/nyteshift/facebook-messenger/` |
| Slack | Marketplace | `channels/<contributor>/slack/` |
| WhatsApp | Marketplace | `channels/<contributor>/whatsapp/` |
| Telegram | Marketplace | `channels/<contributor>/telegram/` |

The built-in Discord bridge continues to work as before via the `"discord"` trigger type. The new `"channel"` trigger type is used for marketplace-installed adapters.

---

## Security Considerations

- **Webhook signature verification**: Always verify inbound webhooks using HMAC or platform-specific signing.
- **Secret storage**: All tokens and secrets are stored in the NyteShift secret store — never in plaintext config files.
- **Rate limiting**: Channel adapters should implement platform-compliant rate limiting for outbound messages.
- **Access control**: Use `channelAccess` on `AgentConfig` to restrict which agents respond to which channels.

---

## Files Changed

### Core (`packages/core/`)

| File | Change |
|------|--------|
| `src/types/index.ts` | Added `ChannelContract`, `ChannelMessage`, `ChannelReply`, `ChannelAttachment`, `ChannelAccessConfig`, `channelAccess` on `AgentConfig`, `"channel"` to `TriggerType`, channel fields on `TriggerDefinition` |
| `src/utils/index.ts` | Added `channelsDir()` |
| `src/runtime/config/ensureDirs.ts` | Added `channelsDir()` to startup directory creation |
| `src/runtime/channels/channelLoader.ts` | New — loads channel adapters from `~/.nyteshift/channels/` |
| `src/runtime/channels/channelDeps.ts` | New — manages per-channel npm dependencies |
| `src/runtime/triggers/triggerEngine.ts` | Added `channelAdapters` map, `startChannelTrigger()`, lifecycle hooks for channel triggers |
| `src/index.ts` | Barrel-exported `listChannels`, `getChannel`, `ensureChannelDeps`, `channelsDir` |

### CLI (`packages/cli/`)

| File | Change |
|------|--------|
| `src/commands/channels.ts` | New — `nyteshift channels list` and `nyteshift channels inspect` |
| `src/commands/triggers.ts` | Added `--channel-name`, `--channel-mode` options, display for channel triggers |
| `src/index.ts` | Registered `registerChannelCommands()` |

### UI (`packages/ui/`)

| File | Change |
|------|--------|
| `src/renderer/global.d.ts` | Added `ChannelInfo`, `"channel"` TriggerType, channel fields on `TriggerDefinitionInfo`, `listChannels()` API |
| `src/renderer/pages/TriggersView.tsx` | Added channel icon/label, detail rows for channel triggers |
| `src/renderer/components/CreateTriggerModal.tsx` | Added "Channel" trigger type, adapter selector, mode picker |
| `src/main/preload.ts` | Added `listChannels` IPC bridge |
| `src/main/main.ts` | Added `channels:list` IPC handler |

### Examples

| File | Purpose |
|------|---------|
| `src/runtime/channels/examples/facebook-messenger/channel.js` | Reference implementation of a channel adapter |
| `src/runtime/channels/examples/facebook-messenger/package.json` | Manifest for the example |
| `src/runtime/channels/examples/facebook-messenger/README.md` | Setup instructions |
