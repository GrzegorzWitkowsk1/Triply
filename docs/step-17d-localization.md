# Step 17D — localization hardening

## Audit and scope

Reviewed the existing i18next resources, language detection/storage, formatting helpers,
trip and shared-trip serialization, AI request hooks, regeneration, packing previews,
assistant responses, export routes/renderers, timezone conversion, budget arithmetic,
weather descriptions, Saved filtering, guest migration, authorization and browser harness.
The Step 17C language boundaries remain documented in `step-17c-localization.md`.

Confirmed issues fixed:

- Export renderers had English-only application labels and received no export locale.
- Several card/summary date formatters duplicated logic; some weather dates displayed ISO text.
- Money formatting selected English; trip cards assumed EUR even for another stored currency.
- Raw numeric count interpolation displayed decimal points in Polish.
- Language persistence did not synchronize other tabs; the visible switcher relied on flags.
- Saved alphabetical sorting used English and did not recompute on locale changes.

No database migration, new dependency, paid service, AI translation call, scheduling change,
quota change, routing change or authentication change is introduced.

## Presentation and data integrity

`packages/shared/src/formatting.ts` centralizes date, date-range, destination-local time,
number, currency, percentage and distance presentation. Web wrappers capture the selected
UI locale. ISO calendar dates are validated and formatted in UTC regardless of browser
timezone. Cross-year ranges retain both years. Actual timestamp displays may use a supplied
destination timezone; itinerary clock displays preserve the saved destination wall-clock
fields. Existing 24-hour schedule presentation is retained for both languages.

Money still uses the existing BigInt-safe minor-unit formatter and currency precision.
Only its locale is configurable. No currency conversion or arithmetic change occurs.
Polish expense input accepts a decimal comma through a narrowly scoped normalization;
grouped display strings remain invalid calculation inputs. A component test verifies
`12,29` produces `amountMinor: 1229, currency: EUR`.

Distances remain kilometers, temperatures retain their existing units, stored numbers and
route metrics remain unchanged. Count display placeholders use i18next's `number` formatter;
raw counts used by nested translation JSON and plural selection remain numeric.

## PDF and calendar architecture

Existing private and public export endpoints accept `?locale=en|pl`. The shared strict
query schema defaults a missing locale to English for old clients and rejects unsupported
values with HTTP 400 / `INVALID_LOCALE`. Successful responses include `Content-Language`.
Frontend download functions capture the locale when starting the fetch. Renderers receive
request-local locale arguments, so concurrent exports cannot change each other's language.

Application labels live in shared EN/PL `exports/pdf` and `exports/calendar` catalogs.
The existing translation validator checks these catalogs alongside UI resources, including
key parity, duplicates and interpolation consistency. Server interpolation inserts values
once and does not execute nested instructions supplied by user/provider content.

PDF headings, dates, durations, weather codes, travel labels, details, warnings and footers
are localized. Saved descriptions, proper names and addresses remain unchanged. Existing
public projections continue to exclude private budget, expense and analysis notes.
PDFKit's existing embedded Noto Sans subsets already cover Polish; no fonts were added.
Real PDF tests extract the complete Polish alphabet and accented venue names, check page
text coordinates, margins, page breaks, long titles/descriptions and nonempty pages.
An actual Polish fixture PDF was also rasterized with the existing pdfjs/canvas dependencies
and visually inspected: diacritics, accented names, footer and mixed-language prose render
correctly. Review artifacts are in the local temporary directory as `triply-step17d-polish.pdf`
and `triply-step17d-polish.png`; no generator script or additional font asset is retained.

ICS labels, descriptions and known scheduler-owned break titles are localized. Official
place names and saved prose remain unchanged. Existing UTF-8 escaping and 75-octet folding
remain delegated to ical-generator. Calendar UIDs and UTC event instants are identical
between EN/PL exports. Destination-local schedules resolve through the saved IANA timezone;
valid explicit offsets are checked against it. DST gaps/folds without an unambiguous instant
remain explicit errors rather than guessed offsets. Missing/invalid zones remain errors.

No export cache was added: responses retain `no-store`. Ownership filters, anonymous
sharing projections, post-render share revocation checks, rate limits, size limits and
PDF concurrency limits are preserved. Export locale validation does not disclose trip data.

## AI, legacy trips and persistence

- New trip generation captures UI locale and persists contentLocale.
- Regenerate Day uses stored contentLocale; conflicting client locale cannot override it.
- New assistant responses and packing suggestions use the UI locale captured for that request.
- Existing messages, packing items and itinerary descriptions are not translated or replayed.
- Legacy/invalid persisted contentLocale reads use English without rewriting records.
- Guest migration and sharing preserve content language and existing identities.
- Locale-sensitive provider/packing fingerprints remain isolated as implemented in 17C;
  coordinate, routing and identity query caches remain language-independent.

