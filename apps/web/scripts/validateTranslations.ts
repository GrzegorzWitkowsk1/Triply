import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { namespaces } from "../src/i18n/namespaces";
import { validateTranslations, type TranslationFile } from "./translations";

const root = fileURLToPath(new URL("../src/i18n/locales/", import.meta.url));
function readFiles(language: "en" | "pl", directory = join(root, language)): TranslationFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return readFiles(language, path);
    if (!entry.name.endsWith(".json")) return [];
    return [{ language, namespace: relative(join(root, language), path).split(sep).join("/").slice(0, -5),
      path: relative(root, path).split(sep).join("/"), source: readFileSync(path, "utf8") }];
  });
}
try {
  const sharedRoot = fileURLToPath(new URL("../../../packages/shared/src/locales/", import.meta.url));
  const sharedFiles: TranslationFile[] = (["en", "pl"] as const).flatMap(language => ["exports/pdf", "exports/calendar"].map(namespace => ({
    language, namespace, path: "shared/" + language + "/" + namespace + ".json", source: readFileSync(join(sharedRoot, language, namespace + ".json"), "utf8"),
  })));
  const result = validateTranslations([ ...readFiles("en"), ...readFiles("pl"), ...sharedFiles ], namespaces);
  console.table(namespaces.map(namespace => {
    const en = result.files.find(file => file.namespace === namespace && file.language === "en");
    const pl = result.files.find(file => file.namespace === namespace && file.language === "pl");
    return { namespace, "EN keys": en?.keys ?? 0, "PL keys": pl?.keys ?? 0, "max lines": Math.max(en?.lines ?? 0, pl?.lines ?? 0) };
  }));
  const largest = result.files.reduce<(typeof result.files)[number] | undefined>((best, file) => !best || file.lines > best.lines ? file : best, undefined);
  if (largest) console.log(`Largest file: ${largest.path} (${largest.lines} lines, ${largest.keys} keys)`);
  for (const group of result.repeatedValues) console.log(`AUDIT ${group.language} ${JSON.stringify(group.value)}: ${group.keys.join(", ")}`);
  for (const warning of result.warnings) console.warn(`WARNING ${warning}`);
  for (const error of result.errors) console.error(`ERROR [${error.code}] ${error.message}`);
  console.log(`Translation validation: ${result.errors.length} errors, ${result.warnings.length} warnings; ${result.repeatedValues.length} repeated-value groups for contextual review.`);
  process.exitCode = result.errors.length ? 1 : 0;
} catch (error) {
  console.error("Translation validation could not read the catalog:", error);
  process.exitCode = 1;
}
