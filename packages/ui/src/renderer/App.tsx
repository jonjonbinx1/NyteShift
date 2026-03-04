import React from "react";
import { HashRouter, Routes, Route, useLocation } from "react-router-dom";
import { Sidebar } from "./components/Sidebar.js";
import { Home } from "./pages/Home.js";
import { AgentList } from "./pages/AgentList.js";
import { AgentDetail } from "./pages/AgentDetail.js";
import { SkillList } from "./pages/SkillList.js";
import { ToolList } from "./pages/ToolList.js";
import { ProviderConfig } from "./pages/ProviderConfig.js";
import { MarketplaceView } from "./pages/MarketplaceView.js";
import { LogsView } from "./pages/LogsView.js";
import { TriggersView } from "./pages/TriggersView.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { ChatStoreProvider } from "./stores/ChatStore.js";
import { ThemeProvider, useTheme } from "./theme/ThemeContext.js";
import { HelperChat } from "./components/HelperChat.js";

/** Adjusts main area layout depending on the current route. */
function MainArea(): React.JSX.Element {
  const location = useLocation();
  // Agent detail needs full height with no padding so the 3-panel chat fills the window.
  const isAgentDetail = /^\/agents\/[^/]+/.test(location.pathname);

  return (
    <main
      style={{
        flex: 1,
        overflow: isAgentDetail ? "hidden" : "auto",
        padding: isAgentDetail ? 0 : "1.5rem",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/agents" element={<AgentList />} />
          <Route path="/agents/:name" element={<AgentDetail />} />
          <Route path="/skills" element={<SkillList />} />
          <Route path="/tools" element={<ToolList />} />
          <Route path="/providers" element={<ProviderConfig />} />
          <Route path="/marketplace" element={<MarketplaceView />} />
          <Route path="/triggers" element={<TriggersView />} />
          <Route path="/logs" element={<LogsView />} />
        </Routes>
      </ErrorBoundary>
    </main>
  );
}

function Shell(): React.JSX.Element {
  const { palette } = useTheme();
  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui, sans-serif", background: palette.base, color: palette.text }}>
      <Sidebar />
      <MainArea />
      <HelperChat />
    </div>
  );
}

export function App(): React.JSX.Element {
  return (
    <HashRouter>
      <ThemeProvider>
        <ChatStoreProvider>
          <Shell />
        </ChatStoreProvider>
      </ThemeProvider>
    </HashRouter>
  );
}
