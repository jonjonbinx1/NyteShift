/**
 * ChatStore — React context that keeps chat sessions alive in memory across
 * route changes and auto-persists them to disk via IPC.
 *
 * Features:
 *  • Sessions survive navigation (no lost messages when switching pages).
 *  • Background runs continue and results are captured even if the user
 *    navigates away from the agent detail page.
 *  • Automatic save-on-change with debounce to avoid excessive writes.
 *  • Session list with create / delete / switch.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  ChatMessageInfo,
  ChatSessionInfo,
  ChatSessionSummaryInfo,
} from "../global.js";

// ── Types ──────────────────────────────────────────────────────────────

interface ChatStoreState {
  /** All loaded sessions keyed by `agentName:sessionId` */
  sessions: Map<string, ChatSessionInfo>;
  /** Active session ID per agent */
  activeSessionIds: Map<string, string>;
  /** Which agent:session combos are currently running */
  runningSet: Set<string>;
  /** Session list summaries per agent (for the sidebar) */
  sessionLists: Map<string, ChatSessionSummaryInfo[]>;
}

interface ChatStoreAPI {
  // Session lifecycle
  getOrCreateSession(agentName: string): ChatSessionInfo;
  loadSession(agentName: string, sessionId: string): Promise<ChatSessionInfo | null>;
  createNewSession(agentName: string): ChatSessionInfo;
  deleteSession(agentName: string, sessionId: string): Promise<void>;
  deleteAllSessions(agentName: string): Promise<void>;

  // Active session
  getActiveSession(agentName: string): ChatSessionInfo | null;
  setActiveSession(agentName: string, sessionId: string): void;

  // Messages
  addMessage(agentName: string, sessionId: string, msg: ChatMessageInfo): void;
  getMessages(agentName: string, sessionId: string): ChatMessageInfo[];

  // Run state
  isRunning(agentName: string, sessionId: string): boolean;
  setRunning(agentName: string, sessionId: string, running: boolean): void;

  // Session list
  refreshSessionList(agentName: string): Promise<void>;
  getSessionList(agentName: string): ChatSessionSummaryInfo[];
}

const ChatStoreContext = createContext<{ api: ChatStoreAPI; v: number } | null>(null);

// ── Provider ───────────────────────────────────────────────────────────

function makeKey(agent: string, session: string) {
  return `${agent}:${session}`;
}

