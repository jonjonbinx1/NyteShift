/**
 * toolActionRunner.ts
 *
 * Spawned by the main process via fork() to execute a tool's configAction()
 * in a separate child process, so the Electron main thread is never blocked.
 *
 * Protocol:
 *   parent → child : { qualifiedName: string; key: string }  (via process.send)
 *   child  → parent: { ok: true;  result: unknown }          (on success)
 *                  | { ok: false; error: string }             (on failure)
 */

process.on("message", async (msg: { qualifiedName: string; key: string }) => {
  const { qualifiedName, key } = msg ?? {};
  try {
    const { getTool } = await import("@solix/core");
    const tool = await getTool(qualifiedName);

    if (!tool) {
      process.send!({ ok: false, error: `Tool "${qualifiedName}" not found` });
      process.exit(1);
      return;
    }

    const field = tool.config?.find((f) => f.key === key && f.type === "action");
    if (!field) {
      process.send!({ ok: false, error: `No action field "${key}" on tool "${qualifiedName}"` });
      process.exit(1);
      return;
    }

    if (typeof (tool as any).configAction !== "function") {
      process.send!({
        ok: false,
        error: `Tool "${qualifiedName}" does not implement configAction()`,
      });
      process.exit(1);
      return;
    }

    const result = await (tool as any).configAction(key);
    process.send!({ ok: true, result });
    // Allow detached child processes (e.g. OAuth helpers) to fully separate
    // before this process shuts down.  A small delay prevents the OS from
    // tearing down piped stdio before the child installs its own error
    // handlers, and avoids EPIPE crashes in grandchild processes.
    setTimeout(() => process.exit(0), 500);
  } catch (err: any) {
    process.send!({ ok: false, error: err?.message ?? String(err) });
    process.exit(1);
  }
});
