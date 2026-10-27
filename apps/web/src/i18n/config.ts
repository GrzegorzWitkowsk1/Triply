import { SUPPORTED_LOCALES, type SupportedLocale } from "@triply/shared";
export const LANGUAGE_STORAGE_KEY = "triply.language";
export const supportedLanguages = SUPPORTED_LOCALES;
export type Language = SupportedLocale;
export function normalizeLanguage(value: unknown): Language | undefined {
  if (typeof value !== "string" || !/^[a-z]{2}(?:-[a-z0-9]{2,8})*$/i.test(value.trim())) return undefined;
  const base = value.trim().toLowerCase().split("-")[0];
  return base === "en" || base === "pl" ? base : undefined;
}
export function detectLanguage(): Language {
  try { const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY); if (stored === "en" || stored === "pl") return stored; } catch { /* Storage may be disabled. */ }
  return normalizeLanguage(typeof navigator === "undefined" ? undefined : navigator.language) ?? "en";
}
export function persistLanguage(language: Language): void {
  try { if (localStorage.getItem(LANGUAGE_STORAGE_KEY) !== language) localStorage.setItem(LANGUAGE_STORAGE_KEY, language); } catch { /* Switching still works in memory. */ }
}