The existing `triply.language` preference survives reload, navigation, login/logout and
guest migration. A validated storage listener synchronizes other tabs without mutations,
query invalidations or AI requests. Browser regional language detection remains normalized;
API locale contracts intentionally accept only the exact supported enum values.

## Accessibility and responsive verification

The document `lang` updates with UI language. The switcher has visible EN/PL text and full
localized accessible language names, plus existing menu roles and keyboard focus behavior.
Existing localized dialogs, forms, errors, loading labels and navigation retain their
accessibility behavior. Responsive browser coverage exercises both languages at 320, 375,
768, 1024 and 1440 pixels across the existing product pages and dialogs. This is automated
overflow/interaction coverage, not a claim of a complete manual screen-reader certification.

## Files changed for this step

Shared:

- `packages/shared/src/{formatting,exportLanguage,locale,budget,index}.ts`
- `packages/shared/src/locales/{en,pl}/exports/{pdf,calendar}.json`

API:

- `apps/api/src/routes/{pdf,calendar}.ts` and their `.routes.test.ts` files
- `apps/api/src/services/{tripPdf,tripCalendar}.ts` and their `.test.ts` files
- `apps/api/src/services/{assistantBudget,assistantContext}.ts`
- `apps/api/src/services/localization.test.ts`

Web:

- `apps/web/src/i18n/{index,format,resources,namespaces}.ts`, `i18n.test.ts`
- EN/PL UI resource files containing numeric count displays
- `apps/web/scripts/validateTranslations.ts`
- `apps/web/src/api/{pdf,calendar}.ts` and their tests
- `apps/web/src/components/LanguageSwitcher.tsx` and its test
- `apps/web/src/components/{GuestMigration,PackingSuggestions}.tsx`
- `apps/web/src/components/home/TripPlanSummaryCard.tsx`
- `apps/web/src/components/trips/{MyTripCard,TripCard}.tsx`
- `apps/web/src/components/trip/{TripBudgetCard,TripWeatherRetry,RegenerateDayDialog}.tsx`
- `apps/web/src/components/trip/{TripBudgetCard,TripWeatherRetry}.test.tsx`
- `apps/web/src/config/{tripCards,itineraryAdapters,notifications,saved}.ts`, `saved.test.ts`
- `apps/web/src/pages/{TripPage,SharedTripPage,HomePage,SavedPage}.tsx`

Browser tests:

- `apps/api/e2e/aiLocalization.spec.ts`
- `apps/api/e2e/localizationArtifacts.ts`
- `apps/api/e2e/localizationHardening.spec.ts`

Other existing working-tree localization changes belong to earlier steps and were preserved.

## Validation

| Check | Executed result |
| --- | --- |
| `bun run --cwd apps/api test` | 940 tests passed, 57 files; includes backend route/integration suites and real PDF/ICS artifacts |
| `bun run --cwd apps/web test --maxWorkers=2` | 466 tests passed, 46 files |
| `bun run test:e2e` | 81 Chromium tests passed in 14.8 minutes; includes both localized trip lifecycles, real exports, five viewport widths, legacy trips, migration and no-AI-on-switching checks |
| `bun run typecheck` | Shared, API, web and translation-script checks passed |
| `bun run typecheck:e2e` | Passed |
| `bun run build` | All 3 packages built successfully |
| Translation validation (also executed by web tests/build) | 0 errors, 0 warnings; 174 repeated-value groups listed for contextual review |
| `bun run audit:translations` | 0 likely untranslated static strings; 770 literal calls checked, 0 missing keys |
| `bun run lint` | Cannot run: repository has no lint script |
| `git diff --check` (command-local safe.directory/core.safecrlf) | Passed |

The focused localization run also passed all 8 scenarios. Provider mocks are deterministic and no
paid AI services are called. Integration tests assert response contents, locale metadata,
unchanged documents, private-field exclusion, guest/owner authorization, invalid/missing
locale handling, sharing revocation, DST errors and matching calendar UIDs/instants.

## Remaining limitations

- Provider/user/AI prose has its original language; no automatic translation is performed.
  A model's language correctness cannot be guaranteed by structural schema validation.
- Calendar export requires a valid saved destination timezone and a resolvable schedule.
  Ambiguous DST wall times need a valid explicit offset; missing timezone data is not guessed.
- Font coverage verifies Polish, common Latin accents and existing supported subsets;
  this does not promise every Unicode script or emoji has a glyph.
- Browser regression runs use Chromium and deterministic provider mocks. They do not verify
  real provider language quality, all calendar applications, or all assistive technologies.
- There is no repository lint script/configured lint task. Builds retain the existing large
  JavaScript chunk warning; dependency annotation warnings do not fail the build.

## Readiness

Step 17D implementation and the applicable configured automated checks are complete.
English/Polish localization is ready for the next Triply development phase within the
limitations above. Existing trips and quotas remain intact. No commits or pushes were made.
