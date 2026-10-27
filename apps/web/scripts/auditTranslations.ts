import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { auditSource, literalTranslationUsages, type LiteralUsage, type TranslationException } from "./translationAudit";
const root = fileURLToPath(new URL("../src", import.meta.url));
const usages: LiteralUsage[] = [];
const exceptions: TranslationException[] = [
  { file: "components/Logo.tsx", text: "Triply", reason: "Product name" },
  { file: "components/trips/MediaFallback.tsx", text: "Triply", reason: "Product name" },
  ...["trips", "explore", "saved", "profile"].map(text => ({ file: "components/layout/BottomNav.tsx", text, reason: "Semantic navigation resource key, passed to t(item.label)" })),
  ...["myTrips", "explore", "saved"].map(text => ({ file: "components/layout/Header.tsx", text, reason: "Semantic navigation resource key, passed to t(tab.label)" })),
];
function scan(directory: string): ReturnType<typeof auditSource> {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "i18n" ? [] : scan(path);
    if (!/\.tsx?$/.test(path) || /\.test\.|\.d\.ts$/.test(path)) return [];
    const file = relative(root, path).replaceAll("\\", "/");
    const source = readFileSync(path, "utf8");
    usages.push(...literalTranslationUsages(file, source));
    return auditSource(file, source, exceptions);
  });
}
const findings = scan(root);
for (const finding of findings) console.warn(`AUDIT ${finding.file}:${finding.line} [${finding.kind}] ${JSON.stringify(finding.text)}`);
console.log(`Static translation audit: ${findings.length} likely untranslated strings. Heuristic warnings require contextual review; dynamic values and external/user/AI text need runtime auditing.`);
const missing = usages.filter(usage => {
  try {
    const resource = JSON.parse(readFileSync(join(root, "i18n/locales/en", `${usage.namespace}.json`), "utf8"));
    const parts = usage.key.split(".");
    const parent = parts.slice(0, -1).reduce((value, key) => value?.[key], resource);
    const key = parts.at(-1)!;
    return typeof parent?.[key] !== "string" && typeof parent?.[`${key}_other`] !== "string";
  } catch { return true; }
});
for (const usage of missing) console.error(`MISSING ${usage.file}:${usage.line} ${usage.namespace}:${usage.key}`);
console.log(`Literal translation usage: ${usages.length} calls checked; ${missing.length} missing keys.`);
if (missing.length) process.exitCode = 1;
// Resource validation remains strict. This heuristic does not fail CI on uncertain findings.
