import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: {
          main: "src/main/main.ts",
          toolActionRunner: "src/main/toolActionRunner.ts",
        },
        output: {
          entryFileNames: "[name].js",
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/preload",
      target: "node16",
      rollupOptions: {
        input: "src/main/preload.ts",
        output: {
          format: "cjs",
          entryFileNames: "preload.js",
        },
      },
    },
  },
  renderer: {
    // Files in `public/` are copied verbatim (no hashing) so that
    // nyteshift_logo.ico exists at a stable path for BrowserWindow `icon`.
    publicDir: resolve(__dirname, "public"),
    plugins: [react()],
    build: {
      outDir: "dist/renderer",
      rollupOptions: {
        input: "src/renderer/index.html",
      },
    },
  },
});
