/**
 * Example NyteShift Channel Adapter — Facebook Messenger
 *
 * This file demonstrates the ChannelContract interface that every
 * marketplace channel adapter must implement.
 *
 * Layout on disk (after marketplace install):
 *   ~/.nyteshift/channels/nyteshift/facebook-messenger/channel.js
 *   ~/.nyteshift/channels/nyteshift/facebook-messenger/package.json
 *
 * This example uses the Facebook Messenger Platform Send/Receive API.
 * See: https://developers.facebook.com/docs/messenger-platform
 */

import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

// ── Contract metadata ──────────────────────────────────────────────────

const channel = {
  name: "facebook-messenger",
  version: "1.0.0",
  contributor: "nyteshift",
  description: "Receive and reply to Facebook Messenger DMs via the Messenger Platform API.",
  requiresBridge: false,
  connectionMode: "webhook",
  docsUrl: "https://developers.facebook.com/docs/messenger-platform/getting-started",

  /**
   * Configurable fields — rendered as a form in the NyteShift UI.
   * Values are resolved from the secret store before being passed to start().
   */
  config: [
    {
      key: "pageAccessToken",
      label: "Page Access Token",
      type: "secret",
      required: true,
      description: "Long-lived Page Access Token from the Facebook App dashboard.",
    },
    {
      key: "appSecret",
      label: "App Secret",
      type: "secret",
      required: true,
      description: "Used to verify webhook payloads (X-Hub-Signature-256).",
    },
    {
      key: "verifyToken",
      label: "Webhook Verify Token",
      type: "string",
      required: true,
      description: "Custom string used during Facebook webhook subscription verification.",
      default: "nyteshift-verify",
    },
    {
      key: "webhookPort",
      label: "Webhook Port",
      type: "number",
      required: false,
      default: 7450,
      min: 1024,
      max: 65535,
      description: "Local port for the webhook HTTP server.",
    },
  ],

  // ── Runtime state (not serialized) ─────────────────────────────────
  _server: null,
  _onMessage: null,
  _config: {},

  // ── Lifecycle ──────────────────────────────────────────────────────

  async start(onMessage, config) {
    channel._onMessage = onMessage;
    channel._config = config;

    const port = Number(config.webhookPort) || 7450;
    const verifyToken = config.verifyToken || "nyteshift-verify";

    channel._server = createServer(async (req, res) => {
      // ── Webhook verification (GET) ────────────────────────────────
      if (req.method === "GET") {
        const url = new URL(req.url, `http://localhost:${port}`);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");

        if (mode === "subscribe" && token === verifyToken) {
          console.log("[fb-messenger] Webhook verified");
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end(challenge);
        } else {
          res.writeHead(403);
          res.end("Forbidden");
        }
        return;
      }

      // ── Inbound messages (POST) ───────────────────────────────────
      if (req.method === "POST") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);

        // Verify X-Hub-Signature-256
        if (config.appSecret) {
          const sig = req.headers["x-hub-signature-256"];
          if (!sig) {
            res.writeHead(401);
            res.end("Missing signature");
            return;
          }
          const expected = "sha256=" + createHmac("sha256", config.appSecret).update(body).digest("hex");
          if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
            res.writeHead(403);
            res.end("Bad signature");
            return;
          }
        }

        // Parse and process
        try {
          const payload = JSON.parse(body.toString("utf-8"));

          // Facebook sends an array of entry objects, each with messaging events.
          for (const entry of payload.entry ?? []) {
            for (const event of entry.messaging ?? []) {
              if (!event.message?.text) continue;

              // Normalize to ChannelMessage
              await onMessage({
                channel: "facebook-messenger",
                conversationId: event.sender.id,
                messageId: event.message.mid,
                userId: event.sender.id,
                text: event.message.text,
                attachments: (event.message.attachments ?? []).map((a) => ({
                  mimeType: a.type === "image" ? "image/*" : a.type,
                  url: a.payload?.url ?? "",
                  name: a.type,
                })),
                timestamp: event.timestamp ?? Date.now(),
                metadata: { pageId: entry.id },
              });
            }
          }
        } catch (err) {
          console.error("[fb-messenger] Failed to parse webhook payload:", err);
        }

        res.writeHead(200);
        res.end("EVENT_RECEIVED");
        return;
      }

      res.writeHead(405);
      res.end("Method Not Allowed");
    });

    await new Promise((resolve) => channel._server.listen(port, resolve));
    console.log(`[fb-messenger] Webhook server listening on port ${port}`);
  },

  /**
   * Send a reply back through the Messenger Send API.
   */
  async send(reply, config) {
    const token = config.pageAccessToken;
    if (!token) throw new Error("Missing pageAccessToken — cannot send reply");

    const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(token)}`;
    const body = JSON.stringify({
      recipient: { id: reply.conversationId },
      message: { text: reply.text },
    });

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Messenger Send API error ${res.status}: ${text}`);
    }
  },

  /**
   * Gracefully shut down the webhook server.
   */
  async stop() {
    if (channel._server) {
      await new Promise((resolve) => channel._server.close(resolve));
      channel._server = null;
      console.log("[fb-messenger] Webhook server stopped");
    }
  },
};

export default channel;
