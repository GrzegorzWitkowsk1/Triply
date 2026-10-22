import {
  aiConnectionError,
  aiErrorFromHttpStatus,
  aiInvalidResponseError,
  AiError,
} from "../errors.js";
import type { AIProvider, AIRequest } from "../types.js";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterConfig {
  apiKey: string | null;
  model: string | null;
  timeoutMs: number;
}

interface OpenRouterChoice {
  message?: { content?: string };
  finish_reason?: string;
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  error?: { message?: string };
}

function buildSystemMessage(request: AIRequest): string {
  return [
    request.systemInstruction,
    "The JSON object must match this JSON Schema:",
    JSON.stringify(request.schema, null, 2),
  ].join("\n\n");
}

function extractJsonText(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

function extractText(payload: OpenRouterResponse): string {
  const content = payload.choices?.[0]?.message?.content;

  if (content && content.trim().length > 0) {
    return content;
  }

  const finishReason = payload.choices?.[0]?.finish_reason;

  throw new AiError(
    `The AI returned no usable response${
      finishReason && finishReason !== "stop" ? ` (finish reason: ${finishReason})` : ""
    }.`,
    502,
    { provider: "openrouter", code: "invalid_response" },
  );
}

export function createOpenRouterProvider(config: OpenRouterConfig): AIProvider {
  return {
    async generate(request: AIRequest): Promise<unknown> {
      if (!config.apiKey) {
        throw new AiError("OPENROUTER_API_KEY is not configured on the server.", 500, {
          provider: "openrouter",
          code: "not_configured",
        });
      }

      if (!config.model) {
        throw new AiError("AI_MODEL is not configured for the openrouter provider.", 500, {
          provider: "openrouter",
          code: "not_configured",
        });
      }

      let response: Response;

      try {
        response = await fetch(OPENROUTER_BASE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: "system", content: buildSystemMessage(request) },
              { role: "user", content: request.prompt },
            ],
            temperature: 0.2,
          }),
          signal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(config.timeoutMs)]) : AbortSignal.timeout(config.timeoutMs),
        });
      } catch (error) {
        throw aiConnectionError(error, "openrouter");
      }

      const payload = (await response.json().catch(() => null)) as OpenRouterResponse | null;
      if (!response.ok) {
        console.error(
          "[ai] openrouter request failed:",
          response.status,
          payload?.error?.message ?? "no error message",
        );
        throw aiErrorFromHttpStatus(response.status, "openrouter");
      }

      if (!payload) {
        throw aiInvalidResponseError("openrouter");
      }

      const raw = extractText(payload);

      try {
        return JSON.parse(extractJsonText(raw)) as unknown;
      } catch {
        console.error("[ai] openrouter returned non-JSON output");
        throw aiInvalidResponseError("openrouter");
      }
    },
  };
}
