import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { listAgents, createAgent, deleteAgent, loadAgentConfig, readGlobalConfig, writeGlobalConfig, readSoul, writeSoul, listSkills, listTools, listProviders, runAutonomousTask } from "@nyteshift/core";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
let mainWindow = null;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "NyteShift",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}
function registerIpc() {
  ipcMain.handle("agents:list", () => listAgents());
  ipcMain.handle("agents:create", (_e, name) => createAgent(name));
  ipcMain.handle("agents:delete", (_e, name) => deleteAgent(name));
  ipcMain.handle("agents:config", (_e, name) => loadAgentConfig(name));
  ipcMain.handle("config:read", () => readGlobalConfig());
  ipcMain.handle("config:write", (_e, cfg) => writeGlobalConfig(cfg));
  ipcMain.handle("soul:read", (_e, name) => readSoul(name));
  ipcMain.handle("soul:write", (_e, name, content) => writeSoul(name, content));
  ipcMain.handle("skills:list", () => listSkills());
  ipcMain.handle("tools:list", () => listTools());
  ipcMain.handle(
    "providers:list",
    () => listProviders().map((p) => ({ id: p.id }))
  );
  ipcMain.handle("run:autonomous", async (_e, name, task) => {
    const result = await runAutonomousTask(name, task);
    return result;
  });
}
app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
