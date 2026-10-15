import { request } from "./client";
import type { IdentitySession, ProfileUser } from "@triply/shared";

export type AuthUser = ProfileUser;

export interface AuthCredentials {
  email: string;
  password: string;
}

interface UserResponse {
  user: AuthUser;
}

export function getSession(): Promise<IdentitySession> {
 return request<IdentitySession>('/api/auth/session?identity=1', { cache: 'no-store' });
}
export function startGuest(): Promise<IdentitySession> { return request('/api/auth/guest', {method:'POST'}); }
export function endGuest(): Promise<void> { return request('/api/auth/guest/end', {method:'POST'}); }

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

export { ApiError } from "./client";
