import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTheme } from "../theme/ThemeContext.js";
import type { ThemePalette } from "../theme/themes.js";

// ── Types ──────────────────────────────────────────────────────────────────

type SolixAction =
  | { solix_action: "create_agent";        name: string; soul?: string; description?: string; provider?: string; model?: string }
  | { solix_action: "create_trigger";      name: string; agentName: string; type: "cron" | "once" | "webhook"; schedule?: string; runAt?: number; taskTemplate: string; webhookPath?: string }
  | { solix_action: "navigate";            path: string; label?: string }
  | { solix_action: "update_agent_config"; name: string; settings: Record<string, unknown> };

interface ChatMsg {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
  actions?: SolixAction[];
  actionStates?: Record<string, "pending" | "running" | "done" | "error">;
  actionErrors?: Record<string, string>;
}

// ── Constants ──────────────────────────────────────────────────────────────

const HELPER_SOUL = `You are Solix, the built-in setup assistant for the SolixAI platform.
Your job is to help users set up and configure agents, triggers, providers, and other settings through friendly conversation.

IMPORTANT: When you determine that an action needs to be taken, you MUST embed a JSON code block in your response. The UI will detect these blocks and show confirmation buttons to the user before executing anything. Never claim you "can't" create things — always offer the JSON action block.

--- AVAILABLE ACTIONS ---

1. Create an Agent
\`\`\`json
{
  "solix_action": "create_agent",
  "name": "my-agent-name",
  "soul": "You are a helpful assistant specialised in...",
  "description": "Short human-readable description"
}
\`\`\`
Rules: name must be lowercase with hyphens only, no spaces.

2. Create a Cron/Schedule Trigger
\`\`\`json
{
  "solix_action": "create_trigger",
  "name": "my-trigger",
  "agentName": "my-agent-name",
  "type": "cron",
  "schedule": "0 9 * * 1-5",
  "taskTemplate": "Perform the scheduled task and summarise the result."
}
\`\`\`
Common schedules: every day 9am="0 9 * * *", weekdays="0 9 * * 1-5", hourly="0 * * * *", every 30 min="*/30 * * * *".

3. Navigate to a Page
\`\`\`json
{
  "solix_action": "navigate",
  "path": "/marketplace",
  "label": "Marketplace"
}
\`\`\`
Valid paths: /agents, /triggers, /skills, /tools, /providers, /marketplace, /logs

4. Update Agent Config
\`\`\`json
{
  "solix_action": "update_agent_config",
  "name": "my-agent-name",
  "settings": { "provider": "openai", "model": "gpt-4o", "maxSteps": 15 }
}
\`\`\`

--- GUIDELINES ---
- Ask clarifying questions when intent is unclear (e.g. what schedule, what the agent should do).
- Propose sensible default names, schedules, and soul prompts; let the user confirm.
- Do one logical step at a time: create the agent, then its triggers.
- Keep responses concise and friendly. Use bullet points when listing options.
- For email agents: mention that Gmail or IMAP skills can be installed from the Marketplace.
- For monitoring agents: suggest cron triggers and a meaningful task template.
- Always present the JSON action block and tell the user they can click "Run this" to execute it.`;

// ── Helpers ────────────────────────────────────────────────────────────────

