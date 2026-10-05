import { env } from "../config/env.js";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiJsonSchema {
  type: string;
  nullable?: boolean;
  description?: string;
  enum?: string[];
  items?: GeminiJsonSchema;
  properties?: Record<string, GeminiJsonSchema>;
  required?: string[];
}

export function nullableSchema(schema: GeminiJsonSchema): GeminiJsonSchema {
  return { ...schema, nullable: true };
}

interface GenerateJsonOptions {
  systemInstruction: string;
  prompt: string;
  schema: GeminiJsonSchema;
}

export class AiError extends Error {
  readonly status: number;
  readonly expose = true;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AiError";
    this.status = status;
  }
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
  );
}

function toAiError(status: number): AiError {
  if (status === 429 || status === 503) {
    return new AiError("The AI service is busy right now. Please try again in a moment.", 503);
  }

  if (status === 403 || status === 401) {
    return new AiError("The AI service rejected the configured credentials.", 500);
  }

  return new AiError("The AI service could not complete the request.", 502);
}

export async function generateJson(options: GenerateJsonOptions): Promise<unknown> {
  if (!env.GEMINI_API_KEY) {
    throw new AiError("GEMINI_API_KEY is not configured on the server.", 500);
  }

  let response: Response;

  try {
    response = await fetch(
      `${GEMINI_BASE_URL}/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: options.systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: options.prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: options.schema,
            temperature: 0.2,
          },
        }),
        signal: AbortSignal.timeout(env.GEMINI_TIMEOUT_MS),
      },
    );
  } catch (error) {
    if (error instanceof AiError) {
      throw error;
    }

    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new AiError(
      timedOut
        ? "The AI service took too long to respond. Please try again."
        : "The AI service is unreachable. Please try again.",
      timedOut ? 504 : 502,
    );
  }

  const payload = (await response.json().catch(() => null)) as GeminiResponse | null;
  if (!response.ok) {
    console.error(
      "[ai] gemini request failed:",
      response.status,
      payload?.error?.message ?? "no error message",
    );
    throw toAiError(response.status);
  }

  if (!payload) {
    throw new AiError("The AI service returned an unreadable response.", 502);
  }

  const raw = extractText(payload);

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    console.error("[ai] gemini returned non-JSON output");
    throw new AiError("The AI service returned an unreadable response.", 502);
  }
}