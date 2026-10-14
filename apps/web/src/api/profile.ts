import type { ChangePasswordRequest, ProfileNames, ProfilePreferences, ProfileUser } from "@triply/shared";
import { request } from "./client";
export const saveProfileNames = (values: Partial<ProfileNames>) => request<{ user: ProfileUser }>("/api/profile", { method: "PATCH", body: JSON.stringify(values) }).then(result => result.user);
export const saveProfilePreferences = (values: ProfilePreferences) => request<{ user: ProfileUser }>("/api/profile/preferences", { method: "PUT", body: JSON.stringify(values) }).then(result => result.user);
export const uploadAvatar = (file: File) => request<{ user: ProfileUser }>("/api/profile/avatar", { method: "PUT", headers: { "Content-Type": file.type }, body: file }).then(result => result.user);
export const changePassword = (values: ChangePasswordRequest) => request<void>("/api/profile/password", { method: "POST", body: JSON.stringify(values) });