function parseActions(content: string): SolixAction[] {
  const actions: SolixAction[] = [];
  const re = /```json\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed && typeof parsed.solix_action === "string") {
        actions.push(parsed as SolixAction);
      }
    } catch {}
  }
  return actions;
}

/** Strip action JSON blocks from content so they don't render as raw text. */
function stripActionBlocks(content: string): string {
  return content
    .replace(/```json\s*\{[\s\S]*?"solix_action"[\s\S]*?\}```/g, "")
    .trim();
}

const actionLabel: Record<string, string> = {
  create_agent:        "🤖 Create Agent",
  create_trigger:      "⚡ Create Trigger",
  navigate:            "🔀 Navigate",
  update_agent_config: "⚙️  Update Config",
};

// ── Main component ─────────────────────────────────────────────────────────

export function HelperChat(): React.JSX.Element | null {
  const { palette: C } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const [open, setOpen]           = useState(false);
  const [hasProvider, setHasProvider] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [messages, setMessages]   = useState<ChatMsg[]>([]);
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // ── Check provider on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (!window.solixApi) return;
    window.solixApi.readConfig().then((cfg: any) => {
      setHasProvider(!!cfg?.defaultProvider);
    }).catch(() => {});
  }, []);

  // ── Scroll to bottom on new messages ────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Focus input when opened ───────────────────────────────────────────────
  useEffect(() => {
    if (open && hasProvider) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open, hasProvider]);

  const handleOpen = () => {
    setOpen(true);
    if (hasProvider && messages.length === 0) {
      setMessages([{
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Hi! I'm Solix, your built-in assistant \uD83D\uDC4B\n\nTell me what you'd like to set up \u2014 for example:\n- *\"Create an email assistant that summarises my inbox every morning\"*\n- *\"Set up an agent to monitor my server logs\"*\n- *\"Help me create a weekly report trigger\"*\n\nWhat would you like to do?",
        ts: Date.now(),
      }]);
    }

    // refresh provider info for header
    if (window.solixApi) {
      window.solixApi.readConfig().then((cfg: any) => {
        setCurrentProvider(cfg.defaultProvider || null);
        setCurrentModel(cfg.defaultModel || null);
      }).catch(() => {});
    }
  };

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMsg = {
      id: crypto.randomUUID(), role: "user", content: text, ts: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      // Build history from prior turns (system/greeting excluded)
      const priorHistory = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const cfg: any = await window.solixApi!.readConfig().catch(() => ({}));
      console.log("[HelperChat] readConfig ->", cfg);

      // Only pass provider/model if explicitly set (avoid overriding defaults in handler)
      const chatOpts: any = {
        systemPrompt: HELPER_SOUL,
        messages: [...priorHistory, { role: "user", content: text }],
        temperature: 0.7,
        maxTokens:   2048,
      };
      if (cfg?.defaultProvider) chatOpts.provider = cfg.defaultProvider;
      if (cfg?.defaultModel) chatOpts.model = cfg.defaultModel;

      const res = await window.solixApi!.chat(chatOpts);

      const raw = res.output || "(no output)";
      const actions = parseActions(raw);

      const botMsg: ChatMsg = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: raw,
        ts: Date.now(),
        actions: actions.length > 0 ? actions : undefined,
        actionStates: actions.reduce((acc, _a, i) => ({ ...acc, [i]: "pending" as const }), {}),
        actionErrors: {},
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(), role: "system",
        content: `⚠️ Error: ${(err as Error).message}`, ts: Date.now(),
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  // ── Execute an action ─────────────────────────────────────────────────────
  const executeAction = async (msgId: string, actionIndex: number, action: SolixAction) => {
    const setState = (s: "running" | "done" | "error", err?: string) =>
      setMessages((prev) => prev.map((m) => {
        if (m.id !== msgId) return m;
        return {
          ...m,
          actionStates: { ...m.actionStates, [actionIndex]: s },
          actionErrors: err ? { ...m.actionErrors, [actionIndex]: err } : m.actionErrors,
        };
      }));

    setState("running");
    try {
      switch (action.solix_action) {
        case "create_agent": {
          await window.solixApi!.createAgent(action.name);
          if (action.soul) {
            await window.solixApi!.writeSoul(action.name, action.soul);
          }
          if (action.provider || action.model) {
            const existing = await window.solixApi!.getAgentConfig(action.name).catch(() => ({}));
            await window.solixApi!.writeAgentConfig(action.name, {
              ...existing,
              ...(action.provider ? { provider: action.provider } : {}),
              ...(action.model    ? { model: action.model }       : {}),
            });
          }
          break;
        }
        case "create_trigger": {
          await window.solixApi!.triggersCreate({
            name:         action.name,
            agentName:    action.agentName,
            type:         action.type as any,
            enabled:      true,
            taskTemplate: action.taskTemplate,
            schedule:     action.schedule,
            runAt:        action.runAt,
            webhookPath:  action.webhookPath,
          });
          break;
        }
        case "navigate": {
          navigate(action.path);
          setState("done");
          setOpen(false);
          return;
        }
        case "update_agent_config": {
          const existing = await window.solixApi!.getAgentConfig(action.name).catch(() => ({}));
          await window.solixApi!.writeAgentConfig(action.name, { ...existing, ...action.settings });
          break;
        }
      }
      setState("done");

      // Follow-up confirmation in chat
      const confirmMsg = buildConfirmMessage(action);
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(), role: "system",
        content: confirmMsg, ts: Date.now(),
      }]);
    } catch (err) {
      setState("error", (err as Error).message);
    }
  };

  // ── Hide on agent chat screen ────────────────────────────────────────────
  const isAgentDetail = /^\/agents\/[^/]+/.test(location.pathname);
  if (isAgentDetail) return null;

  // ── Styles ────────────────────────────────────────────────────────────────
  const panelW = 400;
  const panelH = 560;

  const bubbleStyle: React.CSSProperties = {
    position: "fixed",
    bottom: 24,
    right: 24,
    width: 52,
    height: 52,
    borderRadius: "50%",
    background: C.mauve,
    color: C.base,
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "1.4rem",
    boxShadow: `0 4px 16px ${C.mauve}66`,
    zIndex: 1000,
    transition: "transform 0.2s, box-shadow 0.2s",
  };

  const panelStyle: React.CSSProperties = {
    position: "fixed",
    bottom: 88,
    right: 24,
    width: panelW,
    height: panelH,
    borderRadius: 16,
    background: C.base,
    border: `1px solid ${C.surface1}`,
    boxShadow: `0 8px 32px rgba(0,0,0,0.35)`,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    zIndex: 1000,
    animation: "solixSlideUp 0.2s ease-out",
  };

  return (
    <>
      <style>{`
        @keyframes solixSlideUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes solixDot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.3; }
          40%           { transform: scale(1);   opacity: 1; }
        }
      `}</style>

      {/* ── Floating bubble ── */}
      <button
        style={bubbleStyle}
        onClick={() => (open ? setOpen(false) : handleOpen())}
        title="Solix Assistant"
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.transform = "scale(1.08)";
          (e.currentTarget as HTMLElement).style.boxShadow = `0 6px 24px ${C.mauve}99`;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.transform = "scale(1)";
          (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 16px ${C.mauve}66`;
        }}
      >
        {open ? "✕" : "💬"}
      </button>

      {/* ── Chat panel ── */}
      {open && (
        <div style={panelStyle}>

          {/* Header */}
          <div style={{
            padding: "0.9rem 1.1rem",
            background: C.surface0,
            borderBottom: `1px solid ${C.surface1}`,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: "1.3rem" }}>🤖</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.95rem", color: C.text }}>Solix Assistant</div>
              <div style={{ fontSize: "0.75rem", color: C.subtext0 }}>Your SolixAI setup helper</div>
              {/* show active provider/model for debugging */}
              {hasProvider && currentProvider && (
                <div style={{ fontSize: "0.6rem", color: C.overlay0, marginTop: 2 }}>
                  {`Provider: ${currentProvider}${currentModel ? ` / ${currentModel}` : ""}`}
                </div>
              )}
            </div>
          </div>

          {/* Body */}
          {!hasProvider ? (
            // ── No-provider gate ──
            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 16,
              padding: "2rem", textAlign: "center",
            }}>
              <span style={{ fontSize: "3rem" }}>🔑</span>
              <div style={{ fontWeight: 700, fontSize: "1rem", color: C.text }}>
                No AI Provider Configured
              </div>
              <div style={{ fontSize: "0.85rem", color: C.subtext0, lineHeight: 1.5 }}>
                The Solix Assistant needs an AI provider (OpenAI, Anthropic, or OpenRouter) to work.
                Set one up and come back!
              </div>
              <button
                onClick={() => { navigate("/providers"); setOpen(false); }}
                style={{
                  background: C.mauve, color: C.base,
                  border: "none", borderRadius: 8, cursor: "pointer",
                  padding: "0.6rem 1.4rem", fontWeight: 700, fontSize: "0.9rem",
                }}
              >
                Setup Providers →
              </button>
            </div>
          ) : (
            <>
              {/* ── Messages ── */}
              <div style={{
                flex: 1, overflowY: "auto", padding: "1rem",
                display: "flex", flexDirection: "column", gap: 12,
              }}>
                {messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    palette={C}
                    onExecute={executeAction}
                    onNavigate={(path) => { navigate(path); setOpen(false); }}
                  />
                ))}

                {loading && (
                  <div style={{ display: "flex", gap: 4, padding: "8px 12px", alignSelf: "flex-start" }}>
                    {[0, 1, 2].map((i) => (
                      <span key={i} style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: C.mauve, display: "inline-block",
                        animation: `solixDot 1.2s ease-in-out ${i * 0.2}s infinite`,
                      }} />
                    ))}
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* ── Input ── */}
              <div style={{
                padding: "0.75rem",
                borderTop: `1px solid ${C.surface1}`,
                background: C.surface0,
                display: "flex", gap: 8, alignItems: "flex-end",
              }}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                  }}
                  placeholder="Ask me to set up an agent, trigger, or anything…"
                  rows={1}
                  style={{
                    flex: 1, resize: "none", border: `1px solid ${C.surface1}`,
                    borderRadius: 8, padding: "0.5rem 0.75rem",
                    background: C.base, color: C.text, fontSize: "0.875rem",
                    fontFamily: "inherit", lineHeight: 1.4,
                    outline: "none", overflowY: "auto", maxHeight: 120,
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={loading || !input.trim()}
                  style={{
                    background: loading || !input.trim() ? C.surface1 : C.mauve,
                    color: loading || !input.trim() ? C.subtext0 : C.base,
                    border: "none", borderRadius: 8, cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                    padding: "0.5rem 0.9rem", fontWeight: 700, fontSize: "0.9rem",
                    minWidth: 44, flexShrink: 0,
                    transition: "background 0.15s, color 0.15s",
                  }}
                >
                  ↑
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

// ── Message bubble sub-component ──────────────────────────────────────────

interface MessageBubbleProps {
  msg: ChatMsg;
  palette: ThemePalette;
  onExecute: (msgId: string, idx: number, action: SolixAction) => void;
  onNavigate: (path: string) => void;
}

function MessageBubble({ msg, palette: C, onExecute }: MessageBubbleProps): React.JSX.Element {
  const isUser   = msg.role === "user";
  const isSystem = msg.role === "system";

  const cleanContent = msg.actions ? stripActionBlocks(msg.content) : msg.content;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      gap: 6,
    }}>
      {/* Text bubble */}
      {cleanContent && (
        <div style={{
          maxWidth: "85%",
          padding: isSystem ? "6px 10px" : "10px 13px",
          borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
          background: isUser ? C.mauve : isSystem ? `${C.green}18` : C.surface1,
          color: isUser ? C.base : isSystem ? C.green : C.text,
          fontSize: "0.875rem",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          border: isSystem ? `1px solid ${C.green}44` : "none",
        }}>
          <SimpleMarkdown text={cleanContent} linkColor={C.blue} boldColor={C.mauve} />
        </div>
      )}

      {/* Action cards */}
      {msg.actions && msg.actions.map((action, i) => {
        const state = msg.actionStates?.[i] ?? "pending";
        const err   = msg.actionErrors?.[i];
        return (
          <ActionCard
            key={i}
            action={action}
            state={state}
            error={err}
            palette={C}
            onRun={() => onExecute(msg.id, i, action)}
          />
        );
      })}
    </div>
  );
}

