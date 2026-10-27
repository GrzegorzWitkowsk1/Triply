import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./resources";
import { namespaces } from "./namespaces";
import { detectLanguage, normalizeLanguage, persistLanguage, LANGUAGE_STORAGE_KEY, supportedLanguages, type Language } from "./config";
export { resources };
const i18n = createInstance();
// Bundled resources initialize synchronously before React renders.
void i18n.use(initReactI18next).init({
  resources, lng: detectLanguage(), fallbackLng: "en", supportedLngs: [...supportedLanguages],
  load: "languageOnly", defaultNS: "common", ns: [...namespaces],
  initAsync: false, interpolation: { escapeValue: false }, returnNull: false,
  react: { useSuspense: false }, saveMissing: import.meta.env.DEV,
  missingKeyHandler: (_languages, namespace, key) => { if (import.meta.env.DEV) console.warn("[i18n] Missing translation", namespace, key); },
});
export function getSelectedLanguage(): Language { return normalizeLanguage(i18n.resolvedLanguage ?? i18n.language) ?? "en"; }
function syncDocument() {
  if (typeof document !== "undefined") { document.documentElement.lang = getSelectedLanguage(); document.documentElement.dir = "ltr"; }
}
i18n.on("languageChanged", () => { persistLanguage(getSelectedLanguage()); syncDocument(); });
syncDocument();
export default i18n;

// Storage events occur only in other tabs. Reuse the existing preference and resource store.
if (typeof window !== "undefined") window.addEventListener("storage", event => {
  if (event.key !== LANGUAGE_STORAGE_KEY || event.storageArea && event.storageArea !== localStorage) return;
  const language = event.newValue === "en" || event.newValue === "pl" ? event.newValue : undefined;
  if (language && language !== getSelectedLanguage()) void i18n.changeLanguage(language);
});
