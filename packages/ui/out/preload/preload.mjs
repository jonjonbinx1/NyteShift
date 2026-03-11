import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("nyteShiftApi", {
  // Agents
  listAgents: () => ipcRenderer.invoke("agents:list"),
  createAgent: (name) => ipcRenderer.invoke("agents:create", name),
  deleteAgent: (name) => ipcRenderer.invoke("agents:delete", name),
  getAgentConfig: (name) => ipcRenderer.invoke("agents:config", name),
  // Config
  readConfig: () => ipcRenderer.invoke("config:read"),
  writeConfig: (cfg) => ipcRenderer.invoke("config:write", cfg),
  // Soul
  readSoul: (name) => ipcRenderer.invoke("soul:read", name),
  writeSoul: (name, content) => ipcRenderer.invoke("soul:write", name, content),
  // Skills & Tools
  listSkills: () => ipcRenderer.invoke("skills:list"),
  listTools: () => ipcRenderer.invoke("tools:list"),
  // Providers
  listProviders: () => ipcRenderer.invoke("providers:list"),
  // Run
  runAutonomous: (name, task) => ipcRenderer.invoke("run:autonomous", name, task)
});
