# Internationalization

The application uses one bundled i18next instance, initialized before React renders. `resources.ts` loads JSON recursively; `namespaces.ts` registers 34 feature namespaces. For example, `locales/pl/sharing/calendar.json` belongs to `sharing/calendar`. React escapes translations; never render them as HTML.

Language detection uses a valid `triply.language` preference, then the browser language, then English. Only `en` and `pl` are stored. Regional browser tags normalize to their supported base language. Explicit changes persist and update HTML `lang` and `dir` without navigating, remounting the application, or sending API mutations. Unavailable local storage leaves switching functional in memory. The keyboard-accessible switcher is present on auth pages, the app header, Settings and shared-trip states.

Use `useTranslation` so components rerender when the language changes. Store resource keys or message data in local feedback/error state and translate during rendering. Toast callbacks must resolve copy at render time. Do not store translated strings that remain visible across language changes.

Feature namespaces cover auth (guest/session/migration/profile/validation), navigation (notifications), trips (details/weather/map), tripCreator (home/fields/preferences/validation), itinerary (editor/generation/categories/admission/quality), Explore (collections), Saved, Packing (suggestions), Expenses, Assistant and Sharing (calendar). `common` holds generic actions and reusable quantity/date labels. Files are intentionally smaller than the 200–300-line ceiling; do not merge them just to increase line counts. Preserve context-specific keys even when current text matches. Repeated plural values and context-dependent headings are review findings, not duplicate JSON keys.

Use complete sentences with named interpolation and i18next plurals. Both languages mirror `one`, `few`, `many` and `other` to keep exact key parity. English repeats its plural wording in unused `few`/`many` forms; Polish supplies its grammatical forms. Optional `_zero` overrides still require a complete family. Never build sentences by joining translated fragments. Keep domain IDs, enum values, routes and API contracts unchanged.

Run from the repository root:

- `bun run validate:translations`: strict JSON syntax, nested/escaped duplicate properties, missing files/keys, namespace registration, empty/invalid values, interpolation parity and plural-family structure. Critical errors fail; files over 300 lines warn. The existing TypeScript JSON AST detects duplicates before `JSON.parse` discards them; no parser dependency is added.
- `bun run audit:translations`: TypeScript-AST audit of visible JSX text/attributes/expressions, label/status configuration, direct toast/confirmation messages and local literal arrays rendered through `map`. It also checks statically resolvable translation calls against English resources (strict parity validates Polish). Missing literal keys fail; heuristic string findings warn.
- `bun run --cwd apps/web test`: resource validation plus unit/component/script tests.
- `bun run test:e2e`: isolated fixture-backed Chromium tests, including `i18n.spec.ts` and `i18nCoverage.spec.ts`.

Both audit commands run explicitly in CI. Resource validation also runs before frontend tests and production builds. Script types are checked through `tsconfig.scripts.json`.

The static audit has narrow file/text/reason exceptions in `scripts/auditTranslations.ts`. It does not resolve arbitrary data flow, imported arrays, aliases, runtime-computed keys, third-party DOM, server copy, user text or generated content. Clean output is not proof of complete UI coverage. Combine it with component tests, route tests and source review; see [the audit inventory](AUDIT.md).

`errors.ts` maps stable API codes/statuses to localized messages and supplies a friendly unknown-error fallback. Technical errors remain on the original error object; do not match English API message substrings. `LocaleTheme` localizes MUI-owned pagination and close controls. Triply map zoom/marker names update in place.

`format.ts` supplies locale-aware dates, numbers, currency and percentages without currency conversion. Broader formatting remains Step #17D. Persisted AI content, existing chat responses, user text, original place/restaurant names, unsupported provider descriptions, generated PDF/ICS contents and developer diagnostics are excluded. Step #17C can localize new AI requests separately; switching language must never regenerate existing data.
