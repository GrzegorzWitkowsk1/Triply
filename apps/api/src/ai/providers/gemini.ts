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
  content?: { parts?: { text?: string; thought?: boolean; functionCall?: { name?: unknown; args?: unknown } }[] };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

function extractText(payload: GeminiResponse): string {
  const parts = payload.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.filter(part => part && !part.thought && typeof part.text === "string").map(part => part.text).join("") : "";

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
    supportsTools: async () => true,
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
              ...(request.tools ? { tools: [{ functionDeclarations: request.tools.map(tool => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }], toolConfig: { functionCallingConfig: { mode: "AUTO" } } } : {}),
              // Gemini's cap includes thinking: leave room beyond the short visible answer.
              // https://ai.google.dev/gemini-api/docs/generate-content/thinking
              generationConfig: request.responseFormat === "text" || request.tools ? { temperature: 0.2, maxOutputTokens: 8192 } : {
                responseMimeType: "application/json",
                responseSchema: request.schema,
                temperature: 0.2,
              },
            }),
            signal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(config.timeoutMs)]) : AbortSignal.timeout(config.timeoutMs),
          },
        );
      } catch (error) {
        throw aiConnectionError(error, "gemini");
      }

      const payload = (await response.json().catch(error => {
        if (request.signal?.aborted) throw aiConnectionError(request.signal.reason, "gemini");
        if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw aiConnectionError(error, "gemini");
        return null;
      })) as GeminiResponse | null;
      request.onDiagnostics?.({ provider: "gemini", upstreamStatus: response.status,
        finishReason: typeof payload?.candidates?.[0]?.finishReason === "string" ? payload.candidates[0].finishReason.slice(0, 80) : null });
      if (!response.ok) {
        console.error(
          "[ai] gemini request failed:",
          response.status,
          "upstream request rejected",
        );
        throw aiErrorFromHttpStatus(response.status, "gemini");
      }

      if (!payload) {
        throw aiInvalidResponseError("gemini");
      }

      // A parseable prefix can omit later actions. Never propose a partial batch.
      const finishReason = payload.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== "STOP") throw new AiError(`The AI returned an incomplete response (finish reason: ${finishReason}).`, 502, { provider: "gemini", code: "invalid_response" });

      if (request.tools) {
        const parts = payload.candidates?.[0]?.content?.parts;
        const calls = Array.isArray(parts) ? parts.filter(part => !part?.thought && part?.functionCall).map(part => ({ name: part.functionCall!.name, arguments: part.functionCall!.args })) : [];
        if (calls.length) return { toolCalls: calls };
      }
      const raw = extractText(payload);
      if (request.responseFormat === "text") return raw.trim();

      try {
        return JSON.parse(raw) as unknown;
      } catch {
        console.error("[ai] gemini returned non-JSON output");
        throw aiInvalidResponseError("gemini");
      }
    },
  };
}
