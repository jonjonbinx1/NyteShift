import type {
  NyteShiftProvider,
  ModelInfo,
  ProviderCallParams,
  ProviderCallResult,
} from "../../types/index.js";
import { resolveConfig } from "../config/configResolver.js";
import { getSecret, SECRET_KEYS } from "../config/secretStore.js";

/**
 * OpenAI provider implementation.
 *
 * Reads the API key from the resolved config at
 * `providers.openai.apiKey` (or env `OPENAI_API_KEY`).
 */
const log  = (...a: unknown[]) => console.log("[provider:openai]",  ...a);
const logE = (...a: unknown[]) => console.error("[provider:openai]", ...a);

export function createOpenAIProvider(): NyteShiftProvider {
  return {
    id: "openai",

    async listModels(): Promise<ModelInfo[]> {
      return [
        { id: "gpt-4o", contextWindow: 128_000, maxOutputTokens: 16_384, description: "GPT-4o" },
        { id: "gpt-4o-mini", contextWindow: 128_000, maxOutputTokens: 16_384, description: "GPT-4o Mini" },
        { id: "gpt-4-turbo", contextWindow: 128_000, maxOutputTokens: 4_096, description: "GPT-4 Turbo" },
        { id: "o1", contextWindow: 200_000, maxOutputTokens: 100_000, description: "o1 reasoning" },
        { id: "o3-mini", contextWindow: 200_000, maxOutputTokens: 100_000, description: "o3-mini reasoning" },
      ];
    },

    async call(params: ProviderCallParams): Promise<ProviderCallResult> {
      const config = await resolveConfig();
      const apiKey =
        (await getSecret(SECRET_KEYS.OPENAI_API_KEY)) ??
        process.env.OPENAI_API_KEY ?? "";
      const baseUrl =
        (config.providers?.openai?.baseUrl as string | undefined) ??
        "https://api.openai.com/v1";

      if (!apiKey) {
        logE("No API key configured — set providers.openai.apiKey in config or OPENAI_API_KEY env");
        throw new Error("[openai] No API key configured.");
      }

      log(`call model="${params.model}" messages=${params.messages.length} temperature=${params.temperature} maxTokens=${params.maxTokens}`);
      const callStart = Date.now();

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
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
        throw new Error(`[openai] ${res.status} — ${text}`);
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
