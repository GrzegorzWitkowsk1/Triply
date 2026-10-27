// @vitest-environment node
import { expect, it } from "vitest";
import { auditSource, literalTranslationUsages } from "./translationAudit";
it("finds visible JSX, conditional labels, attributes and configuration text", () => {
  const source = 'const options = { label: "Sort places" }; function Page() { return <><h1>Hello</h1><input placeholder="Trip name" /><button>{busy ? "Saving" : "Save"}</button></>; }';
  expect(auditSource("Page.tsx", source).map(item => item.text)).toEqual(["Sort places", "Hello", "Trip name", "Saving", "Save"]);
});
it("discovers explicit and hook-scoped literal resource references without guessing dynamic keys", () => {
  const source = 'function Page() { const { t } = useTranslation("packing"); return <>{t("title")}{i18n.t("save", { ns: "common" })}{t(dynamicKey)}{t("errors:unexpected")}</>; }';
  expect(literalTranslationUsages("Page.tsx", source).map(({ namespace, key }) => ({ namespace, key }))).toEqual([
    { namespace: "packing", key: "title" }, { namespace: "common", key: "save" }, { namespace: "errors", key: "unexpected" },
  ]);
});
it("ignores routes, identifiers, styles, comparisons and translated keys", () => {
  const source = 'function Page() { return <button className="btn primary" onClick={() => go("/trips")} disabled={status === "ready"}>{i18n.t("save", { ns: "common" })}</button>; }';
  expect(auditSource("Page.tsx", source)).toEqual([]);
});
it("supports narrow documented exceptions rather than blanket file exclusions", () => {
  const source = '<><span>Triply</span><span>Save</span></>';
  expect(auditSource("Logo.tsx", source, [{ file: "Logo.tsx", text: "Triply", reason: "Product name" }]).map(item => item.text)).toEqual(["Save"]);
  expect(auditSource("Other.tsx", source, [{ file: "Logo.tsx", text: "Triply", reason: "Product name" }])).toHaveLength(2);
});
it("finds status objects, accessible input configuration and direct notifications", () => {
  const source = 'setHint({ text: "Listening…" }); const input = { "aria-label": "Amount" }; toast("Saved!"); window.confirm("Delete trip?"); setError("errors:unexpected");';
  expect(auditSource("Page.tsx", source).map(item => item.text)).toEqual(["Listening…", "Amount", "Saved!", "Delete trip?"]);
});
it("finds a local string array rendered directly through map, but accepts translated labels", () => {
  const prefix = 'const suggestions = ["Plan for rain", "Less walking"]; ';
  expect(auditSource("Page.tsx", prefix + '<>{suggestions.map(item => <button>{item}</button>)}</>').map(item => item.text)).toEqual(["Plan for rain", "Less walking"]);
  expect(auditSource("Page.tsx", prefix + '<>{suggestions.map((item, index) => <button onClick={() => send(item)}>{t(`suggestion_${index}`)}</button>)}</>')).toEqual([]);
});