function newSessionId(): string {
  // Use crypto.randomUUID if available, else fallback
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createEmptySession(agentName: string): ChatSessionInfo {
  const now = Date.now();
  return {
    id: newSessionId(),
    agentName,
    title: "New Chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function ChatStoreProvider({ children }: { children: React.ReactNode }) {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((n) => n + 1), []);

  // Mutable refs so callbacks always see current state without stale closures
  const stateRef = useRef<ChatStoreState>({
    sessions: new Map(),
    activeSessionIds: new Map(),
    runningSet: new Set(),
    sessionLists: new Map(),
  });

  // Debounced save queue
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const scheduleSave = useCallback((session: ChatSessionInfo) => {
    const key = makeKey(session.agentName, session.id);
    const existing = saveTimers.current.get(key);
    if (existing) clearTimeout(existing);
    saveTimers.current.set(
      key,
      setTimeout(() => {
        saveTimers.current.delete(key);
        window.solixApi?.saveChatSession(session).catch((err: unknown) =>
          console.error("[ChatStore] save failed:", err),
        );
      }, 500),
    );
  }, []);

  // create stable API object ref (must be declared before any effect that uses it)
  const api = useRef<ChatStoreAPI>({
    getOrCreateSession(agentName: string): ChatSessionInfo {
      const st = stateRef.current;
      const activeId = st.activeSessionIds.get(agentName);
      if (activeId) {
        const existing = st.sessions.get(makeKey(agentName, activeId));
        if (existing) return existing;
      }
      // Create a new session
      return this.createNewSession(agentName);
    },

    async loadSession(agentName: string, sessionId: string): Promise<ChatSessionInfo | null> {
      const st = stateRef.current;
      const key = makeKey(agentName, sessionId);
      // Check memory first
      const cached = st.sessions.get(key);
      if (cached) {
        st.activeSessionIds.set(agentName, sessionId);
        bump();
        return cached;
      }
      // Load from disk
      if (!window.solixApi) return null;
      const session = await window.solixApi.loadChatSession(agentName, sessionId);
      if (!session) return null;
      st.sessions.set(key, session);
      st.activeSessionIds.set(agentName, sessionId);
      bump();
      return session;
    },

    createNewSession(agentName: string): ChatSessionInfo {
      const st = stateRef.current;
      const session = createEmptySession(agentName);
      const key = makeKey(agentName, session.id);
      st.sessions.set(key, session);
      st.activeSessionIds.set(agentName, session.id);
      scheduleSave(session);
      bump();
      return session;
    },

    async deleteSession(agentName: string, sessionId: string): Promise<void> {
      const st = stateRef.current;
      const key = makeKey(agentName, sessionId);
      st.sessions.delete(key);
      if (st.activeSessionIds.get(agentName) === sessionId) {
        st.activeSessionIds.delete(agentName);
      }
      await window.solixApi?.deleteChatSession(agentName, sessionId);
      await api.refreshSessionList(agentName);
      bump();
    },

    async deleteAllSessions(agentName: string): Promise<void> {
      const st = stateRef.current;
      // Remove all in-memory sessions for this agent
      for (const key of [...st.sessions.keys()]) {
        if (key.startsWith(`${agentName}:`)) st.sessions.delete(key);
      }
      st.activeSessionIds.delete(agentName);
      st.sessionLists.delete(agentName);
      await window.solixApi?.deleteAllChatSessions(agentName);
      bump();
    },

    getActiveSession(agentName: string): ChatSessionInfo | null {
      const st = stateRef.current;
      const id = st.activeSessionIds.get(agentName);
      if (!id) return null;
      return st.sessions.get(makeKey(agentName, id)) || null;
    },

    setActiveSession(agentName: string, sessionId: string): void {
      stateRef.current.activeSessionIds.set(agentName, sessionId);
      bump();
    },

    addMessage(agentName: string, sessionId: string, msg: ChatMessageInfo): void {
      const st = stateRef.current;
      const key = makeKey(agentName, sessionId);
      const session = st.sessions.get(key);
      if (!session) return;
      session.messages.push(msg);
      session.updatedAt = Date.now();
      // Auto-derive title from first user message
      if (session.title === "New Chat" && msg.role === "user") {
        const text = msg.content.trim();
        session.title = text.length <= 50 ? text : text.slice(0, 47) + "…";
      }
      scheduleSave(session);
      bump();
    },

    getMessages(agentName: string, sessionId: string): ChatMessageInfo[] {
      const key = makeKey(agentName, sessionId);
      return stateRef.current.sessions.get(key)?.messages || [];
    },

    isRunning(agentName: string, sessionId: string): boolean {
      return stateRef.current.runningSet.has(makeKey(agentName, sessionId));
    },

    setRunning(agentName: string, sessionId: string, running: boolean): void {
      const key = makeKey(agentName, sessionId);
      if (running) {
        stateRef.current.runningSet.add(key);
      } else {
        stateRef.current.runningSet.delete(key);
      }
      bump();
    },

    async refreshSessionList(agentName: string): Promise<void> {
      if (!window.solixApi) return;
      const list = await window.solixApi.listChatSessions(agentName);
      stateRef.current.sessionLists.set(agentName, list);
      bump();
    },

    getSessionList(agentName: string): ChatSessionSummaryInfo[] {
      return stateRef.current.sessionLists.get(agentName) || [];
    },
  }).current;

  // Listen for background run completions and record the output
  useEffect(() => {
    if (!window.solixApi) return;
    const apiAny = window.solixApi as any;
    if (typeof apiAny.onRunCompleted !== "function") return;
    apiAny.onRunCompleted((data: { runId: string; agentName: string; sessionId: string; error?: string; result?: any }) => {
      const key = makeKey(data.agentName, data.sessionId);
      stateRef.current.runningSet.delete(key);

      if (data.result && data.result.finalOutput !== undefined) {
        const msg: ChatMessageInfo = {
          id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
          role: "assistant",
          content: data.result.finalOutput,
          thinking: data.result.thinking,
          ts: Date.now(),
          steps: data.result.steps,
        };
        if (!stateRef.current.sessions.has(key)) {
          if (window.solixApi) {
            window.solixApi.loadChatSession(data.agentName, data.sessionId).then((sess: any) => {
              if (sess) {
                stateRef.current.sessions.set(key, sess);
                api.addMessage(data.agentName, data.sessionId, msg);
                api.refreshSessionList(data.agentName);
                bump();
              }
            }).catch(console.error);
          }
        } else {
          api.addMessage(data.agentName, data.sessionId, msg);
          api.refreshSessionList(data.agentName);
        }
      }

      bump();
    });
  }, [bump]);

  return (
    <ChatStoreContext.Provider value={{ api, v: version }}>
      {children}
    </ChatStoreContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useChatStore(): ChatStoreAPI {
  const ctx = useContext(ChatStoreContext);
  if (!ctx) throw new Error("useChatStore must be used within <ChatStoreProvider>");
  return ctx.api;
}
