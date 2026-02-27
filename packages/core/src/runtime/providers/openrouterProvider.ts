import type {
  SolixProvider,
  ModelInfo,
  ProviderCallParams,
  ProviderCallResult,
} from "../../types/index.js";
import { resolveConfig } from "../config/configResolver.js";

/**
 * OpenRouter provider implementation.
 *
 * OpenRouter exposes an OpenAI-compatible API, so the call shape is similar
 * to the OpenAI provider but pointed at https://openrouter.ai/api/v1.
 *
 * Reads the API key from `providers.openrouter.apiKey`
 * (or env `OPENROUTER_API_KEY`).
 */
const log  = (...a: unknown[]) => console.log("[provider:openrouter]",  ...a);
const logE = (...a: unknown[]) => console.error("[provider:openrouter]", ...a);

export function createOpenRouterProvider(): SolixProvider {
  return {
    id: "openrouter",

    async listModels(): Promise<ModelInfo[]> {
      const config = await resolveConfig();
      const apiKey =
        config.providers?.openrouter?.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
      const baseUrl =
        (config.providers?.openrouter?.baseUrl as string | undefined) ??
        "https://openrouter.ai/api/v1";

      if (!apiKey) {
        // Return a static fallback list when no key is present.
        return [
          { id: "openai/gpt-4o", contextWindow: 128_000, maxOutputTokens: 16_384, description: "GPT-4o via OpenRouter" },
          { id: "anthropic/claude-sonnet-4-20250514", contextWindow: 200_000, maxOutputTokens: 8_192, description: "Claude Sonnet 4 via OpenRouter" },
          { id: "meta-llama/llama-3.1-70b-instruct", contextWindow: 131_072, maxOutputTokens: 4_096, description: "Llama 3.1 70B" },
        ];
      }

      try {
        const res = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });

        if (!res.ok) return [];

        const json = (await res.json()) as {
          data: Array<{
            id: string;
            context_length?: number;
            top_provider?: { max_completion_tokens?: number };
            description?: string;
          }>;
        };

        return json.data.map((m) => ({
          id: m.id,
          contextWindow: m.context_length ?? 4096,
          maxOutputTokens: m.top_provider?.max_completion_tokens ?? 4096,
          description: m.description,
        }));
      } catch {
        return [];
      }
    },

    async call(params: ProviderCallParams): Promise<ProviderCallResult> {
      const config = await resolveConfig();
      const apiKey =
        config.providers?.openrouter?.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
      const baseUrl =
        (config.providers?.openrouter?.baseUrl as string | undefined) ??
        "https://openrouter.ai/api/v1";

      if (!apiKey) {
        logE("No API key configured — set providers.openrouter.apiKey in config or OPENROUTER_API_KEY env");
        throw new Error("[openrouter] No API key configured.");
      }

      log(`call model="${params.model}" messages=${params.messages.length} temperature=${params.temperature} maxTokens=${params.maxTokens}`);
      const callStart = Date.now();

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://solixai.dev",
          "X-Title": "SolixAI",
        },
        body: JSON.stringify({
          model: params.model,
          messages: params.messages,
          temperature: params.temperature,
          max_tokens: params.maxTokens,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        logE(`HTTP ${res.status} — ${text.slice(0, 300)}`);
        throw new Error(`[openrouter] ${res.status} — ${text}`);
      }

      const json = (await res.json()) as {
        choices: Array<{ message: { content: string | null } }>;
        usage?: { prompt_tokens: number; completion_tokens: number };
      };

      const output = json.choices[0]?.message?.content ?? "";
      log(`response in ${Date.now() - callStart}ms prompt=${json.usage?.prompt_tokens ?? "?"} completion=${json.usage?.completion_tokens ?? "?"} outputLen=${output.length}`);

      return {
        output,
        usage: json.usage
          ? {
              promptTokens: json.usage.prompt_tokens,
              completionTokens: json.usage.completion_tokens,
            }
          : undefined,
      };
    },
  };
}
