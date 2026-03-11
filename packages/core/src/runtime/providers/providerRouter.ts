import type {
  NyteShiftProvider,
  ModelInfo,
  ProviderCallParams,
  ProviderCallResult,
} from "../../types/index.js";
import { resolveConfig } from "../config/configResolver.js";

import { createOpenAIProvider } from "./openaiProvider.js";
import { createAnthropicProvider } from "./anthropicProvider.js";
import { createOpenRouterProvider } from "./openrouterProvider.js";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { nyteShiftHome } from "../../utils/index.js";

// ── Logging ────────────────────────────────────────────────────────────────
const log  = (...a: unknown[]) => console.log("[providerRouter]",  ...a);
const logW = (...a: unknown[]) => console.warn("[providerRouter]",  ...a);
const logE = (...a: unknown[]) => console.error("[providerRouter]", ...a);

// ── Built-in registry ──────────────────────────────────────────────────

const providers = new Map<string, NyteShiftProvider>();

let _userProvidersLoaded: Promise<void> | null = null;
let _userProvidersLoadedResolve: (() => void) | null = null;

function ensureUserProvidersPromise(): void {
  if (!_userProvidersLoaded) {
    _userProvidersLoaded = new Promise((res) => {
      _userProvidersLoadedResolve = res;
    });
  }
}

function ensureBuiltins(): void {
  if (providers.size > 0) return;
  const builtins: NyteShiftProvider[] = [
    createOpenAIProvider(),
    createAnthropicProvider(),
    createOpenRouterProvider(),
  ];
  for (const p of builtins) {
    providers.set(p.id, p);
    log(`registered built-in provider "${p.id}"`);
  }
  // Attempt to load user-provided providers from ~/.nyteshift/providers
  // (fire-and-forget; failures are logged but do not block startup).
  ensureUserProvidersPromise();
  log(`scanning ~/.nyteshift/providers for user providers…`);
  loadUserProviders().then((ups) => {
    let registered = 0;
    for (const up of ups) {
      try {
        if (up && up.id && typeof up.call === "function") {
          providers.set(up.id, up as NyteShiftProvider);
          log(`registered user provider "${up.id}"`);
          registered++;
        } else {
          logW(`skipped user provider — missing id or call():`, up);
        }
      } catch (err) {
        logE(`failed to register user provider:`, err);
      }
    }
    log(`user provider scan complete — ${registered} provider(s) registered (${providers.size} total)`);
    // resolve the readiness promise so callers can react
    try { _userProvidersLoadedResolve?.(); } catch {}
  }).catch((err) => {
    logE(`loading user providers failed:`, err);
    try { _userProvidersLoadedResolve?.(); } catch {}
  });
}

/** Scan ~/.nyteshift/providers for JS modules and import them. */
async function loadUserProviders(): Promise<any[]> {
  const dir = join(nyteShiftHome(), "providers");
  try {
    const entries = await readdir(dir);
    const found: any[] = [];
    for (const e of entries) {
      const p = join(dir, e);
      let s;
      try {
        s = await stat(p);
      } catch {
        continue;
      }

      if (s.isFile() && (p.endsWith(".js") || p.endsWith(".mjs"))) {
        try {
          const mod = await import(pathToFileURL(p).href);
          const provider = mod.default ?? mod;
          found.push(provider);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[providerRouter] failed to import provider file:", p, err);
        }
      } else if (s.isDirectory()) {
        const candidate = join(p, "provider.js");
        try {
          const cstat = await stat(candidate).catch(() => null);
          if (cstat && cstat.isFile()) {
            try {
              const mod = await import(pathToFileURL(candidate).href);
              const provider = mod.default ?? mod;
              found.push(provider);
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn("[providerRouter] failed to import provider file:", candidate, err);
            }
          }
        } catch {
          // ignore
        }
      }
    }
    return found;
  } catch {
    return [];
  }
}

// ── Public API ─────────────────────────────────────────────────────────

/** Return the list of registered providers. */
export function listProviders(): NyteShiftProvider[] {
  ensureBuiltins();
  return [...providers.values()];
}

/** Promise that resolves once user providers have finished loading (success or failure). */
export function whenUserProvidersLoaded(): Promise<void> {
  ensureBuiltins();
  if (!_userProvidersLoaded) return Promise.resolve();
  return _userProvidersLoaded as Promise<void>;
}

