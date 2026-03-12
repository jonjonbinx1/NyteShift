import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
// Import the logo so Vite bundles it and gives us the correct resolved path.
import appLogo from "./nyteshift_logo.png";

// Set favicon at runtime so it resolves correctly in both dev (Vite server)
// and production (Electron file:// loading).
try {
  const existing = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
  if (existing) {
    existing.href = appLogo;
  } else {
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = appLogo;
    document.head.appendChild(link);
  }
} catch (err) {
  // ignore
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