// ── Action card ────────────────────────────────────────────────────────────

interface ActionCardProps {
  action: SolixAction;
  state: "pending" | "running" | "done" | "error";
  error?: string;
  palette: ThemePalette;
  onRun: () => void;
}

function ActionCard({ action, state, error, palette: C, onRun }: ActionCardProps): React.JSX.Element {
  const stateColor = state === "done" ? C.green : state === "error" ? C.red : state === "running" ? C.yellow : C.blue;
  const stateIcon  = state === "done" ? "✅" : state === "error" ? "❌" : state === "running" ? "⏳" : "▶";

  return (
    <div style={{
      maxWidth: "92%",
      background: C.surface0,
      border: `1px solid ${stateColor}44`,
      borderRadius: 10,
      padding: "10px 13px",
      display: "flex",
      flexDirection: "column",
      gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 700, color: stateColor }}>
          {actionLabel[action.solix_action] ?? action.solix_action}
        </span>
        <span style={{ fontSize: "0.75rem", color: C.subtext0 }}>
          {state === "done" ? "Done" : state === "error" ? "Failed" : state === "running" ? "Running…" : "Ready"}
        </span>
      </div>
      <ActionSummary action={action} palette={C} />
      {error && (
        <div style={{ fontSize: "0.75rem", color: C.red, marginTop: 2 }}>
          {error}
        </div>
      )}
      {(state === "pending" || state === "error") && (
        <button
          onClick={onRun}
          style={{
            background: C.mauve, color: C.base, border: "none", borderRadius: 6,
            cursor: "pointer", padding: "5px 12px", fontWeight: 700, fontSize: "0.8rem",
            alignSelf: "flex-start", marginTop: 2,
            transition: "opacity 0.15s",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.85")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
        >
          {stateIcon} {state === "error" ? "Retry" : "Run this"}
        </button>
      )}
      {state === "done" && (
        <span style={{ fontSize: "0.8rem", color: C.green }}>{stateIcon} Completed</span>
      )}
      {state === "running" && (
        <span style={{ fontSize: "0.8rem", color: C.yellow }}>{stateIcon} Running…</span>
      )}
    </div>
  );
}

// ── Compact action summary ─────────────────────────────────────────────────

function ActionSummary({ action, palette: C }: { action: SolixAction; palette: ThemePalette }): React.JSX.Element {
  const row = (k: string, v: unknown) => v == null ? null : (
    <div key={k} style={{ display: "flex", gap: 6, fontSize: "0.78rem" }}>
      <span style={{ color: C.subtext0, minWidth: 80 }}>{k}</span>
      <span style={{ color: C.text, wordBreak: "break-word", flex: 1 }}>{String(v)}</span>
    </div>
  );

  switch (action.solix_action) {
    case "create_agent":
      return <>
        {row("Name",  action.name)}
        {row("Soul",  action.soul ? action.soul.slice(0, 100) + (action.soul.length > 100 ? "…" : "") : null)}
      </>;
    case "create_trigger":
      return <>
        {row("Name",     action.name)}
        {row("Agent",    action.agentName)}
        {row("Type",     action.type)}
        {row("Schedule", action.schedule)}
        {row("Task",     action.taskTemplate?.slice(0, 80) + (action.taskTemplate?.length > 80 ? "…" : ""))}
      </>;
    case "navigate":
      return <>{row("Page", action.label ?? action.path)}</>;
    case "update_agent_config":
      return <>
        {row("Agent",    action.name)}
        {Object.entries(action.settings).map(([k, v]) => row(k, v))}
      </>;
    default:
      return <></>;
  }
}

// ── Minimal inline markdown renderer ──────────────────────────────────────

function SimpleMarkdown({ text, linkColor, boldColor }: { text: string; linkColor: string; boldColor: string }): React.JSX.Element {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        // Bold: **text** or *text*
        const rendered = line
          .split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
          .map((part, j) => {
            if (part.startsWith("**") && part.endsWith("**")) {
              return <strong key={j} style={{ color: boldColor }}>{part.slice(2, -2)}</strong>;
            }
            if (part.startsWith("*") && part.endsWith("*")) {
              return <em key={j}>{part.slice(1, -1)}</em>;
            }
            return part;
          });
        return (
          <React.Fragment key={i}>
            {i > 0 && <br />}
            {rendered}
          </React.Fragment>
        );
      })}
    </>
  );
}

// ── Confirmation message builder ───────────────────────────────────────────

function buildConfirmMessage(action: SolixAction): string {
  switch (action.solix_action) {
    case "create_agent":
      return `✅ Agent **${action.name}** created successfully! You can find it under Agents. Want me to create a trigger for it or configure anything else?`;
    case "create_trigger":
      return `✅ Trigger **${action.name}** created for **${action.agentName}**! It's now listed under Triggers. Anything else to set up?`;
    case "navigate":
      return `✅ Navigating to ${action.label ?? action.path}…`;
    case "update_agent_config":
      return `✅ Config updated for **${action.name}**. Anything else?`;
    default:
      return "✅ Done!";
  }
}