/** Get a provider by id. */
export function getProvider(id: string): NyteShiftProvider | undefined {
  ensureBuiltins();
  return providers.get(id);
}

/** Aggregate models from every provider. */
export async function listAllModels(): Promise<Array<ModelInfo & { provider: string }>> {
  ensureBuiltins();
  const results: Array<ModelInfo & { provider: string }> = [];

  for (const [pid, provider] of providers) {
    try {
      const models = await provider.listModels();
      for (const m of models) {
        results.push({ ...m, provider: pid });
      }
    } catch {
      // If a provider fails (e.g. no API key) we skip it silently.
    }
  }

  return results;
}

/** Call a specific provider. */
export async function callProvider(
  providerId: string,
  params: ProviderCallParams,
): Promise<ProviderCallResult> {
  ensureBuiltins();
  const provider = providers.get(providerId);
  if (!provider) {
    const available = [...providers.keys()].join(", ") || "none";
    logE(`provider "${providerId}" not found. Available: ${available}`);
    throw new Error(`Provider "${providerId}" not found. Available providers: ${available}`);
  }
  log(`routing call → provider="${providerId}" model="${params.model}"`);
  const raw: any = await provider.call(params);

  // Optional verbose debug: print the raw provider response when enabled.
  // Set NYTESHIFT_DEBUG_PROVIDER_RAW=1 or NYTESHIFT_DEBUG=1 to enable.
  if (process.env.NYTESHIFT_DEBUG_PROVIDER_RAW === "1" || process.env.NYTESHIFT_DEBUG === "1") {
    try {
      const util = await import("node:util");
      log(`[providerRouter] raw response from provider="${providerId}" model="${params.model}": ${util.inspect(raw, { depth: 4 })}`);
    } catch (err) {
      try {
        log(`[providerRouter] raw response (json): ${JSON.stringify(raw)}`);
      } catch {
        log(`[providerRouter] raw response (object):`, raw);
      }
    }
  }

  // Normalise: user providers may return `content` instead of `output`, or
  // omit `usage`.  Map everything to the canonical ProviderCallResult shape.
  const result: ProviderCallResult = {
    output:
      typeof raw.output === "string"
        ? raw.output
        : typeof raw.content === "string"
          ? raw.content
          : typeof raw.text === "string"
            ? raw.text
            : "",
    thinking: typeof raw.thinking === "string" ? raw.thinking : undefined,
    usage: raw.usage
      ? {
          promptTokens:  raw.usage.promptTokens  ?? raw.usage.prompt_tokens  ?? 0,
          completionTokens: raw.usage.completionTokens ?? raw.usage.completion_tokens ?? 0,
        }
      : undefined,
  };

  // Per Anthropic/OpenAI agentic best-practices, `thinking` is chain-of-thought
  // and must NOT be used as authoritative output.  The pipeline relies on
  // `output` for control flow (tool-call / final-answer tags).
  //
  // Narrow exception: if `output` is empty AND `thinking` already contains a
  // structured tag (<tool_call> or <final_answer>), the provider incorrectly
  // placed machine-readable content in `thinking` — promote it so the pipeline
  // can parse it.  Prose reasoning is intentionally left out of `output`; the
  // pipeline's re-prompt fallback will handle that case.
  const STRUCTURED_TAG_RE = /<tool_call>|<\/tool_call>|<final_answer>|<\/final_answer>/i;
  if (!result.output && result.thinking && STRUCTURED_TAG_RE.test(result.thinking)) {
    logW(`provider "${providerId}" returned no 'output' but 'thinking' has structured tags — promoting to output`);
    result.output = result.thinking;
  }

  if (!result.output) {
    logW(`provider "${providerId}" returned empty output — raw keys: ${Object.keys(raw).join(", ")}`);
  }

  return result;
}

/** Call the default provider from resolved config. */
export async function callDefaultProvider(
  params: Omit<ProviderCallParams, "model"> & { model?: string },
): Promise<ProviderCallResult> {
  const config = await resolveConfig();
  const providerId = config.defaultProvider ?? "openai";
  const model = params.model ?? config.defaultModel ?? "gpt-4o";

  return callProvider(providerId, { ...params, model });
}
