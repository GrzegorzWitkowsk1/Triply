interface ErrorResponse {
  error?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export async function parseResponse<T>(response: Response): Promise<T> {
  const body =
    response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? (body as ErrorResponse).error
        : undefined;
    throw new ApiError(
      message ?? "The request could not be completed.",
      response.status,
      body,
    );
  }

  return body as T;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });

  return parseResponse<T>(response);
}
