export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface ErrorResponse {
  error?: string;
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
    );
  }

  return body as T;
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  const hasBody = init.body !== undefined && init.body !== null;

  if (hasBody && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });

  return parseResponse<T>(response);
}
