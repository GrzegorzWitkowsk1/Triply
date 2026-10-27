// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateTranslations, type TranslationFile } from "./translations";

function file(source: string, language: "en" | "pl" = "en", namespace = "common"): TranslationFile {
  return { language, namespace, path: `${language}/${namespace}.json`, source };
}
function validate(en: string, pl = en) {
  return validateTranslations([file(en), file(pl, "pl")], ["common"]);
}
describe("translation catalog validation", () => {
  it("accepts valid nested catalogs with different text and matching placeholders", () => {
    expect(validate('{"actions":{"save":"Save {{name}}"}}', '{"actions":{"save":"Zapisz {{name}}"}}').errors).toEqual([]);
  });
  it.each([
    '{"save":"First","save":"Second"}',
    '{"actions":{"save":"First","save":"Second"}}',
    String.raw`{"save":"First","s\u0061ve":"Second"}`,
    '{"actions":{"save":"First"},"actions":{"cancel":"Cancel"}}',
  ])("detects duplicate keys before JSON.parse discards them: %s", source => {
    const result = validate(source);
    expect(result.errors.filter(error => error.code === "duplicate-key")).toHaveLength(2);
    expect(result.errors[0].message).toMatch(/en\/common.json:\d+:\d+: duplicate key/);
  });
  it("allows the same property name in separate objects", () => {
    expect(validate('{"trip":{"title":"Trip"},"day":{"title":"Day"}}').errors).toEqual([]);
  });
  it.each([
    '{"save":"Save",}', '{"save":"Save" // comment\n}', "{'save':'Save'}",
    '{save:"Save"}', '{"save":"Save"', '{"save":NaN}', '\uFEFF{"save":"Save"}',
  ])("rejects invalid JSON even if the TypeScript JSON parser tolerates it: %s", source => {
    expect(validate(source).errors.some(error => error.code === "invalid-json")).toBe(true);
  });
  it.each(['"text"', "null", "[]", "true"])("rejects a non-object root: %s", source => {
    expect(validate(source).errors.some(error => error.code === "invalid-value")).toBe(true);
  });
  it("reports both missing and extra keys, including nested keys", () => {
    const result = validate('{"actions":{"save":"Save"}}', '{"actions":{"cancel":"Anuluj"}}');
    expect(result.errors).toEqual([
      { code: "missing-key", message: "common:actions.save is missing in pl (present only in en)" },
      { code: "missing-key", message: "common:actions.cancel is missing in en (present only in pl)" },
    ]);
  });
  it("detects differing object structures and missing plural forms", () => {
    expect(validate('{"a":{"b":"Value"}}', '{"a":"Wartość"}').errors.filter(error => error.code === "missing-key")).toHaveLength(2);
    expect(validate('{"items_one":"{{count}} item","items_other":"{{count}} items"}', '{"items_one":"{{count}} element"}').errors.some(error => error.code === "missing-key")).toBe(true);
  });
  it.each([
    ['{"save":"Save {{name}}"}', '{"save":"Zapisz {{user}}"}'],
    ['{"save":"Save {{name}}"}', '{"save":"Zapisz"}'],
    ['{"save":"Save"}', '{"save":"Zapisz {{name}}"}'],
  ])("rejects mismatched interpolation placeholders", (en, pl) => {
    expect(validate(en, pl).errors.some(error => error.code === "interpolation")).toBe(true);
  });
  it("compares placeholder names independently of order, escaping and formatter options", () => {
    const result = validate('{"result":"{{- user.name}}: {{amount, number}}"}', '{"result":"{{amount}}: {{user.name}} / {{user.name}}"}');
    expect(result.errors).toEqual([]);
  });
  it("supports placeholders in i18next nested translation options", () => {
    const source = JSON.stringify({ result: '$t(events, {"count": {{exported}}}) $t(excluded, {"count": {{excluded}}})' });
    expect(validate(source).errors).toEqual([]);
    expect(validate(source, JSON.stringify({ result: '$t(events, {"count": {{total}}})' })).errors.some(error => error.code === "interpolation")).toBe(true);
  });
  it.each(["{{name", "{{}}", "{{name}} }}"])("rejects malformed interpolation: %s", value => {
    expect(validate(JSON.stringify({ value })).errors.some(error => error.code === "interpolation")).toBe(true);
  });
  it.each(['{"save":""}', '{"actions":{"save":"  \\t"}}', '{"actions":{}}', '{}'])("rejects empty translations: %s", source => {
    expect(validate(source).errors.some(error => error.code === "empty-value")).toBe(true);
  });
  it.each(['{"value":0}', '{"value":null}', '{"value":false}', '{"value":["Save"]}'])("rejects unsupported translation values: %s", source => {
    expect(validate(source).errors.some(error => error.code === "invalid-value")).toBe(true);
  });
  it("detects duplicate properties even inside unsupported arrays", () => {
    const result = validate('{"values":[{"save":"One","save":"Two"}]}');
    expect(result.errors.some(error => error.code === "duplicate-key")).toBe(true);
  });
  it("reports missing files and unregistered namespaces, including nested namespaces", () => {
    const result = validateTranslations([file('{"save":"Save"}'), file('{"title":"Export"}', "pl", "sharing/calendar")], ["common", "auth"]);
    expect(result.errors.filter(error => error.code === "namespace").map(error => error.message)).toEqual([
      "Missing pl/common.json", "Missing en/auth.json", "Missing pl/auth.json",
      "Unregistered namespace sharing/calendar", "Missing en/sharing/calendar.json",
    ]);
  });
  it("warns above 300 lines without failing otherwise valid catalogs", () => {
    const result = validate('{\n' + '\n'.repeat(299) + '"save":"Save"\n}\n');
    expect(result.errors).toEqual([]); expect(result.warnings).toHaveLength(2);
    expect(result.files[0]).toMatchObject({ lines: 302, keys: 1 });
  });
  it("accepts the exact line threshold and counts CRLF files consistently", () => {
    const source = '{\n' + '\n'.repeat(297) + '"save":"Save"\n}\n';
    expect(validate(source).warnings).toEqual([]);
    expect(validate(source.replaceAll('\n', '\r\n')).files[0].lines).toBe(300);
  });
  it("counts trailing blank lines toward the size warning", () => {
    expect(validate('{"save":"Save"}\n' + '\n'.repeat(300)).warnings).toHaveLength(2);
  });
  it("reports repeated values for review without rewriting keys or failing on contextual repetition", () => {
    const result = validate('{"verb":"Saved","heading":"Saved"}');
    expect(result.errors).toEqual([]);
    expect(result.repeatedValues[0]).toEqual({ language: "en", value: "Saved", keys: ["common:verb", "common:heading"] });
  });
  it("rejects incomplete plural families even when both languages have matching keys", () => {
    const result = validate('{"days_one":"{{count}} day","days_other":"{{count}} days"}');
    expect(result.errors.some(error => error.code === "plural")).toBe(true);
  });
  it("rejects unsupported plural categories", () => {
    const result = validate(JSON.stringify({ days_one: "One day", days_few: "{{count}} days", days_many: "{{count}} days", days_other: "{{count}} days", days_two: "{{count}} days" }));
    expect(result.errors.filter(error => error.code === "plural")).toHaveLength(2);
  });
  it("does not mistake an enum label ending in other for a plural family", () => {
    expect(validate('{"category_other":"Other"}').errors).toEqual([]);
  });
  it("rejects an isolated zero override without the required plural family", () => {
    expect(validate('{"items_zero":"No items"}').errors.some(error => error.code === "plural")).toBe(true);
  });
});
