import type { TravelMode } from "@triply/shared";

export type RoutingErrorCode =
  | "not_configured"
  | "unsupported_mode"
  | "timeout"
  | "unreachable"
  | "rate_limited"
  | "invalid_response"
  | "unavailable";

export interface RoutingErrorOptions {
  provider?: string;
  mode?: TravelMode;
  code?: RoutingErrorCode;
}

export class RoutingError extends Error {
  readonly status: number;
  readonly expose = true;
  readonly provider?: string;
  readonly mode?: TravelMode;
  readonly code?: RoutingErrorCode;

  constructor(message: string, status: number, options: RoutingErrorOptions = {}) {
    super(message);
    this.name = "RoutingError";
    this.status = status;
    this.provider = options.provider;
    this.mode = options.mode;
    this.code = options.code;
  }
}

export function routingUnsupportedModeError(mode: TravelMode, provider: string): RoutingError {
  return new RoutingError(`The routing provider does not support the "${mode}" travel mode.`, 400, {
    provider,
    mode,
    code: "unsupported_mode",
  });
}

export function routingErrorFromHttpStatus(
  status: number,
  provider: string,
  mode: TravelMode,
): RoutingError {
  if (status === 429) {
    return new RoutingError("The routing service is rate limiting requests.", 503, {
      provider,
      mode,
      code: "rate_limited",
    });
  }

  return new RoutingError("The routing service could not complete the request.", 502, {
    provider,
    mode,
    code: "unavailable",
  });
}

export function routingConnectionError(
  error: unknown,
  provider: string,
  mode: TravelMode,
): RoutingError {
  const timedOut = error instanceof Error && error.name === "TimeoutError";

  return timedOut
    ? new RoutingError("The routing service timed out.", 504, {
        provider,
        mode,
        code: "timeout",
      })
    : new RoutingError("The routing service is unreachable.", 502, {
        provider,
        mode,
        code: "unreachable",
      });
}

export function routingInvalidResponseError(provider: string, mode: TravelMode): RoutingError {
  return new RoutingError("The routing service returned an unreadable response.", 502, {
    provider,
    mode,
    code: "invalid_response",
  });
}
