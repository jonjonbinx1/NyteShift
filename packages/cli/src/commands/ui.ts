import { Command } from "commander";
import { spawn } from "child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function runCommand(cmd: string, args: string[], opts: Record<string, unknown> = {}) {
  const child = spawn(cmd, args, { stdio: "inherit", shell: true, ...opts });
  child.on("close", (code) => {
    if (code !== 0) process.exit(code ?? 1);
  });
}

export function registerUiCommands(program: Command): void {
  const ui = program.command("ui").description("UI-related commands");

  ui
    .command("launch")
    .description("Start the SolixAI Electron UI")
    .action(() => {
      // Ensure ~/.solix dirs exist even before Electron boots
      const base = path.join(homedir(), ".solix");
      for (const sub of ["", "agents", "skills", "tools", "triggers"]) {
        mkdirSync(path.join(base, sub), { recursive: true });
      }
      console.log("Launching SolixAI UI…");
      console.log("  ~/.solix location:", base);

      // dist/commands/ → dist/ → cli/ → packages/ → workspace root → packages/ui
      const fromBin = path.resolve(__dirname, "../../../ui");
      // also check if user is running from the workspace root directly
      const fromCwd = path.resolve(process.cwd(), "packages/ui");

      const uiDir = existsSync(fromBin) ? fromBin : existsSync(fromCwd) ? fromCwd : null;

      if (uiDir) {
        // Use 'dev' mode if no dist exists yet, otherwise 'preview' (production build)
        const hasDist = existsSync(path.join(uiDir, "dist", "main", "main.js"));
        const script = hasDist ? "preview" : "dev";
        runCommand("npm", ["run", script], { cwd: uiDir });
      } else {
        console.error("Could not find packages/ui. Run from the SolixAI workspace root.");
        process.exit(1);
      }
    });
}
