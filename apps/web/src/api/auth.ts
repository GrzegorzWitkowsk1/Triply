import { parseResponse, request } from "./client";

export { ApiError } from "./client";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  surname: string;
  avatarUrl: string | null;
}

export interface AuthCredentials {
  email: string;
  password: string;
}

interface UserResponse {
  user: AuthUser;
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
