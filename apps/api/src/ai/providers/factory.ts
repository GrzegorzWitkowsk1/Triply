import { env } from "../../config/env.js";
import type { AIProvider, AIProviderName } from "../types.js";
import { createGeminiProvider } from "./gemini.js";
import { createOpenRouterProvider } from "./openrouter.js";

export interface AIProviderConfig {
  AI_PROVIDER: string;
  AI_MODEL: string | null;
  AI_TIMEOUT_MS: number;
  GEMINI_API_KEY: string | null;
  OPENROUTER_API_KEY: string | null;
}

const SUPPORTED_PROVIDERS: AIProviderName[] = ["gemini", "openrouter"];

export function createAIProvider(config: AIProviderConfig = env): AIProvider {
  switch (config.AI_PROVIDER) {
    case "gemini":
      return createGeminiProvider({
        apiKey: config.GEMINI_API_KEY,
        model: config.AI_MODEL ?? "gemini-flash-latest",
        timeoutMs: config.AI_TIMEOUT_MS,
      });

    case "openrouter":
      return createOpenRouterProvider({
        apiKey: config.OPENROUTER_API_KEY,
        model: config.AI_MODEL,
        timeoutMs: config.AI_TIMEOUT_MS,
      });

    default:
      throw new Error(
        `Unsupported AI_PROVIDER "${config.AI_PROVIDER}". Supported values: ${SUPPORTED_PROVIDERS.join(", ")}.`,
      );
  }
}
