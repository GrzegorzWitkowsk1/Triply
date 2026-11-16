const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

/** Paths include /api; an unset base URL keeps requests on the current origin. */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
