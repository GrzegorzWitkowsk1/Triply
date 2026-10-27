import ts from "typescript";

export interface TranslationFile {
  language: "en" | "pl";
  namespace: string;
  path: string;
  source: string;
}
export interface Diagnostic {
  code: "invalid-json" | "duplicate-key" | "empty-value" | "invalid-value" | "missing-key" | "interpolation" | "namespace" | "plural";
  message: string;
}
export interface FileStats { path: string; language: "en" | "pl"; namespace: string; keys: number; lines: number }
export interface RepeatedValue { language: "en" | "pl"; value: string; keys: string[] }
export interface ValidationResult {
  errors: Diagnostic[];
  warnings: string[];
  files: FileStats[];
  repeatedValues: RepeatedValue[];
}
const languages = ["en", "pl"] as const;

/** Use the parser's source tree: JSON.parse would discard repeated properties. */
function duplicateKeys(file: TranslationFile): Diagnostic[] {
  const source = ts.parseJsonText(file.path, file.source);
  const errors: Diagnostic[] = [];
  function visit(node: ts.Node, path: string): void {
    if (ts.isObjectLiteralExpression(node)) {
      const seen = new Set<string>();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) continue;
        const key = property.name.text;
        const location = path ? `${path}.${key}` : key;
        if (seen.has(key)) {
          const { line, character } = source.getLineAndCharacterOfPosition(property.name.getStart(source));
          errors.push({ code: "duplicate-key", message: `${file.path}:${line + 1}:${character + 1}: duplicate key ${location}` });
        }
        seen.add(key);
        visit(property.initializer, location);
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach((child, index) => visit(child, `${path}[${index}]`));
    } else ts.forEachChild(node, child => visit(child, path));
  }
  visit(source, "");
  return errors;
}

function placeholders(value: string): string[] {
  return [...new Set([...value.matchAll(/{{\s*-?\s*([^{}]+?)\s*}}/g)]
    .map(match => match[1].split(",")[0].trim()))].sort();
}

export function validateTranslations(files: TranslationFile[], expectedNamespaces: readonly string[], maxLines = 300): ValidationResult {
  const result: ValidationResult = { errors: [], warnings: [], files: [], repeatedValues: [] };
  const catalogs = new Map<string, Map<string, string>>();
  const values = new Map<string, RepeatedValue>();
  for (const file of files) {
    const id = `${file.language}/${file.namespace}`;
    const entries = new Map<string, string>();
    if (catalogs.has(id)) result.errors.push({ code: "namespace", message: `${file.path}: duplicate namespace ${id}` });
    catalogs.set(id, entries);
    const lines = file.source.split(/\r?\n/).length - (file.source.endsWith("\n") ? 1 : 0);
    result.files.push({ path: file.path, language: file.language, namespace: file.namespace, keys: 0, lines });
    if (lines > maxLines) result.warnings.push(`${file.path}: ${lines} lines exceed the recommended ${maxLines}; split into logical feature namespaces.`);
    // Strict JSON syntax and a source-preserving parser serve different purposes.
    let parsed: unknown;
    try { parsed = JSON.parse(file.source); }
    catch (error) {
      result.errors.push({ code: "invalid-json", message: `${file.path}: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    result.errors.push(...duplicateKeys(file));
    function flatten(value: unknown, path: string): void {
      if (typeof value === "string") {
        if (!value.trim()) result.errors.push({ code: "empty-value", message: `${file.path}: empty translation at ${path}` });
        entries.set(path, value);
        const groupKey = JSON.stringify([file.language, value]);
        const group = values.get(groupKey) ?? { language: file.language, value, keys: [] };
        group.keys.push(`${file.namespace}:${path}`);
        values.set(groupKey, group);
        const remainder = value.replace(/{{\s*-?\s*([^{}]+?)\s*}}/g, "");
        if (remainder.includes("{{") || remainder.includes("}}") || placeholders(value).includes("")) {
          result.errors.push({ code: "interpolation", message: `${file.path}: malformed interpolation at ${path}` });
        }
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        const children = Object.entries(value);
        if (!children.length) result.errors.push({ code: "empty-value", message: `${file.path}: empty translation object at ${path || "<root>"}` });
        for (const [key, child] of children) {
          if (!key || /[.:]/.test(key)) result.errors.push({ code: "invalid-value", message: `${file.path}: ambiguous translation key ${key}` });
          flatten(child, path ? `${path}.${key}` : key);
        }
      } else result.errors.push({ code: "invalid-value", message: `${file.path}: ${path || "<root>"} must be a string or an object of translations` });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      result.errors.push({ code: "invalid-value", message: `${file.path}: root must be a translation object` });
    } else flatten(parsed, "");
    result.files[result.files.length - 1].keys = entries.size;
    const families = new Set([...entries.keys()].flatMap(key => /_(zero|one|two|few|many)$/.test(key) || /_other$/.test(key) && placeholders(entries.get(key)!).includes("count") ? [key.replace(/_(zero|one|two|few|many|other)$/, "")] : []));
    for (const family of families) {
      for (const category of ["one", "few", "many", "other"]) {
        const key = `${family}_${category}`;
        if (!entries.has(key)) result.errors.push({ code: "plural", message: `${file.path}: plural family ${family} is missing ${category} (EN/PL mirror the full family)` });
      }
      if (entries.has(`${family}_two`)) result.errors.push({ code: "plural", message: `${file.path}: unsupported EN/PL plural category two for ${family}` });
    }
  }
  const actualNamespaces = new Set(files.map(file => file.namespace));
  for (const namespace of new Set([...expectedNamespaces, ...actualNamespaces])) {
    if (!expectedNamespaces.includes(namespace)) result.errors.push({ code: "namespace", message: `Unregistered namespace ${namespace}` });
    for (const language of languages) {
      if (!catalogs.has(`${language}/${namespace}`)) result.errors.push({ code: "namespace", message: `Missing ${language}/${namespace}.json` });
    }
    const en = catalogs.get(`en/${namespace}`), pl = catalogs.get(`pl/${namespace}`);
    if (!en || !pl) continue;
    // Exact parity includes plural suffixes. English mirrors Polish-only suffixes.
    for (const key of new Set([...en.keys(), ...pl.keys()])) {
      if (!en.has(key) || !pl.has(key)) {
        const missing = en.has(key) ? "pl" : "en";
        result.errors.push({ code: "missing-key", message: `${namespace}:${key} is missing in ${missing} (present only in ${missing === "pl" ? "en" : "pl"})` });
      } else {
        const left = placeholders(en.get(key)!), right = placeholders(pl.get(key)!);
        if (JSON.stringify(left) !== JSON.stringify(right)) result.errors.push({ code: "interpolation", message: `${namespace}:${key}: EN placeholders [${left}] differ from PL [${right}]` });
      }
    }
  }
  result.repeatedValues = [...values.values()].filter(group => group.keys.length > 1);
  return result;
}
