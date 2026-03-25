/**
 * Centralised tool-context factory.
 *
 * All execution paths (autonomous pipeline, graph runner, triggered pipeline)
 * call `createToolContext` to build the `context` object they pass to every
 * `tool.run()` invocation.  Centralising here means a single place to update
 * as the contract evolves – adding e.g. a `runId`, telemetry hooks, or
 * capability flags only requires editing this file, not every call site.
 *
 * What the factory provides:
 *
 *   1. Resolved tool configuration
 *      `readSkillToolConfig` merges (lowest → highest priority):
 *        • field defaults declared in the tool contract
 *        • global config (`~/.nyteshift/config.json` toolConfig section)
 *        • agent-level config override (agent `config.json` toolConfig section)
 *        • encrypted secret-store values for any field declared `type:"secret"`
 *      The merged config is available under both:
 *        • `context.toolConfig["contributor/name"]`   (modern shape)
 *        • `context.config.toolConfig["contributor/name"]` (legacy shape)
 *
 *   2. Scoped `context.getSecret(namespace, field?)` helper
 *      Tools that resolve credentials dynamically (i.e. call `context.getSecret`
 *      directly rather than reading `context.toolConfig`) can use this helper.
 *      It understands canonical secret naming and tries agent-scoped names
 *      before global ones, mirroring the precedence used by `readSkillToolConfig`.
 *
 *   3. `context.agentName` — forwarded so tools know which agent is running them.
 *
 *   4. Merges any caller-supplied `base` fields (e.g. Discord bridge helpers)
 *      transparently; base fields are never overwritten.
 *
 * Error tolerance: every operation is wrapped so a failure to read config or
 * decrypt a secret never blocks tool execution – the tool's own fallback logic
 * (e.g. reading directly from disk) still applies.
 */

import { readSkillToolConfig } from "../config/configResolver.js";
import { getSecret, secretNameFor } from "../config/secretStore.js";

/**
 * Build a complete, secret-backed tool execution context.
 *
 * @param toolName  Fully-qualified tool name, e.g. `"nyteshift/gmail"`.
 * @param agentName Optional – the agent running the tool.  When supplied,
 *                  agent-scoped config overrides and secrets take precedence
 *                  over global equivalents.
 * @param base      Optional caller-supplied fields merged into the context
 *                  before any additions (e.g. Discord bridge helpers from the
 *                  graph runner).  Base fields are never overwritten.
 */
export async function createToolContext(
  toolName: string,
  agentName?: string,
  base: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const ctx: Record<string, unknown> = { ...base };

  // ── 1. Resolved config (global + agent-override + secrets) ──────────────
  // `readSkillToolConfig` is the single source of truth.  It already handles
  // the full precedence chain and decrypts secret-store values, so tools that
  // read from `context.toolConfig` automatically receive agent-scoped secrets.
  try {
    const cfg = await readSkillToolConfig("tool", toolName, agentName);

    // Modern shape expected by well-behaved tools and new authoring patterns.
    const existingToolConfig =
      (ctx.toolConfig as Record<string, unknown> | undefined) ?? {};
    ctx.toolConfig = { ...existingToolConfig, [toolName]: cfg };

    // Legacy shape for tools written against the older `context.config.toolConfig`
    // access pattern.  Keep both so the same tool works without changes across
    // autonomous, graph, and triggered execution paths.
    const existingConfig =
      (ctx.config as Record<string, unknown> | undefined) ?? {};
    const existingConfigToolConfig =
      (
        (existingConfig as Record<string, unknown>).toolConfig as
          | Record<string, unknown>
          | undefined
      ) ?? {};
    ctx.config = {
      ...existingConfig,
      toolConfig: { ...existingConfigToolConfig, [toolName]: cfg },
    };
  } catch {
    // Tolerant: proceed with whatever `base` provides; tool's own fallback applies.
  }

  // ── 2. Scoped getSecret helper ───────────────────────────────────────────
  // Some tools call `context.getSecret(namespace, field)` directly for ad-hoc
  // secret lookup (e.g. when a credential isn't declared in the tool contract).
  // This facade maps those calls to the encrypted secret store using canonical
  // naming, trying agent-scoped names before global ones.
  //
  // Calling patterns handled:
  //   getSecret("nyteshift/gmail", "appPassword")  → two-arg, namespace + field
  //   getSecret("tool:nyteshift/gmail:appPassword") → one-arg, literal secret key
  ctx.getSecret = async (
    namespaceOrKey: string,
    field?: string,
  ): Promise<string | undefined> => {
    if (field !== undefined) {
      // Two-arg form: getSecret(toolName, fieldName)
      if (agentName) {
        const v = await getSecret(
          secretNameFor("tool", namespaceOrKey, field, agentName),
        );
        if (v !== undefined) return v;
      }
      const v = await getSecret(secretNameFor("tool", namespaceOrKey, field));
      if (v !== undefined) return v;
      // Dotted fallback used by some older tool authoring patterns
      const v2 = await getSecret(`${namespaceOrKey}.${field}`);
      if (v2 !== undefined) return v2;
      // Bare field name as last resort
      return getSecret(field);
    }
    // One-arg form: treat as a literal secret-store key
    return getSecret(namespaceOrKey);
  };

  // ── 3. Propagate agentName ───────────────────────────────────────────────
  // Lets tools know which agent is running them (e.g. for per-agent storage).
  if (agentName !== undefined) {
    ctx.agentName = agentName;
  }

  return ctx;
}
