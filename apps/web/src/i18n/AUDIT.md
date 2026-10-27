# Step #17B.1 translation coverage audit

Date: 2026-10-26. Scope: application-controlled static web UI in English and Polish.
The working tree already contained Steps #17A/#17B/addendum work; it was preserved and extended. No commit or push was made.

## TODO / completion inventory

- [x] Discover routes, feature modules, resources, existing checks and fixtures.
- [x] Review visible text, attributes, configuration, validation and error paths.
- [x] Fix confirmed translation, live-switching, grammar and accessibility defects.
- [x] Wire strict resource validation and the static UI audit into CI.
- [x] Add focused unit/component/script and deterministic browser coverage.
- [x] Record final verification results below after the full suites complete.

## Discovered routes and major components

`App.tsx` is the route source. `apps/web` is the only frontend app. `packages/shared` contains domain contracts, schemas and catalog data; there is no separate shared UI package. `apps/api` supplies the existing isolated Playwright server and deterministic provider fixtures.

| Route | Major modules inspected | Translation runtime coverage |
| --- | --- | --- |
| `/` | PublicOnlyRoute, identity redirect | Polish preference survives redirect to Home |
| `/login`, `/register` | LoginPage, credentials/guest errors, password visibility, media, switcher | Both locales, five widths, input preservation, reload; keyboard switcher test |
| `/home` | HomePage, voice status/errors, attachments, preferences, progress, summary, TripRequirementsDialog | Both locales, five widths, draft prompt preservation; Polish guest wizard validation and saved requirements |
| `/trips` | MyTripsPage, TripCard/MyTripCard, filters, deletion dialog, GuestUsage | Both locales, five widths, deletion cancellation; empty/populated component coverage |
| `/trips/:id` | TripPage, TripStatusCard/Loading, preferences, timeline/cards, map, AttractionPicker, MoveAttractionDialog, RegenerateDayDialog, TripBudgetCard, TripAssistant, exports/sharing | Both locales, five widths, editor dialog, Expenses draft preservation, trip equality and provider-call checks |
| `/trips/:id/equipment` | TripEquipmentPage, categories, item forms, bulk confirmation, PackingSuggestions | Both locales, five widths, reload, validation, unchanged trip; component tests for saved feedback, duplicate/stale previews |
| `/explore` | ExplorePage, discovery search/filter/sort/pagination, destination cards/save/details | Both locales, five widths, search, country filter, controlled failure and retry |
| `/explore/collections/:slug` | CollectionPage, curated titles/descriptions/preferences, destination cards | Both locales, five widths, save action; invalid slug recovery |
| `/saved` | SavedPage, SavedPlaceCard/details, SavedRemoveButton, filters/search | Both locales, five widths, search, collection-to-Saved journey and ownership/data equality |
| `/notifications` | NotificationsPage, static notification copy, filters/read controls | Both locales, five widths, unread filter; welcome notification copy switches reactively |
| `/profile` | ProfilePage, names/avatar, password confirmation, PreferencesCard, AppLanguageCard | Both locales, five widths, unsaved name preservation; validation/error/toast component coverage |
| `/shared/:shareToken` | SharedTripPage, read-only timeline/map, export buttons, loading/error states | Both locales, five widths, reload, revoked/missing link, switcher on unavailable state |
| `*` | Existing redirect to `/home` | Polish preference retained; no standalone Not Found page exists |

The component audit also included nested menus/popovers, tooltips, map controls, mobile navigation, provider metadata, export menus, sharing confirmations, guest migration, loading/error announcements, itinerary conflict displays and assistant suggestion buttons.

## Confirmed issues fixed

- Auth pages imported but did not render the shared language switcher.
- Auth media alt text and location caption contained English `Spain` in Polish.
- Travel pace mistakenly rendered walking-tolerance labels instead of pace labels.
- Voice-input listening/failure states and the welcome-notification message contained English literals.
- Assistant suggestion buttons bypassed their existing translated resources. Display labels now translate; existing request text and persisted chat remain unchanged.
- Polish calendar export deliberately retained an English control label in an older test. This step localizes it and updates that test.
- Packing success/selection feedback, profile/password errors, Home quota/errors, itinerary save notices, candidate-discovery warnings and calendar export errors could retain their previous language. These now resolve keys/data/callbacks during rendering.
- Expenses exposed the technical word `currency` when currency was missing. It now displays the translated amount label.
- Overlong country validation lacked an explicit localized message; local amount/precision failures now use the validation fallback while API failures keep their status/code handling.
- English Packing counts/actions and unconfirmed admission prices had singular/plural defects. Polish day, suggestion and item families are tested at 0/1/2/5/12/22; complete neutral count sentences are used where two independent counts occur.
- Exact scheduler-owned lunch/coffee/dinner break labels are localized at display time. Arbitrary place/custom/AI titles remain intact.
- Raw opening-hours diagnostics no longer appear as English tooltips. Regeneration preview diagnostics use a localized review notice; original diagnostic arrays remain on API results. This preserves contracts, but does not introduce structured warning codes or translate arbitrary diagnostic prose.
- Weather retry fallback tooltip copy is localized.
- Mobile profile navigation now has a translated accessible name even when email text is hidden; upload validation is announced as an alert; voice and creation feedback have announcement roles.
- Map marker tooltips, as well as accessible names, update on language changes.
- Polish Settings pace controls overflowed by 23px at 320px. Scoped wrapping preserves full labels and existing desktop styling.

