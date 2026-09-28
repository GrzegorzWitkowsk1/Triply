import { request } from "./client";
import type { AuthUser } from "./auth";

export interface ProfileDetails {
  name: string;
  surname: string;
}

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  repeatPassword: string;
}

interface UserResponse {
  user: AuthUser;
}

export function getProfile(): Promise<AuthUser> {
  return request<UserResponse>("/api/profile").then((data) => data.user);
}

export function updateProfile(details: ProfileDetails): Promise<AuthUser> {
  return request<UserResponse>("/api/profile", {
    method: "PUT",
    body: JSON.stringify(details),
  }).then((data) => data.user);
}

export function uploadAvatar(file: File): Promise<AuthUser> {
  const form = new FormData();
  form.append("avatar", file);

  return request<UserResponse>("/api/profile/avatar", {
    method: "PUT",
    body: form,
  }).then((data) => data.user);
}

export function changePassword(input: PasswordChangeInput): Promise<void> {
  return request<void>("/api/profile/password", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
