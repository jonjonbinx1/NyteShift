import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useChatStore } from "../stores/ChatStore.js";
import type { ChatMessageInfo, ChatSessionSummaryInfo, SubAgentResultInfo } from "../global.js";
import { AgentSettingsModal } from "../components/AgentSettingsModal.js";
import { useTheme } from "../theme/ThemeContext.js";

type Model = { id: string; contextWindow?: number; maxOutputTokens?: number; description?: string };

const fmtTime = (d: Date) =>
  d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const fmtDate = (ts: number) => {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString();
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  const { palette: C } = useTheme();
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: C.subtext0,
      marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.07em",
    }}>
      {children}
    </div>
  );
}

// ── Sub-agent result card (nested delegation view) ─────────────────────────
function SubAgentCard({ result, depth = 0 }: { result: SubAgentResultInfo; depth?: number }) {
  const { palette: C } = useTheme();
  const [open, setOpen] = useState(false);
  const depthColors = [C.mauve, C.blue, C.green, C.peach];
  const borderColor = depthColors[depth % depthColors.length] ?? C.mauve;

  const isRunning = result.status === "running";
  const isFailed  = result.status === "failed";

  return (
    <div style={{
      background: C.surface0,
      borderRadius: 6,
      borderLeft: `3px solid ${isFailed ? C.red : isRunning ? C.yellow : borderColor}`,
      overflow: "hidden",
      marginBottom: 6,
      marginLeft: depth > 0 ? 12 : 0,
    }}>
      <button
        onClick={() => setOpen((x) => !x)}
        style={{
          width: "100%", background: "none", border: "none", cursor: "pointer",
          padding: "8px 10px", display: "flex", justifyContent: "space-between",
          alignItems: "center", gap: 8,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13 }}>
            {isRunning ? "⏳" : isFailed ? "❌" : "🤖"}
          </span>
          <span style={{ fontSize: 11, color: isFailed ? C.red : isRunning ? C.yellow : borderColor, fontWeight: 700 }}>
            {result.isAsync ? "Async sub-agent" : "Sub-agent"}: {result.agentName}
          </span>
          <span style={{
            fontSize: 9, color: C.overlay0, background: C.surface1,
            padding: "1px 6px", borderRadius: 8,
          }}>
            depth {result.depth}
          </span>
          {result.isAsync && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8,
              background: "rgba(250,179,135,0.15)", color: C.peach,
            }}>async</span>
          )}
          {isRunning && (
            <span style={{ fontSize: 9, color: C.yellow, fontWeight: 700 }}>RUNNING</span>
          )}
          {isFailed && (
            <span style={{ fontSize: 9, color: C.red, fontWeight: 700 }}>FAILED</span>
          )}
          {result.aborted && !isRunning && !isFailed && (
            <span style={{ fontSize: 9, color: C.red, fontWeight: 700 }}>ABORTED</span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!isRunning && (
            <span style={{ fontSize: 9, color: C.overlay0 }}>
              {result.stepCount} step{result.stepCount !== 1 ? "s" : ""} · {(result.elapsedMs / 1000).toFixed(1)}s
            </span>
          )}
          <span style={{ fontSize: 10, color: C.overlay0 }}>{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && (
        <div style={{ padding: "6px 10px", borderTop: `1px solid ${C.surface1}` }}>
          {/* Task description */}
          <div style={{
            fontSize: 10, color: C.overlay0, marginBottom: 6,
            padding: "4px 6px", background: "rgba(137,180,250,0.06)",
            borderRadius: 4, fontFamily: "monospace",
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            📋 Task: {result.task}
          </div>
          {/* Run ID for async */}
          {result.runId && (
            <div style={{
              fontSize: 9, color: C.overlay0, marginBottom: 6,
              fontFamily: "monospace", letterSpacing: "0.03em",
            }}>
              runId: {result.runId}
            </div>
          )}
          {/* Status / output */}
          {isRunning ? (
            <div style={{ fontSize: 11, color: C.yellow, fontStyle: "italic" }}>
              ⏳ Sub-agent is still running…
            </div>
          ) : isFailed ? (
            <div style={{
              fontSize: 11, color: C.red, background: "rgba(243,139,168,0.08)",
              padding: "6px 8px", borderRadius: 4, whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>
              {result.error ?? "Unknown error"}
            </div>
          ) : (
            <div style={{
              fontSize: 11, color: C.subtext0, whiteSpace: "pre-wrap",
              wordBreak: "break-word", maxHeight: 200, overflowY: "auto",
              marginBottom: 6,
            }}>
              {result.finalOutput}
            </div>
          )}
          {/* Nested steps */}
          {result.steps && result.steps.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 9, color: C.overlay0, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Steps
              </div>
              {result.steps.map((s, i) => (
                <StepCard key={i} step={s} />
              ))}
            </div>
          )}
          {/* Nested sub-agent results */}
          {result.children && result.children.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 9, color: C.overlay0, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Nested Delegations
              </div>
              {result.children.map((child, i) => (
                <SubAgentCard key={i} result={child} depth={depth + 1} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Async sub-agent launch card (fire-and-forget step) ──────────────────────
function AsyncSubAgentLaunchCard({ output }: {
  output: { agentName?: string; task?: string; runId?: string; startedAt?: number };
}) {
  const { palette: C } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      background: C.surface0, borderRadius: 6, overflow: "hidden",
      marginBottom: 6, borderLeft: `3px solid ${C.peach}`,
    }}>
      <button
        onClick={() => setOpen((x) => !x)}
        style={{
          width: "100%", background: "none", border: "none", cursor: "pointer",
          padding: "8px 10px", display: "flex", justifyContent: "space-between",
          alignItems: "center", gap: 8,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13 }}>🚀</span>
          <span style={{ fontSize: 11, color: C.peach, fontWeight: 700 }}>
            Async launch: {output.agentName ?? "unknown"}
          </span>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8,
            background: "rgba(250,179,135,0.15)", color: C.peach,
          }}>async</span>
        </span>
        <span style={{ fontSize: 10, color: C.overlay0 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "6px 10px", borderTop: `1px solid ${C.surface1}` }}>
          {output.task && (
            <div style={{
              fontSize: 10, color: C.overlay0, marginBottom: 6,
              padding: "4px 6px", background: "rgba(137,180,250,0.06)",
              borderRadius: 4, fontFamily: "monospace",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>
              📋 Task: {output.task}
            </div>
          )}
          {output.runId && (
            <div style={{
              fontSize: 9, color: C.overlay0, marginBottom: 4,
              fontFamily: "monospace", letterSpacing: "0.03em",
            }}>
              runId: {output.runId}
            </div>
          )}
          <div style={{ fontSize: 11, color: C.subtext0, fontStyle: "italic" }}>
            ⏳ Sub-agent is running in the background. The agent will collect the result
            using <span style={{ fontFamily: "monospace", color: C.peach }}>sub_agent_collect</span>.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step detail card (inside run details) ───────────────────────────────────
function StepCard({ step }: { step: { index: number; action: string; output: unknown; thinking?: string; subAgentResult?: SubAgentResultInfo } }) {
  const { palette: C } = useTheme();
  const [open, setOpen] = useState(false);
  const outputAny = step.output as Record<string, unknown> | null | undefined;
  const isAsyncLaunch = step.action.startsWith("tool-call:sub_agent_run") && outputAny?.async === true;
  const isCollect     = step.action.startsWith("tool-call:sub_agent_collect");
  const isSubAgent    = (step.action.startsWith("tool-call:sub_agent_run") && !isAsyncLaunch) || !!step.subAgentResult;
  const collectDone   = isCollect && !!step.subAgentResult;
  const collectRunning = isCollect && outputAny?.status === "running";

  const stepIcon  = isAsyncLaunch ? "🚀 " : isSubAgent || collectDone ? "🤖 " : collectRunning ? "⏳ " : "";
  const stepColor = isAsyncLaunch
    ? C.peach
    : isSubAgent || collectDone
      ? C.blue
      : collectRunning
        ? C.yellow
        : C.mauve;

  return (
    <div style={{ background: C.surface0, borderRadius: 6, overflow: "hidden", marginBottom: 4 }}>
      <button
        onClick={() => setOpen((x) => !x)}
        style={{
          width: "100%", background: "none", border: "none", cursor: "pointer",
          padding: "6px 10px", display: "flex", justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 11, color: stepColor, fontWeight: 700 }}>
          {stepIcon}Step {step.index + 1}: {step.action}
        </span>
        <span style={{ fontSize: 10, color: C.overlay0 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "6px 10px", borderTop: `1px solid ${C.surface1}` }}>
          {step.thinking && (
            <div style={{
              fontSize: 10, color: C.overlay0, marginBottom: 4,
              padding: "4px 6px", background: "rgba(203,166,247,0.06)",
              borderRadius: 4, fontFamily: "monospace",
              maxHeight: 80, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>
              💭 {typeof step.thinking === "string" ? step.thinking.slice(0, 500) : ""}
            </div>
          )}
          {/* Async sub-agent launch */}
          {isAsyncLaunch && outputAny && (
            <div style={{ marginBottom: 6 }}>
              <AsyncSubAgentLaunchCard output={outputAny as Parameters<typeof AsyncSubAgentLaunchCard>[0]["output"]} />
            </div>
          )}
          {/* Collected sub-agent result (sub_agent_collect) */}
          {isCollect && step.subAgentResult && (
            <div style={{ marginBottom: 6 }}>
              <SubAgentCard result={step.subAgentResult} />
            </div>
          )}
          {/* Collect called but agent still running */}
          {isCollect && !step.subAgentResult && collectRunning && (
            <div style={{
              fontSize: 11, color: C.yellow, fontStyle: "italic",
              padding: "4px 6px", background: "rgba(249,226,175,0.06)",
              borderRadius: 4, marginBottom: 4,
            }}>
              ⏳ Sub-agent "{(outputAny?.agentName as string) ?? "?"}" is still running…
            </div>
          )}
          {/* Sync sub-agent delegation result */}
          {step.subAgentResult && !isCollect && (
            <div style={{ marginBottom: 6 }}>
              <SubAgentCard result={step.subAgentResult} />
            </div>
          )}
          <div style={{ fontSize: 11, color: C.subtext0, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 200, overflowY: "auto" }}>
            {typeof step.output === "string" ? step.output : JSON.stringify(step.output, null, 2)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Session card (right panel) ──────────────────────────────────────────────
function SessionCard({
  summary,
  isActive,
  onSelect,
  onDelete,
}: {
  summary: ChatSessionSummaryInfo;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { palette: C } = useTheme();
  const iconBtn: React.CSSProperties = {
    background: "none", border: "none", cursor: "pointer",
    color: C.overlay0, fontSize: 14, padding: "4px 6px", borderRadius: 4,
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "color 0.1s",
  };
  return (
    <div
      onClick={onSelect}
      style={{
        background: isActive ? C.surface1 : C.surface0,
        borderRadius: 8, padding: "9px 12px", marginBottom: 6,
        cursor: "pointer", border: isActive ? `1px solid ${C.mauve}` : `1px solid transparent`,
        transition: "border-color 0.15s, background 0.15s",
        position: "relative",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: C.text,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          maxWidth: "85%",
        }}>
          {summary.title || "New Chat"}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{ ...iconBtn, fontSize: 11, padding: "2px 4px", color: C.surface2 }}
          title="Delete chat"
        >
          ✕
        </button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={{ fontSize: 10, color: C.overlay0 }}>
          {summary.messageCount} msg{summary.messageCount !== 1 ? "s" : ""}
        </span>
        <span style={{ fontSize: 10, color: C.overlay0 }}>
          {fmtDate(summary.updatedAt)}
        </span>
      </div>
      {summary.preview && (
        <div style={{
          fontSize: 10, color: C.surface2, marginTop: 3,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {summary.preview}
        </div>
      )}
    </div>
  );
}

// ── Typing indicator ────────────────────────────────────────────────────────
function TypingIndicator() {
  const { palette: C } = useTheme();
  return (
    <div style={{ display: "flex", gap: 4, padding: "8px 4px" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 7, height: 7, borderRadius: "50%",
            background: C.subtext0, display: "inline-block",
            animation: `solixBounce 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

// ── Thinking/Reasoning block (collapsible) ──────────────────────────────────
function ThinkingBlock({ text }: { text: string }) {
  const { palette: C } = useTheme();
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => setOpen((x) => !x)}
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: C.mauve, fontSize: 12, padding: 0,
          display: "flex", alignItems: "center", gap: 4,
          opacity: 0.85,
        }}
      >
        <span style={{ fontSize: 10 }}>{open ? "▼" : "▶"}</span>
        <span>💭 Reasoning</span>
        <span style={{ color: C.overlay0, fontSize: 11 }}>
          ({text.length > 200 ? `${Math.ceil(text.length / 100) * 100}+ chars` : `${text.length} chars`})
        </span>
      </button>
      {open && (
        <div style={{
          marginTop: 6, padding: "8px 10px",
          background: "rgba(203,166,247,0.06)",
          border: `1px solid ${C.surface1}`,
          borderRadius: 8, fontSize: 12, color: C.subtext0,
          lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
          maxHeight: 300, overflowY: "auto",
          fontFamily: "monospace",
        }}>
          {text}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────
export function AgentDetail(): React.JSX.Element {
  const { name } = useParams<{ name: string }>();
  const chatStore = useChatStore();
  const { palette: C } = useTheme();
  const iconBtn: React.CSSProperties = {
    background: "none", border: "none", cursor: "pointer",
    color: C.overlay0, fontSize: 14, padding: "4px 6px", borderRadius: 4,
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "color 0.1s",
  };
  const primaryBtn: React.CSSProperties = {
    padding: "8px 18px", borderRadius: 8, border: "none",
    background: C.mauve, color: C.crust, fontWeight: 700,
    cursor: "pointer", fontSize: 14, transition: "opacity 0.15s",
  };
  const ghostBtn: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 6,
    background: "none", border: `1px solid ${C.surface1}`,
    cursor: "pointer", color: C.subtext0, padding: "5px 10px",
    borderRadius: 6, fontSize: 12, transition: "border-color 0.1s",
  };
  const fieldInput: React.CSSProperties = {
    background: C.surface0, border: `1px solid ${C.surface1}`,
    borderRadius: 6, padding: "7px 10px", color: C.text,
    fontSize: 13, outline: "none", fontFamily: "inherit",
  };
  const fieldSelect: React.CSSProperties = {
    ...fieldInput, width: "100%", cursor: "pointer",
  };

  // Agent config
  const [config, setConfig] = useState<Record<string, any>>({});
  const [soul, setSoul] = useState("");

  // Panel visibility
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [soulOpen, setSoulOpen] = useState(false);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);

  // Provider / model
  const [providers, setProviders] = useState<Array<{ id: string }>>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selProvider, setSelProvider] = useState("");
  const [selModel, setSelModel] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [maxTokens, setMaxTokens] = useState("4096");
  const [savedSettings, setSavedSettings] = useState(false);

  // Chat input
  const [input, setInput] = useState("");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Derive session from store
  const activeSession = name ? chatStore.getActiveSession(name) : null;
  const sessionId = activeSession?.id || "";
  const messages = activeSession?.messages || [];
  const running = name && sessionId ? chatStore.isRunning(name, sessionId) : false;
  const sessionList = name ? chatStore.getSessionList(name) : [];

  // ── Load agent data + restore/create session on mount ─────────────────
  useEffect(() => {
    if (!name || !window.solixApi) return;

    // Load agent config
    window.solixApi.getAgentConfig(name).then((cfg) => {
      const c = (cfg || {}) as Record<string, any>;
      setConfig(c);
      if (c.provider) setSelProvider(c.provider as string);
      if (c.model) setSelModel(c.model as string);
      if (c.temperature !== undefined) setTemperature(String(c.temperature));
      if (c.maxTokens !== undefined) setMaxTokens(String(c.maxTokens));
    }).catch(console.error);

    window.solixApi.readSoul(name).then(setSoul).catch(console.error);
    window.solixApi.listProviders().then(setProviders).catch(console.error);

    // Restore or create session
    const existing = chatStore.getActiveSession(name);
    if (!existing) {
      chatStore.refreshSessionList(name).then(() => {
        const list = chatStore.getSessionList(name);
        if (list.length > 0) {
          chatStore.loadSession(name, list[0].id);
        } else {
          chatStore.getOrCreateSession(name);
        }
      });
    }

    // Load session list for the sidebar
    chatStore.refreshSessionList(name);
  }, [name]);

  // ── Fetch models when provider changes ───────────────────────────────────
  useEffect(() => {
    if (!selProvider || !window.solixApi) return;
    const api = window.solixApi as any;
    if (typeof api.listProviderModels !== "function") return;
    api.listProviderModels(selProvider)
      .then((ms: Model[]) => {
        setModels(ms || []);
        if (ms?.length && !selModel) setSelModel(ms[0].id);
      })
      .catch(console.error);
  }, [selProvider]);

  // ── Auto-scroll on new message ───────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, running]);

  // Ensure textarea regains focus when window/document become active again.
  // Do not steal focus if another input is active.
  useEffect(() => {
    const tryFocus = () => {
      const el = textareaRef.current;
      if (!el) return;
      const active = document.activeElement as HTMLElement | null;
      const isInputFocused = !!(
        active &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)
      );
      if (!isInputFocused && !running) {
        try {
          el.focus();
        } catch (e) {
          /* ignore */
        }
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") tryFocus();
    };

    window.addEventListener("focus", tryFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", tryFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [running]);

  // ── Save settings ─────────────────────────────────────────────────────────
  const handleSaveSettings = async () => {
    if (!name) return;
    const next = {
      ...config,
      provider: selProvider,
      model: selModel,
      temperature: parseFloat(temperature),
      maxTokens: parseInt(maxTokens, 10),
    };
    setConfig(next);
    await Promise.all([
      window.solixApi!.writeAgentConfig(name, next),
      window.solixApi!.writeSoul(name, soul),
    ]);
    setSavedSettings(true);
    setTimeout(() => setSavedSettings(false), 2000);
  };

  // ── New chat ──────────────────────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    if (!name) return;
    chatStore.createNewSession(name);
  }, [name, chatStore]);

  // ── Switch to a session ───────────────────────────────────────────────────
  const handleSelectSession = useCallback(async (sid: string) => {
    if (!name) return;
    await chatStore.loadSession(name, sid);
  }, [name, chatStore]);

  // ── Delete a session ──────────────────────────────────────────────────────
  const handleDeleteSession = useCallback(async (sid: string) => {
    if (!name) return;
    await chatStore.deleteSession(name, sid);
    if (sid === sessionId) {
      const list = chatStore.getSessionList(name);
      if (list.length > 0) {
        await chatStore.loadSession(name, list[0].id);
      } else {
        chatStore.createNewSession(name);
      }
    }
  }, [name, sessionId, chatStore]);

  // ── Send a message ────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!name || !input.trim() || running || !sessionId) return;

    const userMsg: ChatMessageInfo = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      ts: Date.now(),
    };
    chatStore.addMessage(name, sessionId, userMsg);
    const taskText = input.trim();
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    chatStore.setRunning(name, sessionId, true);

    try {
      // Build history from prior messages in the session (exclude the user
      // message we just pushed — it becomes the `task` arg itself).
      const priorMessages = chatStore.getMessages(name, sessionId).slice(0, -1);
      const chatHistory = priorMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const res = await window.solixApi!.runAutonomous(name, taskText, {
        provider: selProvider || undefined,
        model: selModel || undefined,
        temperature: parseFloat(temperature) || undefined,
        maxTokens: parseInt(maxTokens, 10) || undefined,
        // forward configured step budget so UI sliders actually take effect
        maxSteps: typeof config.maxSteps === "number" ? config.maxSteps : undefined,
        sessionId,
        chatHistory: chatHistory.length > 0 ? chatHistory : undefined,
      });
      const assistantMsg: ChatMessageInfo = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: res.finalOutput || "(no output)",
        thinking: res.thinking || undefined,
        ts: Date.now(),
        steps: res.steps,
      };
      chatStore.addMessage(name, sessionId, assistantMsg);
    } catch (err) {
      const errorMsg: ChatMessageInfo = {
        id: crypto.randomUUID(),
        role: "error",
        content: `Error: ${(err as Error).message}`,
        ts: Date.now(),
      };
      chatStore.addMessage(name, sessionId, errorMsg);
    } finally {
      chatStore.setRunning(name, sessionId, false);
      chatStore.refreshSessionList(name);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!name) return <div style={{ color: C.text, padding: 24 }}>No agent selected.</div>;

  return (
    <>
      {/* Inject keyframe animations */}
      <style>{`
        @keyframes solixBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
          30% { transform: translateY(-6px); opacity: 1; }
        }
        @keyframes solixSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes solixPulse {
          0%, 100% { opacity: 0.15; }
          50%       { opacity: 0.45; }
        }
      `}</style>

      <div style={{
        display: "flex", height: "100%", width: "100%",
        background: C.base, color: C.text,
        fontFamily: "system-ui, -apple-system, sans-serif",
        overflow: "hidden",
      }}>

        {/* ── LEFT: Settings Panel ─────────────────────────────────────── */}
        {settingsOpen && (
          <aside style={{
            width: 264, minWidth: 264,
            background: C.mantle, borderRight: `1px solid ${C.surface0}`,
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            {/* Panel header */}
            <div style={{
              padding: "13px 14px 11px", borderBottom: `1px solid ${C.surface0}`,
              display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
            }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: C.mauve, letterSpacing: "0.04em" }}>
                ⚙ SETTINGS
              </span>
              <button onClick={() => setSettingsOpen(false)} style={iconBtn} title="Collapse settings">✕</button>
            </div>

            {/* Scrollable fields */}
            <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Agent badge */}
              <div>
                <FieldLabel>Agent</FieldLabel>
                <div style={{
                  padding: "7px 10px", background: C.surface0, borderRadius: 6,
                  fontWeight: 700, fontSize: 14, color: C.text,
                }}>
                  🤖 {name}
                </div>
              </div>

              {/* Provider */}
              <div>
                <FieldLabel>Provider</FieldLabel>
                <select
                  value={selProvider}
                  onChange={(e) => setSelProvider(e.target.value)}
                  style={fieldSelect}
                >
                  {providers.length === 0 && <option value="">No providers loaded</option>}
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.id}</option>
                  ))}
                </select>
              </div>

              {/* Model */}
              <div>
                <FieldLabel>Model</FieldLabel>
                <select
                  value={selModel}
                  onChange={(e) => setSelModel(e.target.value)}
                  style={fieldSelect}
                >
                  {models.length === 0 && (
                    <option value={selModel}>{selModel || "(no models loaded)"}</option>
                  )}
                  {models.map((m) => (
                    <option key={m.id} value={m.id} title={m.description}>{m.id}</option>
                  ))}
                </select>
              </div>

              {/* Temperature */}
              <div>
                <FieldLabel>
                  Temperature
                  <span style={{ float: "right", color: C.mauve, fontWeight: 700 }}>{temperature}</span>
                </FieldLabel>
                <input
                  type="range" min="0" max="2" step="0.05"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  style={{ width: "100%", accentColor: C.mauve, marginTop: 4 }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.overlay0, marginTop: 1 }}>
                  <span>Precise</span><span>Creative</span>
                </div>
              </div>

              {/* Max Tokens */}
              <div>
                <FieldLabel>Max Tokens</FieldLabel>
                <input
                  type="number" min={1} value={maxTokens}
                  onChange={(e) => setMaxTokens(e.target.value)}
                  style={{ ...fieldInput, width: "100%", boxSizing: "border-box" }}
                />
              </div>

              {/* Soul / System Prompt (collapsible) */}
              <div>
                <button
                  onClick={() => setSoulOpen((x) => !x)}
                  style={{
                    ...ghostBtn, width: "100%",
                    justifyContent: "space-between", padding: "7px 10px",
                  }}
                >
                  <span>System Prompt (Soul)</span>
                  <span style={{ color: C.overlay0 }}>{soulOpen ? "▲" : "▼"}</span>
                </button>
                {soulOpen && (
                  <textarea
                    value={soul}
                    onChange={(e) => setSoul(e.target.value)}
                    rows={10}
                    style={{
                      ...fieldInput, width: "100%", boxSizing: "border-box",
                      marginTop: 6, fontFamily: "monospace", fontSize: 12,
                      resize: "vertical", lineHeight: 1.5,
                    }}
                    placeholder="Write the agent's system prompt / persona here…"
                  />
                )}
              </div>
            </div>

            {/* Save button + Configure button */}
            <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.surface0}`, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={handleSaveSettings}
                style={{ ...primaryBtn, width: "100%", opacity: savedSettings ? 0.85 : 1 }}
              >
                {savedSettings ? "✓ Saved!" : "Save Settings"}
              </button>
              <button
                onClick={() => setAgentSettingsOpen(true)}
                style={{
                  ...ghostBtn, width: "100%", justifyContent: "center",
                  padding: "7px 12px", color: C.mauve,
                  border: `1px solid rgba(203,166,247,0.3)`,
                }}
              >
                <span>⚙</span>
                <span>Configure Agent…</span>
              </button>
            </div>
          </aside>
        )}

        {/* ── CENTER: Chat Panel ────────────────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

          {/* Chat top bar */}
          <div style={{
            padding: "0 16px", height: 52, flexShrink: 0,
            borderBottom: `1px solid ${C.surface0}`,
            background: C.mantle,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            {!settingsOpen && (
              <button onClick={() => setSettingsOpen(true)} style={iconBtn} title="Open settings">⚙</button>
            )}
            <div style={{ flex: 1, overflow: "hidden" }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>
                {activeSession?.title && activeSession.title !== "New Chat"
                  ? activeSession.title
                  : name}
              </span>
              {selModel && (
                <span style={{
                  marginLeft: 10, fontSize: 11, color: C.subtext0,
                  background: C.surface0, padding: "2px 8px", borderRadius: 20,
                  whiteSpace: "nowrap",
                }}>
                  {selProvider}/{selModel}
                </span>
              )}
            </div>
            <button
              onClick={handleNewChat}
              style={ghostBtn}
              title="Start new chat"
            >
              ✚ New
            </button>
            {!historyOpen && (
              <button onClick={() => setHistoryOpen(true)} style={iconBtn} title="Open chat history">📋</button>
            )}
          </div>

          {/* Message list */}
          <div style={{
            flex: 1, overflowY: "auto",
            padding: "20px 24px",
            display: "flex", flexDirection: "column", gap: 18,
          }}>
            {messages.length === 0 && (
              <div style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                color: C.subtext0, gap: 10, paddingTop: 80,
              }}>
                <div style={{ fontSize: 48 }}>🤖</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Chat with {name}</div>
                <div style={{ fontSize: 13, color: C.subtext0, maxWidth: 320, textAlign: "center" }}>
                  Send a message to start a conversation. The agent will respond autonomously.
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 8,
                  maxWidth: "78%",
                  flexDirection: msg.role === "user" ? "row-reverse" : "row",
                }}>
                  {/* Avatar */}
                  {msg.role !== "user" && (
                    <div style={{
                      width: 30, height: 30, borderRadius: "50%",
                      background: msg.role === "error" ? "#3d1f2b" : C.surface0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14, flexShrink: 0,
                    }}>
                      {msg.role === "error" ? "⚠" : "🤖"}
                    </div>
                  )}

                  {/* Bubble content */}
                  <div>
                    {/* Thinking block */}
                    {msg.role === "assistant" && msg.thinking && (
                      <ThinkingBlock text={msg.thinking} />
                    )}

                    {/* Bubble */}
                    <div style={{
                      padding: "10px 14px",
                      borderRadius: msg.role === "user"
                        ? "18px 18px 4px 18px"
                        : "18px 18px 18px 4px",
                      background: msg.role === "user"
                        ? C.mauve
                        : msg.role === "error"
                          ? "#2d1a20"
                          : C.surface0,
                      color: msg.role === "user"
                        ? C.crust
                        : msg.role === "error"
                          ? C.red
                          : C.text,
                      fontSize: 14,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                    }}>
                      {msg.content}
                    </div>

                    {/* Plan execution widget */}
                    {msg.role === "assistant" && msg.steps && msg.steps.length > 0 && (
                      <PlanExecutionWidget steps={msg.steps} thinking={msg.thinking} />
                    )}
                  </div>
                </div>
                <span style={{
                  fontSize: 11, color: C.overlay0, marginTop: 4,
                  paddingLeft: msg.role !== "user" ? 38 : 0,
                }}>
                  {fmtTime(new Date(msg.ts))}
                </span>
              </div>
            ))}

            {/* Live execution bar */}
            {running && <LiveExecutionBar />}
            <div ref={chatEndRef} />
          </div>

          {/* Input bar */}
          <div style={{
            padding: "12px 20px 16px", flexShrink: 0,
            borderTop: `1px solid ${C.surface0}`,
            background: C.mantle,
          }}>
            <div style={{
              display: "flex", gap: 10, alignItems: "flex-end",
              background: C.surface0, borderRadius: 14,
              padding: "8px 8px 8px 14px",
              border: `1px solid ${C.surface1}`,
              transition: "border-color 0.2s",
            }}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
                }}
                onKeyDown={handleKeyDown}
                placeholder={
                  running
                    ? "Agent is running…"
                    : `Message ${name}…   (↵ to send, ⇧↵ for new line)`
                }
                disabled={running}
                rows={1}
                style={{
                  flex: 1, background: "transparent", border: "none",
                  outline: "none", color: C.text, fontSize: 14,
                  lineHeight: 1.55, resize: "none",
                  fontFamily: "inherit", minHeight: 24, maxHeight: 160, padding: 0,
                }}
              />
              <button
                onClick={handleSend}
                disabled={running || !input.trim()}
                title="Send (Enter)"
                style={{
                  width: 36, height: 36, borderRadius: 10, border: "none",
                  background: running || !input.trim() ? C.surface1 : C.mauve,
                  color: running || !input.trim() ? C.overlay0 : C.crust,
                  cursor: running || !input.trim() ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, flexShrink: 0, transition: "background 0.15s",
                  fontWeight: 700,
                }}
              >
                ↑
              </button>
            </div>
            <div style={{ marginTop: 5, fontSize: 11, color: C.overlay0, textAlign: "center" }}>
              ↵ send · ⇧↵ new line
            </div>
          </div>
        </div>

        {/* ── RIGHT: Chat History Panel ─────────────────────────────────── */}
        {historyOpen && (
          <aside style={{
            width: 272, minWidth: 272,
            background: C.mantle, borderLeft: `1px solid ${C.surface0}`,
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            {/* Header */}
            <div style={{
              padding: "13px 14px 11px", flexShrink: 0,
              borderBottom: `1px solid ${C.surface0}`,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: C.blue, letterSpacing: "0.04em" }}>
                💬 CHATS
              </span>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={handleNewChat} style={iconBtn} title="New chat">✚</button>
                <button onClick={() => setHistoryOpen(false)} style={iconBtn} title="Collapse">✕</button>
              </div>
            </div>

            {/* Session list */}
            <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
              {/* Current unsaved session (if not in the list yet) */}
              {activeSession && !sessionList.some((s) => s.id === activeSession.id) && (
                <SessionCard
                  summary={{
                    id: activeSession.id,
                    agentName: activeSession.agentName,
                    title: activeSession.title,
                    createdAt: activeSession.createdAt,
                    updatedAt: activeSession.updatedAt,
                    messageCount: activeSession.messages.length,
                    preview: activeSession.messages.find((m: ChatMessageInfo) => m.role === "user")?.content.slice(0, 80) || "",
                  }}
                  isActive={true}
                  onSelect={() => {}}
                  onDelete={() => handleDeleteSession(activeSession.id)}
                />
              )}

              {sessionList.length === 0 && !activeSession && (
                <div style={{ textAlign: "center", color: C.overlay0, fontSize: 13, paddingTop: 24 }}>
                  No chats yet.<br />
                  <span style={{ fontSize: 11, color: C.surface2 }}>Start a conversation to create one.</span>
                </div>
              )}

              {sessionList.map((s) => (
                <SessionCard
                  key={s.id}
                  summary={s}
                  isActive={s.id === sessionId}
                  onSelect={() => handleSelectSession(s.id)}
                  onDelete={() => handleDeleteSession(s.id)}
                />
              ))}
            </div>

            {/* Stats footer */}
            <div style={{
              padding: "10px 14px",
              borderTop: `1px solid ${C.surface0}`, flexShrink: 0,
              display: "flex", gap: 16,
            }}>
              <Stat label="Messages" value={messages.length} />
              <Stat label="Chats" value={sessionList.length + (activeSession && !sessionList.some((s) => s.id === activeSession.id) ? 1 : 0)} />
            </div>
          </aside>
        )}
      </div>

      {/* Agent configuration modal */}
      {agentSettingsOpen && name && (
        <AgentSettingsModal agentName={name} onClose={() => setAgentSettingsOpen(false)} />
      )}
    </>
  );
}

// ── Live Execution Bar (shown while agent is running) ─────────────────────────
function LiveExecutionBar() {
  const { palette: C } = useTheme();
  const [phase, setPhase] = useState(0);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const phases = [
    "Analyzing request…",
    "Planning steps…",
    "Executing tools…",
    "Processing results…",
    "Refining output…",
  ];
  useEffect(() => {
    const id = setInterval(() => setPhase((p) => (p + 1) % phases.length), 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <div style={{
        width: 30, height: 30, borderRadius: "50%", background: C.surface0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, flexShrink: 0, marginTop: 2,
      }}>🤖</div>
      <div style={{
        flex: 1, background: C.surface0,
        borderRadius: "18px 18px 18px 4px",
        border: `1px solid ${C.surface1}`,
        overflow: "hidden",
      }}>
        {/* Step row */}
        <div style={{
          padding: "8px 14px",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          {/* Spinner */}
          <span style={{
            display: "inline-block", width: 12, height: 12,
            border: `2px solid ${C.surface1}`, borderTop: `2px solid ${C.mauve}`,
            borderRadius: "50%", flexShrink: 0,
            animation: "solixSpin 0.8s linear infinite",
          }} />
          <span style={{ fontSize: 13, color: C.text, flex: 1, transition: "opacity 0.3s" }}>
            {phases[phase]}
          </span>
          {/* Reasoning toggle (Copilot-style) */}
          <button
            onClick={() => setThinkingOpen((x) => !x)}
            style={{
              background: thinkingOpen ? "rgba(203,166,247,0.12)" : "none",
              border: `1px solid ${thinkingOpen ? "rgba(203,166,247,0.3)" : C.surface1}`,
              cursor: "pointer", color: C.mauve, fontSize: 11, padding: "3px 10px",
              borderRadius: 20, display: "flex", alignItems: "center", gap: 5,
              transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <span style={{ fontSize: 10 }}>{thinkingOpen ? "▼" : "▶"}</span>
            <span>Reasoning</span>
          </button>
        </div>
        {/* Inline reasoning */}
        {thinkingOpen && (
          <div style={{
            borderTop: `1px solid ${C.surface1}`,
            padding: "8px 14px",
            display: "flex", flexDirection: "column", gap: 6,
          }}>
            {[100, 80, 60].map((w, i) => (
              <div key={i} style={{
                height: 8, borderRadius: 4,
                background: `rgba(203,166,247,0.1)`,
                width: `${w}%`,
                animation: `solixPulse 1.5s ease-in-out ${i * 0.3}s infinite`,
              }} />
            ))}
            <span style={{ fontSize: 11, color: C.overlay0, fontStyle: "italic" }}>
              Thinking in progress…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Plan Execution Full Modal ─────────────────────────────────────────────────
function PlanFullModal({
  steps, thinking, onClose,
}: {
  steps: Array<{ index: number; action: string; output: unknown; thinking?: string }>;
  thinking?: string;
  onClose: () => void;
}) {
  const { palette: C } = useTheme();
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(17,17,27,0.88)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: C.base, color: C.text, borderRadius: 14,
        width: "min(700px,100%)", maxHeight: "85vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 16px 64px rgba(0,0,0,0.6)",
        fontFamily: "system-ui, -apple-system, sans-serif",
        border: `1px solid ${C.surface0}`,
      }}>
        {/* Header */}
        <div style={{
          padding: "14px 20px", borderBottom: `1px solid ${C.surface0}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: C.mantle, borderRadius: "14px 14px 0 0", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>📋</span>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Plan Execution</span>
            <span style={{
              fontSize: 11, padding: "2px 10px", borderRadius: 20,
              background: "rgba(166,227,161,0.15)", color: C.green, fontWeight: 700,
            }}>
              {steps.length} step{steps.length !== 1 ? "s" : ""} · completed
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", color: C.overlay0,
              fontSize: 18, cursor: "pointer", padding: "4px 8px", borderRadius: 6, lineHeight: 1,
            }}
          >✕</button>
        </div>

        {/* Overview */}
        {thinking && (
          <div style={{ padding: "12px 20px", borderBottom: `1px solid ${C.surface0}`, flexShrink: 0 }}>
            <ThinkingBlock text={thinking} />
          </div>
        )}

        {/* Steps list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          {steps.map((step) => {
            const isExpanded = expandedStep === step.index;
            return (
              <div
                key={step.index}
                style={{
                  background: C.mantle, borderRadius: 10,
                  border: isExpanded ? `1px solid rgba(203,166,247,0.25)` : `1px solid ${C.surface0}`,
                  overflow: "hidden", transition: "border-color 0.15s",
                }}
              >
                <button
                  onClick={() => setExpandedStep(isExpanded ? null : step.index)}
                  style={{
                    width: "100%", background: "none", border: "none", cursor: "pointer",
                    padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
                    textAlign: "left",
                  }}
                >
                  <span style={{
                    width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                    background: "rgba(166,227,161,0.18)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700, color: C.green,
                  }}>
                    {step.index + 1}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.text }}>
                    {step.action}
                  </span>
                  {step.thinking && (
                    <span style={{
                      fontSize: 10, padding: "2px 8px", borderRadius: 20,
                      background: "rgba(203,166,247,0.1)", color: C.mauve,
                    }}>💭</span>
                  )}
                  <span style={{ fontSize: 10, color: C.overlay0 }}>{isExpanded ? "▼" : "▶"}</span>
                </button>
                {isExpanded && (
                  <div style={{ padding: "0 14px 14px", borderTop: `1px solid ${C.surface0}`, marginTop: 0 }}>
                    {step.thinking && (
                      <div style={{
                        margin: "10px 0", padding: "8px 12px",
                        background: "rgba(203,166,247,0.06)",
                        border: `1px solid rgba(203,166,247,0.15)`, borderRadius: 8,
                        fontSize: 12, color: C.subtext0, fontFamily: "monospace",
                        lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
                        maxHeight: 200, overflowY: "auto",
                      }}>
                        💭 {step.thinking}
                      </div>
                    )}
                    <div style={{
                      fontSize: 12, color: C.text, whiteSpace: "pre-wrap",
                      wordBreak: "break-word", fontFamily: "monospace",
                      background: C.surface0, borderRadius: 6, padding: "8px 10px",
                      maxHeight: 300, overflowY: "auto",
                    }}>
                      {typeof step.output === "string"
                        ? step.output
                        : JSON.stringify(step.output, null, 2)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Plan Execution Widget (compact, under each completed assistant message) ───
function PlanExecutionWidget({
  steps, thinking,
}: {
  steps: Array<{ index: number; action: string; output: unknown; thinking?: string }>;
  thinking?: string;
}) {
  const { palette: C } = useTheme();
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const lastStep = steps[steps.length - 1];
  const stepThinking = lastStep?.thinking || thinking;

  return (
    <>
      <div style={{
        marginTop: 8, background: C.mantle,
        border: `1px solid ${C.surface0}`, borderRadius: 10,
        overflow: "hidden", fontSize: 12,
      }}>
        {/* Compact status row */}
        <div style={{
          padding: "7px 12px",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          {/* Step count badge */}
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "2px 8px", borderRadius: 20,
            background: "rgba(166,227,161,0.15)", color: C.green,
            fontSize: 10, fontWeight: 700, flexShrink: 0,
          }}>
            ✓ {steps.length} step{steps.length !== 1 ? "s" : ""}
          </span>

          {/* Last step title */}
          <span style={{
            flex: 1, color: C.subtext0, overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {lastStep?.action || "Plan completed"}
          </span>

          {/* Reasoning toggle (Copilot-style) */}
          {stepThinking && (
            <button
              onClick={() => setReasoningOpen((x) => !x)}
              style={{
                background: reasoningOpen ? "rgba(203,166,247,0.12)" : "none",
                border: `1px solid ${reasoningOpen ? "rgba(203,166,247,0.3)" : C.surface0}`,
                cursor: "pointer", color: C.mauve, fontSize: 10, padding: "3px 10px",
                borderRadius: 20, display: "flex", alignItems: "center", gap: 5,
                flexShrink: 0, transition: "background 0.15s, border-color 0.15s",
              }}
              title={reasoningOpen ? "Hide reasoning" : "Show reasoning"}
            >
              <span style={{ fontSize: 9 }}>{reasoningOpen ? "▼" : "▶"}</span>
              <span>💭 Reasoning</span>
              {!reasoningOpen && (
                <span style={{ color: C.overlay0 }}>
                  ({stepThinking.length > 200
                    ? `${Math.ceil(stepThinking.length / 100) * 100}+ chars`
                    : `${stepThinking.length} chars`})
                </span>
              )}
            </button>
          )}

          {/* View full plan */}
          <button
            onClick={() => setPlanModalOpen(true)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: C.blue, fontSize: 11, padding: "3px 8px",
              borderRadius: 6, flexShrink: 0,
              transition: "color 0.12s",
            }}
            title="View full plan execution"
          >
            View plan →
          </button>
        </div>

        {/* Inline reasoning (Copilot-style collapsible) */}
        {reasoningOpen && stepThinking && (
          <div style={{
            borderTop: `1px solid ${C.surface0}`,
            padding: "10px 12px",
            background: "rgba(203,166,247,0.04)",
            fontSize: 12, color: C.subtext1,
            fontFamily: "monospace", lineHeight: 1.7,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            maxHeight: 200, overflowY: "auto",
            borderRadius: "0 0 10px 10px",
          }}>
            {stepThinking}
          </div>
        )}
      </div>

      {/* Full plan modal */}
      {planModalOpen && (
        <PlanFullModal
          steps={steps}
          thinking={thinking}
          onClose={() => setPlanModalOpen(false)}
        />
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const { palette: C } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{value}</span>
      <span style={{ fontSize: 10, color: C.overlay0, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
    </div>
  );
}