## Resource structure and safeguards

There are 34 registered namespaces, mirrored under `locales/en` and `locales/pl`. Features retain logical subnamespaces for auth, navigation, trip creation, trips, itinerary, Explore, Packing and Sharing. Common remains limited to generic actions, units and quantity/date labels. The largest resources are `packing.json` at 73 lines per language. No file needs splitting to meet the 300-line warning threshold; no dependencies or i18n architecture were introduced.

Strict validation covers JSON syntax, duplicate properties including nested/escaped keys, missing namespaces/files/leaves in either language, empty/invalid values, interpolation syntax/parameter parity and plural-family structure. Isolated `_zero` overrides now also require a complete family. Tests include invalid JSON, escaped duplicates, nested duplicates, interpolation and incomplete plural families. Critical failures exit nonzero; oversized files only warn.

The AST static audit now also detects status/message objects, accessible input configuration, direct notifications/confirmations and simple local literal arrays rendered through `map`. Missing statically resolved resource calls fail; heuristic findings warn. Exceptions are narrow file/text/reason records, currently product branding and semantic navigation keys. The English auth-caption exception was removed after fixing the caption.

Root and web package scripts expose `audit:translations`; CI explicitly runs both it and `validate:translations`. Frontend tests and production builds retain strict resource validation. Existing repeated-value reporting remains informational: duplicate values across plural forms or contextual headings do not mean duplicate JSON properties and are not blindly deduplicated.

## Verification results

| Check | Actual result |
| --- | --- |
| `bun run validate:translations` (also run before frontend tests/build) | 0 errors, 0 oversized-file warnings; no duplicate JSON properties, missing keys, interpolation or plural-family failures. Repeated values remain informational. |
| `bun run audit:translations` | 0 likely untranslated-string findings; 770 statically resolved calls, 0 missing keys. |
| Frontend unit/component/script tests | Final full run: 458 passed, 0 failed, 0 skipped (`bun run --cwd apps/web test --maxWorkers=4`). |
| API tests | 891 passed, 0 failed. Test-only environment and unused Mongo URI; no production database used. |
| Dedicated translation Chromium suite | 18 passed in its complete dedicated run. |
| Full Playwright suite | 73 cases executed: initially 65 passed and 8 failed. Seven failures were stale labels/error/button-count expectations; the new revocation test also needed explicit page-load and response synchronization. |
| Targeted Playwright follow-up | All 11 passed: all 8 corrected failures plus 3 strengthened locale tests (keyboard-only switching and active-day preservation). Thus every one of the 73 cases has a passing result across the full run and targeted follow-up; this is not claimed as one clean 73/73 invocation. |
| `bun run typecheck` | All workspace tasks passed, including translation script types. |
| `bun run typecheck:e2e` | Passed. |
| `bun run build` | All 3 workspace builds passed. Vite reported bundle-size and dependency comment-annotation warnings; neither failed the build. |
| Lint | Not available: no lint script or lint configuration exists. |
| `git diff --check` | Passed (repository ownership supplied per command; no global Git configuration changed). |

The four critical journeys are covered: Polish guest requirements/validation, existing trip/editor/Packing/Expenses data preservation, Explore/filter/collection/save/Saved, and controlled failure/retry. Tests also check sharing revocation, PDF/ICS validity, guest quotas/migration, concurrent Packing changes, Saved ownership and scheduling/routing diagnostics. The updated tests still assert persistence and original backend diagnostics; localized UI assertions do not replace those checks.

Intermediate failures are retained here for an accurate history of verification; they were fixed and rerun rather than counted as passes.

## Intentional exclusions and limits

- Persisted AI itineraries and chat answers, user-entered text, original place/restaurant names, unsupported external descriptions, generated PDF/ICS contents and developer diagnostics remain untranslated by design.
- Static analysis cannot resolve arbitrary data flow, imports/aliases, dynamic keys, third-party DOM, runtime-generated text or every application state. Resource parity and zero warnings do not prove 100% UI coverage.
- Browser checks use Chromium and deterministic fixture providers, not external AI. No language-switch operation triggers trip regeneration or consumes quota. Explicit planning/generation journeys use the existing mocked providers.
- Five-width checks assert document overflow and representative interactive controls in EN/PL. They do not prove that every tooltip, toast or combination of long user/provider content is visually perfect. Exhaustive manual visual review at every width, screen-reader testing, and Firefox/WebKit are unverified.
- Permission-denied/unknown API fallbacks, quota exhaustion, stale/duplicate Packing, regeneration warnings, exports and dialogs have focused localized unit/component checks. Every failure state of every route has not been separately rendered in both languages in a browser.
- The repository has no lint script/configuration to run. TypeScript, source auditing and `git diff --check` are run separately; they are not reported as lint.

## Readiness for #17C

The static UI and safeguards support proceeding to AI localization. #17C must explicitly propagate the selected language for new AI requests; this step does not change prompts or translate/regenerate stored content. Preserve original data and the documented exclusions. Do not describe this audit as a proof of universal translation coverage.
