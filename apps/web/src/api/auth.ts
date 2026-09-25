export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthCredentials {
  email: string;
  password: string;
}

interface UserResponse {
  user: AuthUser;
}

interface ErrorResponse {
  error?: string;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body =
    response.status === 204
      ? null
      : ((await response.json().catch(() => null)) as ErrorResponse | UserResponse | null);

  if (!response.ok) {
    const message = body && "error" in body ? body.error : undefined;
    throw new ApiError(message ?? "The request could not be completed.", response.status);
  }

  return body as T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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

export function getSession(): Promise<AuthUser | null> {
  const response = fetch("/api/auth/session", {
    headers: { Accept: "application/json" },
    credentials: "include",
    cache: "no-store",
  });

  return response.then((result) => {
    if (result.status === 401) {
      return null;
    }
    return parseResponse<UserResponse>(result).then((data) => data.user);
  });
}

export function login(credentials: AuthCredentials): Promise<AuthUser> {
  return request<UserResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  }).then((data) => data.user);
}

export function register(credentials: AuthCredentials): Promise<AuthUser> {
  return request<UserResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(credentials),
  }).then((data) => data.user);
}

export function logout(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" });
}
