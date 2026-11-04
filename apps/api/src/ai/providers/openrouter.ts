import {
  aiConnectionError,
  aiErrorFromHttpStatus,
  aiInvalidResponseError,
  AiError,
} from "../errors.js";
import type { AIProvider, AIRequest } from "../types.js";

const toolCapabilities = new Map<string, { supported: boolean; expires: number }>();
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterConfig {
  apiKey: string | null;
  model: string | null;
  timeoutMs: number;
}

interface OpenRouterChoice {
  message?: { content?: string | { type?: string; text?: string }[]; tool_calls?: { type?: string; function?: { name?: unknown; arguments?: unknown } }[] };
  finish_reason?: string;
}

interface OpenRouterResponse {
  model?: string;
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
  const raw = payload.choices?.[0]?.message?.content;
  const content = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.filter(part => part && part.type === "text" && typeof part.text === "string").map(part => part.text).join("") : "";

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
    async supportsTools(signal) {
      // This router chooses a compatible free model from the requested features;
      // it need not appear as a concrete model in /models capability metadata.
      // https://openrouter.ai/openrouter/free
      if (config.model === "openrouter/free") return true;
      const capability = toolCapabilities.get(config.model ?? "");
      if (capability && capability.expires > Date.now()) return capability.supported;
      try {
        const response = await fetch("https://openrouter.ai/api/v1/models", { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000) });
        const data = await response.json() as { data?: { id: string; supported_parameters?: string[] }[] };
        const supported = response.ok && Array.isArray(data.data) && data.data.find(model => model.id === config.model)?.supported_parameters?.includes("tools") === true;
        if (toolCapabilities.size > 100) toolCapabilities.clear();
        toolCapabilities.set(config.model ?? "", { supported, expires: Date.now() + (supported ? 60 * 60_000 : 60_000) });
        return supported;
      } catch { return false; }
    },
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
              { role: "system", content: request.responseFormat === "text" || request.tools ? request.systemInstruction : buildSystemMessage(request) },
              { role: "user", content: request.prompt },
            ],
            temperature: 0.2,
            ...(request.tools ? { tools: request.tools.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })), tool_choice: "auto" } : {}),
            ...(request.responseFormat === "text" ? { max_tokens: 2048 } : {}),
          }),
          signal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(config.timeoutMs)]) : AbortSignal.timeout(config.timeoutMs),
        });
      } catch (error) {
        throw aiConnectionError(error, "openrouter");
      }

      const payload = (await response.json().catch(error => {
        if (request.signal?.aborted) throw aiConnectionError(request.signal.reason, "openrouter");
        if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw aiConnectionError(error, "openrouter");
        return null;
      })) as OpenRouterResponse | null;
      request.onDiagnostics?.({ provider: "openrouter", upstreamStatus: response.status,
        actualModel: typeof payload?.model === "string" ? payload.model.slice(0, 160) : null,
        finishReason: typeof payload?.choices?.[0]?.finish_reason === "string" ? payload.choices[0].finish_reason.slice(0, 80) : null });
      if (!response.ok) {
        console.error(
          "[ai] openrouter request failed:",
          response.status,
          "upstream request rejected",
        );
        throw aiErrorFromHttpStatus(response.status, "openrouter");
      }

      if (!payload) {
        throw aiInvalidResponseError("openrouter");
      }

      // Reject incomplete/filtered output even when its first tool call is valid.
      const finishReason = payload.choices?.[0]?.finish_reason;
      if (finishReason && !["stop", "tool_calls"].includes(finishReason)) throw new AiError(`The AI returned an incomplete response (finish reason: ${finishReason}).`, 502, { provider: "openrouter", code: "invalid_response" });

      if (request.tools) {
        const calls = payload.choices?.[0]?.message?.tool_calls;
        if (Array.isArray(calls) && calls.length) {
          try {
            return { toolCalls: calls.map(call => {
              if (call.type !== "function" || !call.function || typeof call.function.arguments !== "string") throw new Error("Invalid tool call");
              return { name: call.function.name, arguments: JSON.parse(call.function.arguments) as unknown };
            }) };
          } catch { throw aiInvalidResponseError("openrouter"); }
        }
      }
      const raw = extractText(payload);
      if (request.responseFormat === "text") return raw.trim();

      try {
        return JSON.parse(extractJsonText(raw)) as unknown;
      } catch {
        console.error("[ai] openrouter returned non-JSON output");
        throw aiInvalidResponseError("openrouter");
      }
    },
  };
}
