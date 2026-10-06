import type { AIProviderName } from "./types.js";

export type AiErrorCode =
  | "not_configured"
  | "timeout"
  | "unreachable"
  | "rate_limited"
  | "invalid_credentials"
  | "unavailable"
  | "invalid_response";

export interface AiErrorOptions {
  provider?: AIProviderName;
  code?: AiErrorCode;
}

export class AiError extends Error {
  readonly status: number;
  readonly expose = true;
  readonly provider?: AIProviderName;
  readonly code?: AiErrorCode;

  constructor(message: string, status: number, options: AiErrorOptions = {}) {
    super(message);
    this.name = "AiError";
    this.status = status;
    this.provider = options.provider;
    this.code = options.code;
  }
}

export function aiErrorFromHttpStatus(status: number, provider: AIProviderName): AiError {
  if (status === 429 || status === 503) {
    return new AiError("The AI service is busy right now. Please try again in a moment.", 503, {
      provider,
      code: "rate_limited",
    });
  }

  if (status === 403 || status === 401) {
    return new AiError("The AI service rejected the configured credentials.", 500, {
      provider,
      code: "invalid_credentials",
    });
  }

  return new AiError("The AI service could not complete the request.", 502, {
    provider,
    code: "unavailable",
  });
}

export function aiConnectionError(error: unknown, provider: AIProviderName): AiError {
  const timedOut = error instanceof Error && error.name === "TimeoutError";

  return timedOut
    ? new AiError("The AI service took too long to respond. Please try again.", 504, {
        provider,
        code: "timeout",
      })
    : new AiError("The AI service is unreachable. Please try again.", 502, {
        provider,
        code: "unreachable",
      });
}

export function aiInvalidResponseError(provider: AIProviderName): AiError {
  return new AiError("The AI service returned an unreadable response.", 502, {
    provider,
    code: "invalid_response",
  });
}
