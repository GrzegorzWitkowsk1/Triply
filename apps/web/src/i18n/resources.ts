import { exportResources } from "@triply/shared";
import type { Language } from "./config";

interface TranslationTree { [key: string]: string | TranslationTree }
const modules = import.meta.glob<TranslationTree>("./locales/**/*.json", { eager: true, import: "default" });
export const resources: Record<Language, Record<string, TranslationTree>> = { en: { ...exportResources.en }, pl: { ...exportResources.pl } };
for (const [path, resource] of Object.entries(modules)) {
  const match = /^\.\/locales\/(en|pl)\/(.+)\.json$/.exec(path);
  if (match) resources[match[1] as Language][match[2]] = resource;
}
