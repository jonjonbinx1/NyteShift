import type {
  NyteShiftProvider,
  ModelInfo,
  ProviderCallParams,
  ProviderCallResult,
} from "../../types/index.js";
import { resolveConfig } from "../config/configResolver.js";

/**
 * Anthropic provider implementation.
 *
 * Reads the API key from `providers.anthropic.apiKey`
 * (or env `ANTHROPIC_API_KEY`).
 */
const log  = (...a: unknown[]) => console.log("[provider:anthropic]",  ...a);
const logE = (...a: unknown[]) => console.error("[provider:anthropic]", ...a);

export function createAnthropicProvider(): NyteShiftProvider {
  return {
    id: "anthropic",

    async listModels(): Promise<ModelInfo[]> {
      return [
        { id: "claude-sonnet-4-20250514", contextWindow: 200_000, maxOutputTokens: 8_192, description: "Claude Sonnet 4" },
        { id: "claude-3-5-sonnet-20241022", contextWindow: 200_000, maxOutputTokens: 8_192, description: "Claude 3.5 Sonnet" },
        { id: "claude-3-5-haiku-20241022", contextWindow: 200_000, maxOutputTokens: 8_192, description: "Claude 3.5 Haiku" },
        { id: "claude-3-opus-20240229", contextWindow: 200_000, maxOutputTokens: 4_096, description: "Claude 3 Opus" },
      ];
    },

    async call(params: ProviderCallParams): Promise<ProviderCallResult> {
      const config = await resolveConfig();
      const apiKey =
        config.providers?.anthropic?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
      const baseUrl =
        (config.providers?.anthropic?.baseUrl as string | undefined) ??
        "https://api.anthropic.com";

      if (!apiKey) {
        logE("No API key configured — set providers.anthropic.apiKey in config or ANTHROPIC_API_KEY env");
        throw new Error("[anthropic] No API key configured.");
      }

      log(`call model="${params.model}" messages=${params.messages.length} temperature=${params.temperature} maxTokens=${params.maxTokens}`);
      const callStart = Date.now();

      // Separate system messages from the rest (Anthropic uses a top-level `system` field).
      const systemMessages = params.messages.filter((m) => m.role === "system");
      const nonSystemMessages = params.messages.filter((m) => m.role !== "system");

      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: params.model,
          system: systemMessages.map((m) => m.content).join("\n\n") || undefined,
          messages: nonSystemMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          temperature: params.temperature,
          max_tokens: params.maxTokens ?? 4096,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        logE(`HTTP ${res.status} — ${text.slice(0, 300)}`);
        throw new Error(`[anthropic] ${res.status} — ${text}`);
      }

      const json = (await res.json()) as {
        content: Array<{ type: string; text: string }>;
        usage?: { input_tokens: number; output_tokens: number };
      };

      const output = json.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");

      log(`response in ${Date.now() - callStart}ms input=${json.usage?.input_tokens ?? "?"} output=${json.usage?.output_tokens ?? "?"} outputLen=${output.length}`);

      return {
        output,
        usage: json.usage
          ? {
              promptTokens: json.usage.input_tokens,
              completionTokens: json.usage.output_tokens,
            }
          : undefined,
      };
    },
  };
}
