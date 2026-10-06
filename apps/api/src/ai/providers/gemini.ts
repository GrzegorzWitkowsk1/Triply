import {
  aiConnectionError,
  aiErrorFromHttpStatus,
  aiInvalidResponseError,
  AiError,
} from "../errors.js";
import type { AIProvider, AIRequest } from "../types.js";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiConfig {
  apiKey: string | null;
  model: string;
  timeoutMs: number;
}

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

function extractText(payload: GeminiResponse): string {
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");

  if (text && text.trim().length > 0) {
    return text;
  }

  const blockReason = payload.promptFeedback?.blockReason;
  const finishReason = payload.candidates?.[0]?.finishReason;

  throw new AiError(
    `The AI returned no usable response${blockReason ? ` (blocked: ${blockReason})` : ""}${
      finishReason && finishReason !== "STOP" ? ` (finish reason: ${finishReason})` : ""
    }.`,
    502,
    { provider: "gemini", code: "invalid_response" },
  );
}

export function createGeminiProvider(config: GeminiConfig): AIProvider {
  return {
    async generate(request: AIRequest): Promise<unknown> {
      if (!config.apiKey) {
        throw new AiError("GEMINI_API_KEY is not configured on the server.", 500, {
          provider: "gemini",
          code: "not_configured",
        });
      }

      let response: Response;

      try {
        response = await fetch(
          `${GEMINI_BASE_URL}/${encodeURIComponent(config.model)}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": config.apiKey,
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: request.systemInstruction }] },
              contents: [{ role: "user", parts: [{ text: request.prompt }] }],
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: request.schema,
                temperature: 0.2,
              },
            }),
            signal: AbortSignal.timeout(config.timeoutMs),
          },
        );
      } catch (error) {
        throw aiConnectionError(error, "gemini");
      }

      const payload = (await response.json().catch(() => null)) as GeminiResponse | null;
      if (!response.ok) {
        console.error(
          "[ai] gemini request failed:",
          response.status,
          payload?.error?.message ?? "no error message",
        );
        throw aiErrorFromHttpStatus(response.status, "gemini");
      }

      if (!payload) {
        throw aiInvalidResponseError("gemini");
      }

      const raw = extractText(payload);

      try {
        return JSON.parse(raw) as unknown;
      } catch {
        console.error("[ai] gemini returned non-JSON output");
        throw aiInvalidResponseError("gemini");
      }
    },
  };
}
